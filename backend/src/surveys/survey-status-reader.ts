import { Inject, Injectable } from '@nestjs/common';
import { SURVEY_STATUS_READER_PORT, type SurveyStatusReaderPort } from './survey-status-reader.port';

export interface LatestSurveySummary {
  survey_ref: string | null;
  surveyed_on: string;
  cover_percent: number;
}

@Injectable()
export class SurveyStatusReader {
  constructor(@Inject(SURVEY_STATUS_READER_PORT) private readonly surveys: SurveyStatusReaderPort) {}

  latestCoverPercentages(siteIds: readonly string[]): Promise<ReadonlyMap<string, readonly number[]>> {
    return this.surveys.latestCoverPercentages(siteIds);
  }

  latestSurvey(siteId: string): Promise<LatestSurveySummary | null> {
    return this.surveys.latestSurvey(siteId);
  }
}
