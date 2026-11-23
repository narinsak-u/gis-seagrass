import type { DatabaseProvider } from '../../platform/database';
import { SiteSurveyCoordinator } from '../../site-survey';
import { DrizzleSiteSurveyTransactionRunner } from '../../site-survey/infrastructure';
import { DrizzleSiteWriteStore } from '../../sites/infrastructure';
import { DrizzleSiteSurveyConstraints, DrizzleSurveyStatusReader, DrizzleSurveyWriteStore } from '../../surveys/infrastructure';
import { SurveyStatusReader, SurveyWriter } from '../../surveys';

export function createSiteSurveyImportOperations(db: DatabaseProvider['db']): {
  coordinator: SiteSurveyCoordinator;
  surveyWriter: SurveyWriter;
} {
  const coordinator = new SiteSurveyCoordinator(
    new SurveyStatusReader(new DrizzleSurveyStatusReader(db)),
    new DrizzleSiteSurveyTransactionRunner(db),
    new DrizzleSiteWriteStore(),
    new DrizzleSiteSurveyConstraints(),
  );
  return { coordinator, surveyWriter: new SurveyWriter(coordinator, new DrizzleSurveyWriteStore()) };
}
