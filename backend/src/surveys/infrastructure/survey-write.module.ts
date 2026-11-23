import { Module } from '@nestjs/common';
import { DrizzleSurveyWriteStore } from './drizzle-survey-write-store';
import { SURVEY_WRITE_PORT } from '../survey-write.port';

@Module({
  providers: [DrizzleSurveyWriteStore, { provide: SURVEY_WRITE_PORT, useExisting: DrizzleSurveyWriteStore }],
  exports: [SURVEY_WRITE_PORT],
})
export class SurveyWriteInfrastructureModule {}
