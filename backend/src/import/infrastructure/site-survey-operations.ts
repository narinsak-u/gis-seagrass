import type { DatabaseProvider } from '../../platform/database';
import { SiteSurveyCoordinator } from '../../site-survey';
import { createSiteSurveyTransactionRunner } from '../../site-survey/infrastructure/drizzle-transaction-runner';
import { createSiteWritePort } from '../../sites/infrastructure/sites-infrastructure.module';
import { createSurveyWriteAdapters } from '../../surveys/infrastructure/surveys-infrastructure.module';
import { SurveyWriter } from '../../surveys';
export function createSiteSurveyImportOperations(db: DatabaseProvider['db']): {
  coordinator: SiteSurveyCoordinator;
  surveyWriter: SurveyWriter;
} {
  const adapters = createSurveyWriteAdapters(db);
  const coordinator = new SiteSurveyCoordinator(
    adapters.statusReader,
    createSiteSurveyTransactionRunner(db),
    createSiteWritePort(),
    adapters.constraints,
  );
  return { coordinator, surveyWriter: new SurveyWriter(coordinator, adapters.surveyWriter) };
}
