import { type DynamicModule, Module } from '@nestjs/common';
import { SURVEY_LIST_REPOSITORY } from './application/contracts/survey-list-repository';
import { DrizzleSurveyListRepository } from './infrastructure/repositories/drizzle-survey-list-repository';
import { SurveysController } from './http/surveys.controller';

@Module({})
export class SurveysModule {
  static register(databaseModule: DynamicModule, authModule: DynamicModule, siteSurveyModule: DynamicModule): DynamicModule {
    return {
      module: SurveysModule,
      imports: [databaseModule, authModule, siteSurveyModule],
      controllers: [SurveysController],
      providers: [
        DrizzleSurveyListRepository,
        { provide: SURVEY_LIST_REPOSITORY, useExisting: DrizzleSurveyListRepository },
      ],
    };
  }
}
