import { apiFetch } from "@/src/lib/api";
import {
  DEFAULT_SURVEY_PAGE_SIZE,
  type SurveyPageResponse,
} from "./types";

export interface FetchSiteSurveysParams {
  code: string;
  page?: number;
  pageSize?: number;
  token: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

export async function fetchSiteSurveys({
  code,
  page = 1,
  pageSize = DEFAULT_SURVEY_PAGE_SIZE,
  token,
  signal,
  fetchImpl,
}: FetchSiteSurveysParams): Promise<SurveyPageResponse> {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  return apiFetch<SurveyPageResponse>(
    `/sites/${encodeURIComponent(code)}/surveys?${params.toString()}`,
    {
      token,
      signal,
      fetchImpl,
    },
  );
}
