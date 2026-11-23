import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SiteSurveyModule } from '../site-survey-workflows/site-survey.module';
import { SiteSurveyCoordinator } from '../site-survey-workflows';
import type { SiteReadRepository } from './application/contracts/site-read-repository';
import type { SiteSurveyReadContract } from './application/contracts/site-survey-read-contract';
import { SITE_READ_REPOSITORY } from './application/contracts/site-read-repository';
import { SiteQueries } from './application/use-cases/site-queries';
import { DrizzleSiteReadRepository } from './infrastructure/repositories/drizzle-site-read-repository';
import { SitesController } from './http/sites.controller';
import { SitesGeoJsonController } from './http/sites.geojson.controller';

@Module({
  imports: [AuthModule, SiteSurveyModule],
  controllers: [SitesController, SitesGeoJsonController],
  providers: [
    DrizzleSiteReadRepository,
    { provide: SITE_READ_REPOSITORY, useExisting: DrizzleSiteReadRepository },
    {
      provide: SiteQueries,
      useFactory: (sites: SiteReadRepository, siteSurvey: SiteSurveyReadContract) => new SiteQueries(sites, siteSurvey),
      inject: [SITE_READ_REPOSITORY, SiteSurveyCoordinator],
    },
  ],
})
export class SitesModule {}
