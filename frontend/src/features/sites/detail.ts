import { ApiClientError } from "@/src/lib/api";
import type { SiteDetailFeature } from "./types";
import type { ViewportErrorInfo } from "./viewport";

export type SiteDetailLoadStatus = "idle" | "loading" | "ready" | "error";

export interface SiteDetailState {
  status: SiteDetailLoadStatus;
  selectedCode: string | null;
  data: SiteDetailFeature | null;
  error: ViewportErrorInfo | null;
}

export interface SiteDetailFetchRequest {
  code: string;
  signal: AbortSignal;
}

export interface SiteDetailControllerOptions {
  fetchSiteDetail: (request: SiteDetailFetchRequest) => Promise<SiteDetailFeature>;
  onStateChange: (state: SiteDetailState) => void;
}

export interface SiteDetailController {
  select: (code: string) => void;
  retry: () => void;
  clear: () => void;
  dispose: () => void;
  getState: () => SiteDetailState;
}

export const INITIAL_SITE_DETAIL_STATE: SiteDetailState = {
  status: "idle",
  selectedCode: null,
  data: null,
  error: null,
};

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function toDetailError(error: unknown): ViewportErrorInfo {
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
      message: error.message || "Unable to load details for this site.",
    };
  }
  return {
    code: "UNKNOWN_ERROR",
    message: "Unable to load details for this site.",
  };
}

export function createSiteDetailController(
  options: SiteDetailControllerOptions,
): SiteDetailController {
  let disposed = false;
  let requestSequence = 0;
  let activeAbortController: AbortController | null = null;
  let state: SiteDetailState = { ...INITIAL_SITE_DETAIL_STATE };

  function emit(next: SiteDetailState): void {
    state = next;
    if (!disposed) {
      options.onStateChange(next);
    }
  }

  function abortActive(): void {
    if (activeAbortController) {
      activeAbortController.abort();
      activeAbortController = null;
    }
  }

  function load(code: string): void {
    if (disposed) return;

    const seq = ++requestSequence;
    abortActive();
    const abortController = new AbortController();
    activeAbortController = abortController;

    const keepSameSiteData = state.data?.properties.code === code ? state.data : null;

    emit({
      status: "loading",
      selectedCode: code,
      data: keepSameSiteData,
      error: null,
    });

    options
      .fetchSiteDetail({ code, signal: abortController.signal })
      .then((detail) => {
        if (disposed || seq !== requestSequence) {
          return;
        }
        if (activeAbortController === abortController) {
          activeAbortController = null;
        }
        emit({
          status: "ready",
          selectedCode: code,
          data: detail,
          error: null,
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
          selectedCode: code,
          data: keepSameSiteData,
          error: toDetailError(error),
        });
      });
  }

  return {
    select(code) {
      load(code);
    },

    retry() {
      if (disposed || !state.selectedCode) return;
      load(state.selectedCode);
    },

    clear() {
      if (disposed) return;
      requestSequence += 1;
      abortActive();
      emit({ ...INITIAL_SITE_DETAIL_STATE });
    },

    dispose() {
      disposed = true;
      requestSequence += 1;
      abortActive();
    },

    getState() {
      return state;
    },
  };
}
