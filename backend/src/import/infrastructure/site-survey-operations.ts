import type { DatabaseProvider } from '../../platform/database';
import { SiteSurveyCoordinator } from '../../site-survey';
import { createSiteSurveyTransactionRunner } from '../../site-survey/infrastructure/drizzle-transaction-runner';
import { DrizzleSiteWriteStore } from '../../sites/infrastructure/drizzle-site-write-store';
import { DrizzleSiteSurveyConstraints } from '../../surveys/infrastructure/drizzle-site-survey-constraints';
import { DrizzleSurveyStatusReader } from '../../surveys/infrastructure/drizzle-survey-status-reader';
import { DrizzleSurveyWriteStore } from '../../surveys/infrastructure/drizzle-survey-write-store';
import { SurveyWriter } from '../../surveys';

export function createSiteSurveyImportOperations(db: DatabaseProvider['db']): {
  coordinator: SiteSurveyCoordinator;
  surveyWriter: SurveyWriter;
} {
  const coordinator = new SiteSurveyCoordinator(
    new DrizzleSurveyStatusReader(db),
    createSiteSurveyTransactionRunner(db),
    new DrizzleSiteWriteStore(),
    new DrizzleSiteSurveyConstraints(),
  );
  return { coordinator, surveyWriter: new SurveyWriter(coordinator, new DrizzleSurveyWriteStore()) };
}
