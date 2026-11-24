"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import type { ActorRole } from "@/src/features/auth/auth-session";
import { ApiClientError } from "@/src/lib/api";
import {
  INITIAL_SURVEY_HISTORY_STATE,
  type SurveyHistoryState,
} from "../history-controller";
import {
  buildSurveyPointCollection,
  DEFAULT_SURVEY_PAGE_SIZE,
  isAuthorizedSurveyRole,
} from "../types";
import { surveyHistoryQueryOptions } from "./survey-history-query";

interface UseSurveyHistoryOptions {
  siteCode: string | null;
  token: string | null;
  role: ActorRole | string | null | undefined;
  onUnauthorized: (message: string, token: string) => void;
  pageSize?: number;
}

export function useSurveyHistory({
  siteCode,
  token,
  role,
  onUnauthorized,
  pageSize = DEFAULT_SURVEY_PAGE_SIZE,
}: UseSurveyHistoryOptions) {
  const authorized = Boolean(siteCode && token && isAuthorizedSurveyRole(role));
  const query = useInfiniteQuery({
    ...surveyHistoryQueryOptions(
      siteCode ?? "",
      token ?? "",
      pageSize,
      undefined,
      onUnauthorized,
    ),
    enabled: authorized,
  });

  const items = authorized
    ? query.data?.pages.flatMap((page) => page.items) ?? []
    : [];
  const total = authorized ? query.data?.pages[0]?.total ?? 0 : 0;
  const hasMore = authorized && Boolean(query.hasNextPage);
  const error = query.error;

  let status: SurveyHistoryState["status"] = "idle";
  if (siteCode && !token) {
    status = "unauthenticated";
  } else if (siteCode && token && !isAuthorizedSurveyRole(role)) {
    status = "unauthorized_role";
  } else if (authorized && query.isFetchingNextPage) {
    status = "loading_more";
  } else if (authorized && query.isPending) {
    status = "loading";
  } else if (authorized && query.isError) {
    status = error instanceof ApiClientError && error.status === 403
      ? "forbidden"
      : "error";
  } else if (authorized) {
    status = items.length === 0 ? "empty" : "ready";
  }

  const state: SurveyHistoryState = {
    status,
    siteCode,
    items,
    points: buildSurveyPointCollection(siteCode, items),
    total,
    loadedPages: authorized ? query.data?.pages.length ?? 0 : 0,
    pageSize,
    hasMore,
    isPartialCoverage: hasMore,
    error:
      error instanceof ApiClientError
        ? { code: error.code, message: error.message, status: error.status }
        : error instanceof Error
          ? { code: "NETWORK_ERROR", message: error.message }
          : null,
  };

  return {
    state: siteCode ? state : INITIAL_SURVEY_HISTORY_STATE,
    loadMore: () => query.fetchNextPage(),
    retry: () =>
      query.isFetchNextPageError ? query.fetchNextPage() : query.refetch(),
  };
}
