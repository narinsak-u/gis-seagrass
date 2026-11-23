import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SiteSurveyModule } from '../site-survey/site-survey.module';
import { DrizzleSiteReadStore } from './infrastructure/drizzle-site-read-store';
import { SITE_READ_PORT } from './site-read.port';
import { SiteReader } from './site-reader';
import { SitesController } from './sites.controller';
import { SitesGeoJsonController } from './sites.geojson.controller';

@Module({
  imports: [AuthModule, SiteSurveyModule],
  controllers: [SitesController, SitesGeoJsonController],
  providers: [SiteReader, DrizzleSiteReadStore, { provide: SITE_READ_PORT, useExisting: DrizzleSiteReadStore }],
})
export class SitesModule {}
