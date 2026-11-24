import { infiniteQueryOptions } from "@tanstack/react-query";
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
) {
  return infiniteQueryOptions({
    queryKey: surveyQueryKeys.history(code),
    queryFn: ({ pageParam, signal }) =>
      fetchSiteSurveys({
        code,
        page: pageParam,
        pageSize,
        token,
        signal,
        fetchImpl,
      }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.page * (lastPage.pageSize ?? pageSize) < lastPage.total
        ? lastPage.page + 1
        : undefined,
    staleTime: 30_000,
  });
}
