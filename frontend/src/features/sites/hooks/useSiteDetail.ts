"use client";

import { useQuery } from "@tanstack/react-query";
import { ApiClientError } from "@/src/lib/api";
import {
  INITIAL_SITE_DETAIL_STATE,
  type SiteDetailState,
} from "../detail";
import { siteDetailQueryOptions } from "./site-detail-query";

export function useSiteDetail(siteCode: string | null) {
  const query = useQuery({
    ...siteDetailQueryOptions(siteCode ?? ""),
    enabled: siteCode !== null,
  });

  let state: SiteDetailState = INITIAL_SITE_DETAIL_STATE;
  if (siteCode !== null) {
    const error = query.error;
    state = {
      status: query.isError ? "error" : query.isPending ? "loading" : "ready",
      selectedCode: siteCode,
      data: query.data ?? null,
      error:
        error instanceof ApiClientError
          ? { code: error.code, message: error.message, status: error.status }
          : error instanceof Error
            ? { code: "NETWORK_ERROR", message: error.message }
            : null,
    };
  }

  return {
    state,
    retry: () => query.refetch(),
  };
}
