export interface LatestSurveySummary extends Record<string, unknown> {
  survey_ref: string | null;
  surveyed_on: string;
  cover_percent: number;
}


export const SURVEY_STATUS_REPOSITORY = Symbol('SURVEY_STATUS_REPOSITORY');

export interface SurveyStatusRepository {
  latestCoverPercentages(siteIds: readonly string[]): Promise<ReadonlyMap<string, readonly number[]>>;
  latestSurvey(siteId: string): Promise<LatestSurveySummary | null>;
}
