import type { DatabaseProvider } from '../../platform/database';
import { SiteSurveyCoordinator } from '../../site-survey-workflows';
import { createSiteSurveyTransactionRunner } from '../../site-survey-workflows/infrastructure/transactions/drizzle-transaction-runner';
import { DrizzleSiteWriteRepository } from '../../sites/infrastructure/drizzle-site-write.repository';
import { DrizzleSiteSurveyConstraintRepository } from '../../surveys/infrastructure/repositories/drizzle-site-survey-constraint-repository';
import { DrizzleSurveyStatusRepository } from '../../surveys/infrastructure/repositories/drizzle-survey-status-repository';
import { DrizzleSurveyWriteRepository } from '../../surveys/infrastructure/repositories/drizzle-survey-write-repository';
import { SurveyCommands } from '../../surveys';

export function createSiteSurveyImportOperations(db: DatabaseProvider['db']): {
  coordinator: SiteSurveyCoordinator;
  surveyCommands: SurveyCommands;
} {
  const coordinator = new SiteSurveyCoordinator(
    new DrizzleSurveyStatusRepository(db),
    createSiteSurveyTransactionRunner(db),
    new DrizzleSiteWriteRepository(),
    new DrizzleSiteSurveyConstraintRepository(),
  );
  return { coordinator, surveyCommands: new SurveyCommands(coordinator, new DrizzleSurveyWriteRepository()) };
}
