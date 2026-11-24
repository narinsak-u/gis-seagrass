import { queryOptions } from "@tanstack/react-query";
import { fetchSiteDetail } from "@/src/lib/api";

export const siteQueryKeys = {
  detail: (code: string) => ["sites", "detail", code] as const,
};

export function siteDetailQueryOptions(code: string) {
  return queryOptions({
    queryKey: siteQueryKeys.detail(code),
    queryFn: ({ signal }) => fetchSiteDetail({ code, signal }),
    staleTime: 30_000,
  });
}
