import { Module } from '@nestjs/common';
import type { DatabaseProvider } from '../../platform/database';
import { SITE_SURVEY_CONSTRAINTS_PORT, type SiteSurveyConstraintsPort } from '../application/site-survey-constraints.port';
import { SURVEY_STATUS_READER_PORT, type SurveyStatusReaderPort } from '../application/survey-status-reader.port';
import { SURVEY_WRITE_PORT, type SurveyWritePort } from '../application/survey-write.port';
import { DrizzleSiteSurveyConstraints } from './drizzle-site-survey-constraints';
import { DrizzleSurveyStatusReader } from './drizzle-survey-status-reader';
import { DrizzleSurveyWriteStore } from './drizzle-survey-write-store';

@Module({
  providers: [
    DrizzleSiteSurveyConstraints,
    { provide: SITE_SURVEY_CONSTRAINTS_PORT, useExisting: DrizzleSiteSurveyConstraints },
    DrizzleSurveyStatusReader,
    { provide: SURVEY_STATUS_READER_PORT, useExisting: DrizzleSurveyStatusReader },
    DrizzleSurveyWriteStore,
    { provide: SURVEY_WRITE_PORT, useExisting: DrizzleSurveyWriteStore },
  ],
  exports: [SITE_SURVEY_CONSTRAINTS_PORT, SURVEY_STATUS_READER_PORT, SURVEY_WRITE_PORT],
})
export class SurveysInfrastructureModule {}

export function createSurveyWriteAdapters(db: DatabaseProvider['db']): {
  constraints: SiteSurveyConstraintsPort;
  statusReader: SurveyStatusReaderPort;
  surveyWriter: SurveyWritePort;
} {
  return {
    constraints: new DrizzleSiteSurveyConstraints(),
    statusReader: new DrizzleSurveyStatusReader(db),
    surveyWriter: new DrizzleSurveyWriteStore(),
  };
}

