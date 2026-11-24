import { infiniteQueryOptions } from "@tanstack/react-query";
import { ApiClientError } from "@/src/lib/api";
import { fetchSiteSurveys } from "../api";

export const surveyQueryKeys = {
  all: ["surveys"] as const,
  history: (sessionEpoch: number, siteCode: string, pageSize: number) =>
    ["surveys", "history", sessionEpoch, siteCode, pageSize] as const,
};

export function surveyHistoryQueryOptions(
  code: string,
  token: string,
  sessionEpoch: number,
  pageSize: number,
  onUnauthorized?: (message: string, token: string, expectedEpoch: number) => void,
) {
  return infiniteQueryOptions({
    queryKey: surveyQueryKeys.history(sessionEpoch, code, pageSize),
    queryFn: async ({ pageParam, signal }) => {
      try {
        return await fetchSiteSurveys({
          code,
          page: pageParam,
          pageSize,
          token,
          signal,
        });
      } catch (error) {
        if (error instanceof ApiClientError && error.status === 401) {
          onUnauthorized?.(error.message, token, sessionEpoch);
        }
        throw error;
      }
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.page < Math.ceil(lastPage.total / lastPage.pageSize)
        ? lastPage.page + 1
        : undefined,
    staleTime: 30_000,
  });
}
