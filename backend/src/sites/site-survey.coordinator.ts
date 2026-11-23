import { Injectable } from '@nestjs/common';
import { deriveSiteStatus, type SiteStatus } from '../domain/site-status';
import { SurveyStatusReader, type LatestSurveySummary } from '../surveys/survey-status-reader';

@Injectable()
export class SiteSurveyCoordinator {
  constructor(private readonly surveys: SurveyStatusReader) {}

  async statuses(siteIds: readonly string[]): Promise<Map<string, SiteStatus>> {
    const coverPercentages = await this.surveys.latestCoverPercentages(siteIds);
    return new Map(siteIds.map((siteId) => [siteId, deriveSiteStatus(coverPercentages.get(siteId) ?? [])]));
  }

  latestSurvey(siteId: string): Promise<LatestSurveySummary | null> {
    return this.surveys.latestSurvey(siteId);
  }
}
