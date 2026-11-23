import { Module } from '@nestjs/common';
import { DrizzleSiteSurveyConstraints } from './infrastructure/drizzle-site-survey-constraints';
import { SITE_SURVEY_CONSTRAINTS_PORT } from './site-survey-constraints.port';
import { DrizzleSurveyStatusReader } from './infrastructure/drizzle-survey-status-reader';
import { SURVEY_STATUS_READER_PORT } from './survey-status-reader.port';
import { SurveyStatusReader } from './survey-status-reader';

@Module({
  providers: [
    SurveyStatusReader,
    DrizzleSurveyStatusReader,
    DrizzleSiteSurveyConstraints,
    { provide: SITE_SURVEY_CONSTRAINTS_PORT, useExisting: DrizzleSiteSurveyConstraints },
    { provide: SURVEY_STATUS_READER_PORT, useExisting: DrizzleSurveyStatusReader },
  ],
  exports: [SurveyStatusReader, SITE_SURVEY_CONSTRAINTS_PORT],
})
export class SurveysModule {}
