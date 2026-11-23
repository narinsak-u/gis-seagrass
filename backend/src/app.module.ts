import { Inject, Injectable, type DynamicModule, Module, type OnApplicationShutdown } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Pool } from 'pg';
import { AuthController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { ApiErrorFilter } from './errors/error.filter';
import { DATABASE_PROVIDER, DRIZZLE_DATABASE, type DatabaseProvider } from './database/provider';
import { HealthController } from './health/health.controller';
import { SitesController } from './sites/sites.controller';
import { SitesGeoJsonController } from './sites/sites.geojson.controller';
import { SurveysController } from './surveys/surveys.controller';

@Injectable()
class CloseDatabaseOnShutdown implements OnApplicationShutdown {
  constructor(@Inject(DATABASE_PROVIDER) private readonly database: DatabaseProvider) {}

  onApplicationShutdown(): Promise<void> {
    return this.database.close();
  }
}

@Module({})
export class AppModule {
  static register(database: DatabaseProvider): DynamicModule {
    return {
      module: AppModule,
      controllers: [AuthController, HealthController, SitesController, SitesGeoJsonController, SurveysController],
      providers: [
        { provide: Pool, useValue: database.pool },
        { provide: DRIZZLE_DATABASE, useValue: database.db },
        { provide: DATABASE_PROVIDER, useValue: database },
        { provide: APP_FILTER, useClass: ApiErrorFilter },
        AuthGuard,
        CloseDatabaseOnShutdown,
      ],
    };
  }
}
