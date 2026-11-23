import type { SiteWriteTransaction } from '../sites/site-write.port';

export interface SiteSurveyConstraintsPort {
  hasSurveys(tx: SiteWriteTransaction, siteId: string): Promise<boolean>;
  hasSurveysOutside(tx: SiteWriteTransaction, siteId: string, geometry: string): Promise<boolean>;
}

export const SITE_SURVEY_CONSTRAINTS_PORT = Symbol('SITE_SURVEY_CONSTRAINTS_PORT');
