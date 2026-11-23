import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DrizzleSiteSurveyConstraints } from './infrastructure/drizzle-site-survey-constraints';
import { DrizzleSurveyListReader } from './infrastructure/drizzle-survey-list-reader';
import { DrizzleSurveyStatusReader } from './infrastructure/drizzle-survey-status-reader';
import { SITE_SURVEY_CONSTRAINTS_PORT } from './site-survey-constraints.port';
import { SURVEY_LIST_READER_PORT } from './survey-list-reader.port';
import { SurveyListReader } from './survey-list-reader';
import { SURVEY_STATUS_READER_PORT } from './survey-status-reader.port';
import { SurveyStatusReader } from './survey-status-reader';
import { SurveysController } from './surveys.controller';

@Module({
  imports: [AuthModule],
  controllers: [SurveysController],
  providers: [
    SurveyListReader,
    DrizzleSurveyListReader,
    { provide: SURVEY_LIST_READER_PORT, useExisting: DrizzleSurveyListReader },
    SurveyStatusReader,
    DrizzleSurveyStatusReader,
    DrizzleSiteSurveyConstraints,
    { provide: SITE_SURVEY_CONSTRAINTS_PORT, useExisting: DrizzleSiteSurveyConstraints },
    { provide: SURVEY_STATUS_READER_PORT, useExisting: DrizzleSurveyStatusReader },
  ],
  exports: [SurveyStatusReader, SITE_SURVEY_CONSTRAINTS_PORT],
})
export class SurveysModule {}
