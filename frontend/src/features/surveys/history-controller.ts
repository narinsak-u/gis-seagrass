import { ApiClientError } from "@/src/lib/api";
import type { ActorRole } from "@/src/features/auth/auth-session";
import {
  buildSurveyPointCollection,
  DEFAULT_SURVEY_PAGE_SIZE,
  EMPTY_SURVEY_POINT_COLLECTION,
  isAuthorizedSurveyRole,
  type SurveyListItem,
  type SurveyPageResponse,
  type SurveyPointFeatureCollection,
} from "./types";

export type SurveyHistoryStatus =
  | "idle"
  | "unauthenticated"
  | "unauthorized_role"
  | "loading"
  | "loading_more"
  | "ready"
  | "empty"
  | "forbidden"
  | "error";

export interface SurveyHistoryError {
  code: string;
  message: string;
  status?: number;
}

export interface SurveyHistoryState {
  status: SurveyHistoryStatus;
  siteCode: string | null;
  items: SurveyListItem[];
  points: SurveyPointFeatureCollection;
  total: number;
  loadedPages: number;
  pageSize: number;
  hasMore: boolean;
  isPartialCoverage: boolean;
  error: SurveyHistoryError | null;
}

export interface SurveyHistoryContext {
  siteCode: string | null;
  token: string | null;
  role: ActorRole | string | null | undefined;
}

export interface SurveyHistoryFetchRequest {
  code: string;
  page: number;
  pageSize: number;
  token: string;
  signal: AbortSignal;
}

export interface SurveyHistoryControllerOptions {
  fetchSurveys: (request: SurveyHistoryFetchRequest) => Promise<SurveyPageResponse>;
  onStateChange: (state: SurveyHistoryState) => void;
  onUnauthorized?: (message: string) => void;
  pageSize?: number;
}

export interface SurveyHistoryController {
  syncContext(context: SurveyHistoryContext): void;
  loadNextPage(): void;
  retry(): void;
  clear(): void;
  dispose(): void;
  getState(): SurveyHistoryState;
}

export const INITIAL_SURVEY_HISTORY_STATE: SurveyHistoryState = {
  status: "idle",
  siteCode: null,
  items: [],
  points: EMPTY_SURVEY_POINT_COLLECTION,
  total: 0,
  loadedPages: 0,
  pageSize: DEFAULT_SURVEY_PAGE_SIZE,
  hasMore: false,
  isPartialCoverage: false,
  error: null,
};

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function toHistoryError(error: unknown): SurveyHistoryError {
  if (error instanceof ApiClientError) {
    return {
      code: error.code,
      message: error.message,
      status: error.status,
    };
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return {
      code: "NETWORK_ERROR",
      message: error.message,
    };
  }
  return {
    code: "NETWORK_ERROR",
    message: "Unable to load survey history for this site.",
  };
}

function mergeDeduplicatedItems(
  existing: readonly SurveyListItem[],
  incoming: readonly SurveyListItem[],
): SurveyListItem[] {
  const seen = new Set<string>();
  const merged: SurveyListItem[] = [];

  for (const item of existing) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      merged.push(item);
    }
  }

  for (const item of incoming) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      merged.push(item);
    }
  }

  return merged;
}

export function createSurveyHistoryController(
  options: SurveyHistoryControllerOptions,
): SurveyHistoryController {
  const pageSize = options.pageSize ?? DEFAULT_SURVEY_PAGE_SIZE;

  let disposed = false;
  let requestSequence = 0;
  let activeAbortController: AbortController | null = null;
  let failedPage: number | null = null;

  let activeContext: {
    siteCode: string | null;
    token: string | null;
    role: ActorRole | null;
  } = {
    siteCode: null,
    token: null,
    role: null,
  };

  let state: SurveyHistoryState = {
    ...INITIAL_SURVEY_HISTORY_STATE,
    pageSize,
  };

  function emit(next: SurveyHistoryState): void {
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

  function resetEmptyState(
    status: SurveyHistoryStatus,
    siteCode: string | null,
    error: SurveyHistoryError | null = null,
  ): void {
    failedPage = null;
    emit({
      status,
      siteCode,
      items: [],
      points: EMPTY_SURVEY_POINT_COLLECTION,
      total: 0,
      loadedPages: 0,
      pageSize,
      hasMore: false,
      isPartialCoverage: false,
      error,
    });
  }

  function fetchPage(code: string, token: string, page: number): void {
    if (disposed) return;

    const seq = ++requestSequence;
    abortActive();
    const abortController = new AbortController();
    activeAbortController = abortController;
    failedPage = null;

    const isInitialPage = page === 1;
    const baseItems = isInitialPage ? [] : state.items;
    const basePoints = isInitialPage
      ? EMPTY_SURVEY_POINT_COLLECTION
      : state.points;

    emit({
      status: isInitialPage ? "loading" : "loading_more",
      siteCode: code,
      items: baseItems,
      points: basePoints,
      total: isInitialPage ? 0 : state.total,
      loadedPages: isInitialPage ? 0 : state.loadedPages,
      pageSize,
      hasMore: isInitialPage ? false : state.hasMore,
      isPartialCoverage: isInitialPage ? false : state.isPartialCoverage,
      error: null,
    });

    options
      .fetchSurveys({
        code,
        page,
        pageSize,
        token,
        signal: abortController.signal,
      })
      .then((response) => {
        if (disposed || seq !== requestSequence || abortController.signal.aborted) {
          return;
        }
        if (activeAbortController === abortController) {
          activeAbortController = null;
        }

        const incomingItems = Array.isArray(response.items) ? response.items : [];
        const mergedItems = isInitialPage
          ? mergeDeduplicatedItems([], incomingItems)
          : mergeDeduplicatedItems(baseItems, incomingItems);
        const total = typeof response.total === "number" ? response.total : mergedItems.length;

        if (total === 0 || (isInitialPage && mergedItems.length === 0)) {
          resetEmptyState("empty", code, null);
          return;
        }

        const hasMore = mergedItems.length < total && incomingItems.length > 0;
        const isPartialCoverage = mergedItems.length > 0 && mergedItems.length < total;
        const points = buildSurveyPointCollection(code, mergedItems);

        emit({
          status: "ready",
          siteCode: code,
          items: mergedItems,
          points,
          total,
          loadedPages: page,
          pageSize,
          hasMore,
          isPartialCoverage,
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

        if (error instanceof ApiClientError && error.status === 401) {
          requestSequence += 1;
          activeContext = { siteCode: code, token: null, role: null };
          resetEmptyState("unauthenticated", code, null);
          options.onUnauthorized?.(error.message);
          return;
        }

        if (error instanceof ApiClientError && error.status === 403) {
          requestSequence += 1;
          resetEmptyState("forbidden", code, {
            code: error.code,
            message: error.message,
            status: 403,
          });
          return;
        }

        failedPage = page;
        const parsedError = toHistoryError(error);
        if (isInitialPage) {
          emit({
            status: "error",
            siteCode: code,
            items: [],
            points: EMPTY_SURVEY_POINT_COLLECTION,
            total: 0,
            loadedPages: 0,
            pageSize,
            hasMore: false,
            isPartialCoverage: false,
            error: parsedError,
          });
          return;
        }

        emit({
          ...state,
          status: "error",
          siteCode: code,
          items: baseItems,
          points: basePoints,
          error: parsedError,
        });
      });
  }

  function syncContext(context: SurveyHistoryContext): void {
    if (disposed) return;

    const normalizedCode = context.siteCode?.trim() || null;
    const normalizedToken = context.token?.trim() || null;
    const rawRole = context.role;

    if (!normalizedCode) {
      const alreadyIdle =
        state.status === "idle" &&
        state.siteCode === null &&
        state.items.length === 0 &&
        activeContext.siteCode === null;
      activeContext = { siteCode: null, token: null, role: null };
      if (!alreadyIdle) {
        requestSequence += 1;
        abortActive();
        resetEmptyState("idle", null, null);
      }
      return;
    }

    if (!normalizedToken) {
      const alreadyUnauth =
        state.status === "unauthenticated" &&
        state.siteCode === normalizedCode &&
        state.items.length === 0 &&
        activeContext.siteCode === normalizedCode &&
        activeContext.token === null;
      activeContext = { siteCode: normalizedCode, token: null, role: null };
      if (!alreadyUnauth) {
        requestSequence += 1;
        abortActive();
        resetEmptyState("unauthenticated", normalizedCode, null);
      }
      return;
    }

    if (!isAuthorizedSurveyRole(rawRole)) {
      const alreadyUnauthorized =
        state.status === "unauthorized_role" &&
        state.siteCode === normalizedCode &&
        state.items.length === 0;
      activeContext = { siteCode: normalizedCode, token: null, role: null };
      if (!alreadyUnauthorized) {
        requestSequence += 1;
        abortActive();
        resetEmptyState("unauthorized_role", normalizedCode, {
          code: "FORBIDDEN",
          message: "Your current role does not have permission to view survey history.",
          status: 403,
        });
      }
      return;
    }

    const sameAuthorizedContext =
      activeContext.siteCode === normalizedCode &&
      activeContext.token === normalizedToken &&
      activeContext.role === rawRole &&
      state.status !== "idle" &&
      state.status !== "unauthenticated" &&
      state.status !== "unauthorized_role";

    if (sameAuthorizedContext) {
      return;
    }

    activeContext = {
      siteCode: normalizedCode,
      token: normalizedToken,
      role: rawRole,
    };
    fetchPage(normalizedCode, normalizedToken, 1);
  }

  function loadNextPage(): void {
    if (disposed) return;
    if (!activeContext.siteCode || !activeContext.token || !activeContext.role) {
      return;
    }
    if (state.status !== "ready" || !state.hasMore) {
      return;
    }
    fetchPage(activeContext.siteCode, activeContext.token, state.loadedPages + 1);
  }

  function retry(): void {
    if (disposed) return;
    if (!activeContext.siteCode || !activeContext.token || !activeContext.role) {
      return;
    }
    if (state.status !== "error") {
      return;
    }
    const targetPage = failedPage ?? 1;
    fetchPage(activeContext.siteCode, activeContext.token, targetPage);
  }

  function clear(): void {
    if (disposed) return;
    requestSequence += 1;
    abortActive();
    activeContext = { siteCode: null, token: null, role: null };
    resetEmptyState("idle", null, null);
  }

  function dispose(): void {
    disposed = true;
    requestSequence += 1;
    abortActive();
  }

  return {
    syncContext,
    loadNextPage,
    retry,
    clear,
    dispose,
    getState() {
      return state;
    },
  };
}
