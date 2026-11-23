import { type DynamicModule, Module } from '@nestjs/common';
import { SiteSurveyCoordinator } from '../site-survey-workflows';
import type { SiteReadRepository } from './application/contracts/site-read-repository';
import type { SiteSurveyReadContract } from './application/contracts/site-survey-read-contract';
import { SITE_READ_REPOSITORY } from './application/contracts/site-read-repository';
import { SiteQueries } from './application/use-cases/site-queries';
import { DrizzleSiteReadRepository } from './infrastructure/repositories/drizzle-site-read-repository';
import { SitesController } from './http/sites.controller';
import { SitesGeoJsonController } from './http/sites.geojson.controller';

@Module({})
export class SitesModule {
  static register(databaseModule: DynamicModule, authModule: DynamicModule, siteSurveyModule: DynamicModule): DynamicModule {
    return {
      module: SitesModule,
      imports: [databaseModule, authModule, siteSurveyModule],
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
    };
  }
}
