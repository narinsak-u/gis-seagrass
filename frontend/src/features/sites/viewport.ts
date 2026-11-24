import { ApiClientError } from "@/src/lib/api";
import type { BboxBounds, SiteFeatureCollection } from "./types";

export type ViewportLoadStatus = "idle" | "loading" | "ready" | "empty" | "error";

export interface ViewportErrorInfo {
  code: string;
  message: string;
  status?: number;
}

export interface ViewportSitesState {
  status: ViewportLoadStatus;
  data: SiteFeatureCollection | null;
  error: ViewportErrorInfo | null;
  bbox: BboxBounds | null;
  bboxString: string | null;
  province?: string;
}

export interface TimerScheduler {
  setTimeout: (fn: () => void, ms: number) => number;
  clearTimeout: (id: number) => void;
}

export interface ViewportFetchRequest {
  bbox: string;
  bounds: BboxBounds;
  province?: string;
  signal: AbortSignal;
}

export interface ViewportSitesControllerOptions {
  debounceMs?: number;
  fetchSites: (request: ViewportFetchRequest) => Promise<SiteFeatureCollection>;
  onStateChange: (state: ViewportSitesState) => void;
  scheduler?: TimerScheduler;
}

export interface ViewportSitesController {
  loadInitial: (bounds: BboxBounds, province?: string) => void;
  onViewportSettled: (bounds: BboxBounds, province?: string) => void;
  retry: () => void;
  dispose: () => void;
  getState: () => ViewportSitesState;
}

const DEFAULT_DEBOUNCE_MS = 250;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundCoord(value: number): number {
  return Number(value.toFixed(6));
}

export function normalizeBboxBounds(bounds: BboxBounds): BboxBounds {
  let minLon = roundCoord(clamp(bounds.minLon, -180, 180));
  let maxLon = roundCoord(clamp(bounds.maxLon, -180, 180));
  let minLat = roundCoord(clamp(bounds.minLat, -90, 90));
  let maxLat = roundCoord(clamp(bounds.maxLat, -90, 90));

  if (!Number.isFinite(minLon) || !Number.isFinite(maxLon) || minLon >= maxLon) {
    minLon = -180;
    maxLon = 180;
  }
  if (!Number.isFinite(minLat) || !Number.isFinite(maxLat) || minLat >= maxLat) {
    minLat = -90;
    maxLat = 90;
  }

  return { minLon, minLat, maxLon, maxLat };
}

export function formatBbox(bounds: BboxBounds): string {
  const normalized = normalizeBboxBounds(bounds);
  return `${normalized.minLon},${normalized.minLat},${normalized.maxLon},${normalized.maxLat}`;
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function toViewportError(error: unknown): ViewportErrorInfo {
  if (error instanceof ApiClientError) {
    return {
      code: error.code,
      message: error.message,
      status: error.status,
    };
  }
  if (error instanceof Error) {
    return {
      code: "NETWORK_ERROR",
      message: error.message || "Unable to load sites for this map view.",
    };
  }
  return {
    code: "UNKNOWN_ERROR",
    message: "Unable to load sites for this map view.",
  };
}

const defaultScheduler: TimerScheduler = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms) as unknown as number,
  clearTimeout: (id) => globalThis.clearTimeout(id as unknown as ReturnType<typeof setTimeout>),
};

export function createViewportSitesController(
  options: ViewportSitesControllerOptions,
): ViewportSitesController {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const scheduler = options.scheduler ?? defaultScheduler;

  let disposed = false;
  let requestSequence = 0;
  let debounceTimerId: number | null = null;
  let activeAbortController: AbortController | null = null;
  let lastRequest: { bounds: BboxBounds; province?: string } | null = null;

  let state: ViewportSitesState = {
    status: "idle",
    data: null,
    error: null,
    bbox: null,
    bboxString: null,
    province: undefined,
  };

  function emit(next: ViewportSitesState): void {
    state = next;
    if (!disposed) {
      options.onStateChange(next);
    }
  }

  function clearPendingTimer(): void {
    if (debounceTimerId !== null) {
      scheduler.clearTimeout(debounceTimerId);
      debounceTimerId = null;
    }
  }

  function abortActiveRequest(): void {
    if (activeAbortController) {
      activeAbortController.abort();
      activeAbortController = null;
    }
  }

  function executeFetch(bounds: BboxBounds, province?: string): void {
    if (disposed) return;

    const normalizedBounds = normalizeBboxBounds(bounds);
    const bboxString = formatBbox(normalizedBounds);
    lastRequest = { bounds: normalizedBounds, province };

    const seq = ++requestSequence;
    abortActiveRequest();
    const abortController = new AbortController();
    activeAbortController = abortController;

    emit({
      status: "loading",
      data: state.data,
      error: null,
      bbox: normalizedBounds,
      bboxString,
      province,
    });

    options
      .fetchSites({
        bbox: bboxString,
        bounds: normalizedBounds,
        province,
        signal: abortController.signal,
      })
      .then((collection) => {
        if (disposed || seq !== requestSequence) {
          return;
        }
        if (activeAbortController === abortController) {
          activeAbortController = null;
        }
        emit({
          status: collection.features.length === 0 ? "empty" : "ready",
          data: collection,
          error: null,
          bbox: normalizedBounds,
          bboxString,
          province,
        });
      })
      .catch((error: unknown) => {
        if (disposed || seq !== requestSequence || isAbortError(error)) {
          return;
        }
        if (activeAbortController === abortController) {
          activeAbortController = null;
        }
        emit({
          status: "error",
          data: state.data,
          error: toViewportError(error),
          bbox: normalizedBounds,
          bboxString,
          province,
        });
      });
  }

  return {
    loadInitial(bounds, province) {
      if (disposed) return;
      clearPendingTimer();
      executeFetch(bounds, province);
    },

    onViewportSettled(bounds, province) {
      if (disposed) return;
      const normalizedBounds = normalizeBboxBounds(bounds);
      lastRequest = { bounds: normalizedBounds, province };
      requestSequence += 1;
      abortActiveRequest();
      clearPendingTimer();
      debounceTimerId = scheduler.setTimeout(() => {
        debounceTimerId = null;
        executeFetch(normalizedBounds, province);
      }, debounceMs);
    },

    retry() {
      if (disposed || !lastRequest) return;
      clearPendingTimer();
      executeFetch(lastRequest.bounds, lastRequest.province);
    },

    dispose() {
      disposed = true;
      clearPendingTimer();
      abortActiveRequest();
    },

    getState() {
      return state;
    },
  };
}
