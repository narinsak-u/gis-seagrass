import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SiteSurveyModule } from '../site-survey/site-survey.module';
import { SURVEY_LIST_READER_PORT } from './application/survey-list-reader.port';
import { DrizzleSurveyListReader } from './infrastructure/drizzle-survey-list-reader';
import { SurveysController } from './http/surveys.controller';

@Module({
  imports: [AuthModule, SiteSurveyModule],
  controllers: [SurveysController],
  providers: [
    DrizzleSurveyListReader,
    { provide: SURVEY_LIST_READER_PORT, useExisting: DrizzleSurveyListReader },
  ],
})
export class SurveysModule {}
