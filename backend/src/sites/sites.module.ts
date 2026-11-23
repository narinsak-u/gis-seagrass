import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SiteSurveyModule, SiteSurveyCoordinator } from '../site-survey/site-survey.module';
import type { SiteReadPort } from './application/site-read.port';
import type { SiteSurveyReadPort } from './application/site-reader';
import { SITE_READ_PORT } from './application/site-read.port';
import { SiteReader } from './application/site-reader';
import { DrizzleSiteReadStore } from './infrastructure/drizzle-site-read-store';
import { SitesController } from './http/sites.controller';
import { SitesGeoJsonController } from './http/sites.geojson.controller';

@Module({
  imports: [AuthModule, SiteSurveyModule],
  controllers: [SitesController, SitesGeoJsonController],
  providers: [
    DrizzleSiteReadStore,
    { provide: SITE_READ_PORT, useExisting: DrizzleSiteReadStore },
    {
      provide: SiteReader,
      useFactory: (sites: SiteReadPort, siteSurvey: SiteSurveyReadPort) => new SiteReader(sites, siteSurvey),
      inject: [SITE_READ_PORT, SiteSurveyCoordinator],
    },
  ],
})
export class SitesModule {}
