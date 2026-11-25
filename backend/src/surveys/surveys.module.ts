import { type DynamicModule, Module } from '@nestjs/common';
import { SURVEY_LIST_REPOSITORY } from './application/survey-list.repository';
import { DrizzleSurveyListRepository } from './infrastructure/drizzle-survey-list.repository';
import { SurveysController } from './presentation/surveys.controller';

@Module({})
export class SurveysModule {
  static register(databaseModule: DynamicModule, authModule: DynamicModule, siteSurveyModule: DynamicModule): DynamicModule {
    return {
      module: SurveysModule,
      imports: [databaseModule, authModule, siteSurveyModule],
      controllers: [SurveysController],
      providers: [
        { provide: SURVEY_LIST_REPOSITORY, useClass: DrizzleSurveyListRepository },
      ],
    };
  }
}
