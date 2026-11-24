import { type DynamicModule, Module } from '@nestjs/common';
import { SITE_WRITE_REPOSITORY, type SiteWriteRepository } from '../sites';
import {
  SITE_SURVEY_CONSTRAINT_REPOSITORY,
  SURVEY_STATUS_REPOSITORY,
  SURVEY_WRITE_REPOSITORY,
  SurveyCommands,
  type SiteSurveyConstraintRepository,
  type SurveyStatusRepository,
  type SurveyWriteRepository,
} from '../surveys';
import { DrizzleSiteWriteRepository } from '../sites/infrastructure/drizzle-site-write.repository';
import { DrizzleSiteSurveyConstraintRepository } from '../surveys/infrastructure/drizzle-site-survey-constraint.repository';
import { DrizzleSurveyStatusRepository } from '../surveys/infrastructure/drizzle-survey-status.repository';
import { DrizzleSurveyWriteRepository } from '../surveys/infrastructure/drizzle-survey-write.repository';
import { SITE_SURVEY_TRANSACTION_RUNNER, type SiteSurveyTransactionRunner } from './application/transaction-runner.port';
import { SiteSurveyCoordinator } from './application/site-survey-coordinator';
import { DrizzleSiteSurveyTransactionRunner, SITE_SURVEY_TRANSACTION_RUNNER_PROVIDER } from './infrastructure/drizzle-transaction-runner';

@Module({})
export class SiteSurveyModule {
  static register(databaseModule: DynamicModule): DynamicModule {
    return {
      module: SiteSurveyModule,
      imports: [databaseModule],
      providers: [
        DrizzleSiteWriteRepository,
        { provide: SITE_WRITE_REPOSITORY, useExisting: DrizzleSiteWriteRepository },
        DrizzleSiteSurveyConstraintRepository,
        { provide: SITE_SURVEY_CONSTRAINT_REPOSITORY, useExisting: DrizzleSiteSurveyConstraintRepository },
        DrizzleSurveyStatusRepository,
        { provide: SURVEY_STATUS_REPOSITORY, useExisting: DrizzleSurveyStatusRepository },
        DrizzleSurveyWriteRepository,
        { provide: SURVEY_WRITE_REPOSITORY, useExisting: DrizzleSurveyWriteRepository },
        DrizzleSiteSurveyTransactionRunner,
        SITE_SURVEY_TRANSACTION_RUNNER_PROVIDER,
        {
          provide: SiteSurveyCoordinator,
          useFactory: (
            surveys: SurveyStatusRepository,
            transactions: SiteSurveyTransactionRunner,
            sites: SiteWriteRepository,
            constraints: SiteSurveyConstraintRepository,
          ) => new SiteSurveyCoordinator(surveys, transactions, sites, constraints),
          inject: [SURVEY_STATUS_REPOSITORY, SITE_SURVEY_TRANSACTION_RUNNER, SITE_WRITE_REPOSITORY, SITE_SURVEY_CONSTRAINT_REPOSITORY],
        },
        {
          provide: SurveyCommands,
          useFactory: (coordinator: SiteSurveyCoordinator, writer: SurveyWriteRepository) => new SurveyCommands(coordinator, writer),
          inject: [SiteSurveyCoordinator, SURVEY_WRITE_REPOSITORY],
        },
      ],
      exports: [SiteSurveyCoordinator, SurveyCommands],
    };
  }
}
