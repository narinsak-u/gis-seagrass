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
import { SitesInfrastructureModule } from '../sites/infrastructure/sites-infrastructure.module';
import { SurveysInfrastructureModule } from '../surveys/infrastructure/surveys-infrastructure.module';
import { SITE_SURVEY_TRANSACTION_RUNNER, type SiteSurveyTransactionRunner } from './application/transaction';
import { SiteSurveyCoordinator } from './application/site-survey.coordinator';
import { DrizzleSiteSurveyTransactionRunner, SITE_SURVEY_TRANSACTION_RUNNER_PROVIDER } from './infrastructure/drizzle-transaction-runner';

@Module({
  imports: [SitesInfrastructureModule, SurveysInfrastructureModule],
  providers: [
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
