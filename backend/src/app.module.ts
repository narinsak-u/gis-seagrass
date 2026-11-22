import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Pool } from 'pg';
import { ApiErrorFilter } from './errors/error.filter';
import { createPool } from './database/pool';
import { HealthController } from './health/health.controller';
import { SitesController } from './sites/sites.controller';
import { SitesGeoJsonController } from './sites/sites.geojson.controller';

import { SurveysController } from './surveys/surveys.controller';

@Module({
  controllers: [HealthController, SitesController, SitesGeoJsonController, SurveysController],
  providers: [
    { provide: Pool, useFactory: createPool },
    { provide: APP_FILTER, useClass: ApiErrorFilter },
  ],
})
export class AppModule {}
