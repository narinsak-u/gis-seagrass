import type { SiteWriteTransaction } from '../../../site-survey-workflows';

export interface SiteSurveyConstraintRepository {
  hasSurveys(tx: SiteWriteTransaction, siteId: string): Promise<boolean>;
  hasSurveysOutside(tx: SiteWriteTransaction, siteId: string, geometry: string): Promise<boolean>;
}

export const SITE_SURVEY_CONSTRAINT_REPOSITORY = Symbol('SITE_SURVEY_CONSTRAINT_REPOSITORY');
