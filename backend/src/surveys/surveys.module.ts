import { Module } from '@nestjs/common';
import { DrizzleSurveyStatusReader } from './infrastructure/drizzle-survey-status-reader';
import { SURVEY_STATUS_READER_PORT } from './survey-status-reader.port';
import { SurveyStatusReader } from './survey-status-reader';

@Module({
  providers: [
    SurveyStatusReader,
    DrizzleSurveyStatusReader,
    { provide: SURVEY_STATUS_READER_PORT, useExisting: DrizzleSurveyStatusReader },
  ],
  exports: [SurveyStatusReader],
})
export class SurveysModule {}
