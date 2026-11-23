import type { LatestSurveySummary } from './survey-status-reader';

export const SURVEY_STATUS_READER_PORT = Symbol('SURVEY_STATUS_READER_PORT');

export interface SurveyStatusReaderPort {
  latestCoverPercentages(siteIds: readonly string[]): Promise<ReadonlyMap<string, readonly number[]>>;
  latestSurvey(siteId: string): Promise<LatestSurveySummary | null>;
}
