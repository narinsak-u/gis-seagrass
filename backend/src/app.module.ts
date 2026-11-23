import type { DynamicModule } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import type { DatabaseProvider } from './platform/database';
import { DatabaseModule } from './platform/database/database.module';
import { PlatformModule } from './platform/platform.module';
import { SiteSurveyModule } from './site-survey-workflows/site-survey.module';
import { SitesModule } from './sites/sites.module';
import { SurveysModule } from './surveys/surveys.module';

@Module({})
export class AppModule {
  static register(database: DatabaseProvider): DynamicModule {
    const databaseModule = DatabaseModule.register(database);
    const authModule = AuthModule.register(databaseModule);
    const siteSurveyModule = SiteSurveyModule.register(databaseModule);
    return {
      module: AppModule,
      imports: [
        PlatformModule.register(databaseModule),
        authModule,
        SitesModule.register(databaseModule, authModule, siteSurveyModule),
        SurveysModule.register(databaseModule, authModule, siteSurveyModule),
      ],
    };
  }
}
