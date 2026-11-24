import { type DynamicModule, Module } from '@nestjs/common';
import { SiteSurveyCoordinator } from '../site-survey-workflows';
import type { SiteReadRepository } from './application/site-read.repository';
import type { SiteSurveyReadContract } from './application/site-survey-read.port';
import { SITE_READ_REPOSITORY } from './application/site-read.repository';
import { SiteQueries } from './application/site-queries';
import { DrizzleSiteReadRepository } from './infrastructure/drizzle-site-read.repository';
import { SitesController } from './presentation/sites.controller';
import { SitesGeoJsonController } from './presentation/sites-geojson.controller';

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
