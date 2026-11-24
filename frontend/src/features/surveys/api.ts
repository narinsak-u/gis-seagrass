import { apiRequest, ApiClientError } from "@/src/lib/api";
import { DEFAULT_SURVEY_PAGE_SIZE, type SurveyPageResponse } from "./types";
import { surveyPageSchema } from "./schema";

export interface FetchSiteSurveysParams {
  code: string;
  page?: number;
  pageSize?: number;
  token: string;
  signal?: AbortSignal;
}

export async function fetchSiteSurveys({
  code,
  page = 1,
  pageSize = DEFAULT_SURVEY_PAGE_SIZE,
  token,
  signal,
}: FetchSiteSurveysParams): Promise<SurveyPageResponse> {
  const payload = await apiRequest<unknown>(
    `/sites/${encodeURIComponent(code)}/surveys`,
    { params: { page, pageSize }, token, signal },
  );
  const result = surveyPageSchema.safeParse(payload);
  if (!result.success) {
    throw new ApiClientError(
      0,
      "INVALID_API_RESPONSE",
      "The API returned an invalid Survey page response",
    );
  }
  return result.data;
}
