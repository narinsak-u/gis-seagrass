import type { DynamicModule } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import type { DatabaseProvider } from './platform/database';
import { PlatformModule } from './platform/platform.module';
import { SitesModule } from './sites/sites.module';
import { SurveysModule } from './surveys/surveys.module';

@Module({})
export class AppModule {
  static register(database: DatabaseProvider): DynamicModule {
    return {
      module: AppModule,
      imports: [PlatformModule.register(database), AuthModule, SitesModule, SurveysModule],
    };
  }
}
