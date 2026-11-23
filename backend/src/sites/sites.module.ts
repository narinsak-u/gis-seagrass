import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SurveysModule } from '../surveys/surveys.module';
import { DrizzleSiteWriteStore } from './infrastructure/drizzle-site-write-store';
import { SITE_WRITE_PORT } from './site-write.port';
import { SiteSurveyCoordinator } from './site-survey.coordinator';
import { SitesController } from './sites.controller';
import { SitesGeoJsonController } from './sites.geojson.controller';

@Module({
  imports: [AuthModule, SurveysModule],
  controllers: [SitesController, SitesGeoJsonController],
  providers: [
    SiteSurveyCoordinator,
    DrizzleSiteWriteStore,
    { provide: SITE_WRITE_PORT, useExisting: DrizzleSiteWriteStore },
  ],
})
export class SitesModule {}
