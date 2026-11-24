import { infiniteQueryOptions } from "@tanstack/react-query";
import { ApiClientError } from "@/src/lib/api";
import { fetchSiteSurveys } from "../api";

export const surveyQueryKeys = {
  all: ["surveys"] as const,
  history: (siteCode: string) => ["surveys", "history", siteCode] as const,
};

export function surveyHistoryQueryOptions(
  code: string,
  token: string,
  pageSize: number,
  fetchImpl?: typeof fetch,
  onUnauthorized?: (message: string, token: string) => void,
) {
  return infiniteQueryOptions({
    queryKey: surveyQueryKeys.history(code),
    queryFn: async ({ pageParam, signal }) => {
      try {
        return await fetchSiteSurveys({
          code,
          page: pageParam,
          pageSize,
          token,
          signal,
          fetchImpl,
        });
      } catch (error) {
        if (error instanceof ApiClientError && error.status === 401) {
          onUnauthorized?.(error.message, token);
        }
        throw error;
      }
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.page * (lastPage.pageSize ?? pageSize) < lastPage.total
        ? lastPage.page + 1
        : undefined,
    staleTime: 30_000,
  });
}
