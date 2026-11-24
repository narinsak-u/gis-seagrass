import { ApiClientError } from "@/src/lib/api";
import type { BboxBounds } from "@/src/features/sites/types";
import {
  formatBbox,
  normalizeBboxBounds,
  type TimerScheduler,
  type ViewportErrorInfo,
  type ViewportLoadStatus,
} from "@/src/features/sites/viewport";
import type { ProvinceFeatureCollection } from "./types";

export interface ViewportProvincesState {
  status: ViewportLoadStatus;
  data: ProvinceFeatureCollection | null;
  error: ViewportErrorInfo | null;
  bbox: BboxBounds | null;
  bboxString: string | null;
}

export interface ViewportProvincesFetchRequest {
  bbox: string;
  bounds: BboxBounds;
  signal: AbortSignal;
}

export interface ViewportProvincesControllerOptions {
  debounceMs?: number;
  fetchProvinces: (
    request: ViewportProvincesFetchRequest,
  ) => Promise<ProvinceFeatureCollection>;
  onStateChange: (state: ViewportProvincesState) => void;
  scheduler?: TimerScheduler;
}

export interface ViewportProvincesController {
  loadInitial: (bounds: BboxBounds) => void;
  onViewportSettled: (bounds: BboxBounds) => void;
  retry: () => void;
  dispose: () => void;
  getState: () => ViewportProvincesState;
}

const DEFAULT_DEBOUNCE_MS = 250;

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
      message: error.message || "Unable to load province boundaries for this map view.",
    };
  }
  return {
    code: "UNKNOWN_ERROR",
    message: "Unable to load province boundaries for this map view.",
  };
}

const defaultScheduler: TimerScheduler = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms) as unknown as number,
  clearTimeout: (id) =>
    globalThis.clearTimeout(id as unknown as ReturnType<typeof setTimeout>),
};

export function createViewportProvincesController(
  options: ViewportProvincesControllerOptions,
): ViewportProvincesController {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const scheduler = options.scheduler ?? defaultScheduler;

  let disposed = false;
  let requestSequence = 0;
  let debounceTimerId: number | null = null;
  let activeAbortController: AbortController | null = null;
  let lastBounds: BboxBounds | null = null;

  let state: ViewportProvincesState = {
    status: "idle",
    data: null,
    error: null,
    bbox: null,
    bboxString: null,
  };

  function emit(next: ViewportProvincesState): void {
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

  function executeFetch(bounds: BboxBounds): void {
    if (disposed) return;

    const normalizedBounds = normalizeBboxBounds(bounds);
    const bboxString = formatBbox(normalizedBounds);
    lastBounds = normalizedBounds;

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
    });

    options
      .fetchProvinces({
        bbox: bboxString,
        bounds: normalizedBounds,
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
        });
      });
  }

  return {
    loadInitial(bounds) {
      if (disposed) return;
      clearPendingTimer();
      executeFetch(bounds);
    },

    onViewportSettled(bounds) {
      if (disposed) return;
      const normalizedBounds = normalizeBboxBounds(bounds);
      lastBounds = normalizedBounds;
      requestSequence += 1;
      abortActiveRequest();
      clearPendingTimer();
      debounceTimerId = scheduler.setTimeout(() => {
        debounceTimerId = null;
        executeFetch(normalizedBounds);
      }, debounceMs);
    },

    retry() {
      if (disposed || !lastBounds) return;
      clearPendingTimer();
      executeFetch(lastBounds);
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
