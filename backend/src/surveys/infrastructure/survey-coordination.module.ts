import { Module } from '@nestjs/common';
import { DrizzleSiteSurveyConstraints } from './drizzle-site-survey-constraints';
import { DrizzleSurveyStatusReader } from './drizzle-survey-status-reader';
import { SITE_SURVEY_CONSTRAINTS_PORT } from '../site-survey-constraints.port';
import { SURVEY_STATUS_READER_PORT } from '../survey-status-reader.port';

@Module({
  providers: [
    DrizzleSiteSurveyConstraints,
    DrizzleSurveyStatusReader,
    { provide: SITE_SURVEY_CONSTRAINTS_PORT, useExisting: DrizzleSiteSurveyConstraints },
    { provide: SURVEY_STATUS_READER_PORT, useExisting: DrizzleSurveyStatusReader },
  ],
  exports: [SITE_SURVEY_CONSTRAINTS_PORT, SURVEY_STATUS_READER_PORT],
})
export class SurveyCoordinationInfrastructureModule {}
