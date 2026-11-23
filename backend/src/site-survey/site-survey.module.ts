import { Module } from '@nestjs/common';
import { SITE_WRITE_PORT, type SiteWritePort } from '../sites';
import {
  SITE_SURVEY_CONSTRAINTS_PORT,
  SURVEY_STATUS_READER_PORT,
  SURVEY_WRITE_PORT,
  SurveyWriter,
  type SiteSurveyConstraintsPort,
  type SurveyStatusReaderPort,
  type SurveyWritePort,
} from '../surveys';
import { DrizzleSiteWriteStore } from '../sites/infrastructure/drizzle-site-write-store';
import { DrizzleSiteSurveyConstraints } from '../surveys/infrastructure/drizzle-site-survey-constraints';
import { DrizzleSurveyStatusReader } from '../surveys/infrastructure/drizzle-survey-status-reader';
import { DrizzleSurveyWriteStore } from '../surveys/infrastructure/drizzle-survey-write-store';
import { SITE_SURVEY_TRANSACTION_RUNNER, type SiteSurveyTransactionRunner } from './application/transaction';
import { SiteSurveyCoordinator } from './application/site-survey.coordinator';
import { DrizzleSiteSurveyTransactionRunner, SITE_SURVEY_TRANSACTION_RUNNER_PROVIDER } from './infrastructure/drizzle-transaction-runner';

@Module({
  providers: [
    DrizzleSiteWriteStore,
    { provide: SITE_WRITE_PORT, useExisting: DrizzleSiteWriteStore },
    DrizzleSiteSurveyConstraints,
    { provide: SITE_SURVEY_CONSTRAINTS_PORT, useExisting: DrizzleSiteSurveyConstraints },
    DrizzleSurveyStatusReader,
    { provide: SURVEY_STATUS_READER_PORT, useExisting: DrizzleSurveyStatusReader },
    DrizzleSurveyWriteStore,
    { provide: SURVEY_WRITE_PORT, useExisting: DrizzleSurveyWriteStore },
    DrizzleSiteSurveyTransactionRunner,
    SITE_SURVEY_TRANSACTION_RUNNER_PROVIDER,
    {
      provide: SiteSurveyCoordinator,
      useFactory: (
        surveys: SurveyStatusReaderPort,
        transactions: SiteSurveyTransactionRunner,
        sites: SiteWritePort,
        constraints: SiteSurveyConstraintsPort,
      ) => new SiteSurveyCoordinator(surveys, transactions, sites, constraints),
      inject: [SURVEY_STATUS_READER_PORT, SITE_SURVEY_TRANSACTION_RUNNER, SITE_WRITE_PORT, SITE_SURVEY_CONSTRAINTS_PORT],
    },
    {
      provide: SurveyWriter,
      useFactory: (coordinator: SiteSurveyCoordinator, writer: SurveyWritePort) => new SurveyWriter(coordinator, writer),
      inject: [SiteSurveyCoordinator, SURVEY_WRITE_PORT],
    },
  ],
  exports: [SiteSurveyCoordinator, SurveyWriter],
})
export class SiteSurveyModule {}


export { SiteSurveyCoordinator };
