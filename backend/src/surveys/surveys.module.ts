import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SiteSurveyModule } from '../site-survey/site-survey.module';
import { DrizzleSurveyListReader } from './infrastructure/drizzle-survey-list-reader';
import { SurveyWriteInfrastructureModule } from './infrastructure/survey-write.module';
import { SURVEY_LIST_READER_PORT } from './survey-list-reader.port';
import { SurveyListReader } from './survey-list-reader';
import { SurveyWriter } from './survey-writer';
import { SurveysController } from './surveys.controller';

@Module({
  imports: [AuthModule, SiteSurveyModule, SurveyWriteInfrastructureModule],
  controllers: [SurveysController],
  providers: [
    SurveyListReader,
    DrizzleSurveyListReader,
    { provide: SURVEY_LIST_READER_PORT, useExisting: DrizzleSurveyListReader },
    SurveyWriter,
  ],
})
export class SurveysModule {}
