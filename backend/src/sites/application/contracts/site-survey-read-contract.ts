import type { SiteStatus } from '../../domain/site-status';

export interface SiteSurveyReadContract {
  statuses(siteIds: readonly string[]): Promise<Map<string, SiteStatus>>;
  latestSurvey(siteId: string): Promise<{ survey_ref: string | null; surveyed_on: string; cover_percent: number } | null>;
}
