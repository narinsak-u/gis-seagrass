import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SiteSurveyModule } from '../site-survey-workflows/site-survey.module';
import { SURVEY_LIST_REPOSITORY } from './application/contracts/survey-list-repository';
import { DrizzleSurveyListRepository } from './infrastructure/repositories/drizzle-survey-list-repository';
import { SurveysController } from './http/surveys.controller';

@Module({
  imports: [AuthModule, SiteSurveyModule],
  controllers: [SurveysController],
  providers: [
    DrizzleSurveyListRepository,
    { provide: SURVEY_LIST_REPOSITORY, useExisting: DrizzleSurveyListRepository },
  ],
})
export class SurveysModule {}
