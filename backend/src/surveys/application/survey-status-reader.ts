import type { SurveyStatusReaderPort } from './survey-status-reader.port';

export interface LatestSurveySummary extends Record<string, unknown> {
  survey_ref: string | null;
  surveyed_on: string;
  cover_percent: number;
}

export class SurveyStatusReader {
  constructor(private readonly surveys: SurveyStatusReaderPort) {}

  latestCoverPercentages(siteIds: readonly string[]): Promise<ReadonlyMap<string, readonly number[]>> {
    return this.surveys.latestCoverPercentages(siteIds);
  }

  latestSurvey(siteId: string): Promise<LatestSurveySummary | null> {
    return this.surveys.latestSurvey(siteId);
  }
}
