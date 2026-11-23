import type { DatabaseProvider } from '../../database/provider';
import { SiteSurveyCoordinator } from '../../site-survey/site-survey.coordinator';
import { DrizzleSiteWriteStore } from '../../sites/infrastructure/drizzle-site-write-store';
import { DrizzleSiteSurveyConstraints } from '../../surveys/infrastructure/drizzle-site-survey-constraints';
import { DrizzleSurveyStatusReader } from '../../surveys/infrastructure/drizzle-survey-status-reader';
import { DrizzleSurveyWriteStore } from '../../surveys/infrastructure/drizzle-survey-write-store';
import { SurveyStatusReader } from '../../surveys/survey-status-reader';
import { SurveyWriter } from '../../surveys/survey-writer';

export function createSiteSurveyImportOperations(db: DatabaseProvider['db']): {
  coordinator: SiteSurveyCoordinator;
  surveyWriter: SurveyWriter;
} {
  const coordinator = new SiteSurveyCoordinator(
    new SurveyStatusReader(new DrizzleSurveyStatusReader(db)),
    db,
    new DrizzleSiteWriteStore(),
    new DrizzleSiteSurveyConstraints(),
  );
  return { coordinator, surveyWriter: new SurveyWriter(coordinator, new DrizzleSurveyWriteStore()) };
}
