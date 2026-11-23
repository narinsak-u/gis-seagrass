import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type DatabaseProvider } from '../database/provider';
import { SurveyStatusReader, type LatestSurveySummary } from '../surveys/survey-status-reader';
import { SITE_SURVEY_CONSTRAINTS_PORT, type SiteSurveyConstraintsPort } from '../surveys/site-survey-constraints.port';
import { deriveSiteStatus, type SiteStatus } from '../domain/site-status';
import { SITE_WRITE_PORT, type SitePatch, type SiteSpatial, type SiteWriteInput, type SiteWritePort } from '../sites/site-write.port';
import type { SiteWriteTransaction } from './transaction';

@Injectable()
export class SiteSurveyCoordinator {
  constructor(
    private readonly surveys: SurveyStatusReader,
    @Inject(DRIZZLE_DATABASE) private readonly db: DatabaseProvider['db'],
    @Inject(SITE_WRITE_PORT) private readonly sites: SiteWritePort,
    @Inject(SITE_SURVEY_CONSTRAINTS_PORT) private readonly surveyConstraints: SiteSurveyConstraintsPort,
  ) {}

  async statuses(siteIds: readonly string[]): Promise<Map<string, SiteStatus>> {
    const coverPercentages = await this.surveys.latestCoverPercentages(siteIds);
    return new Map(siteIds.map((siteId) => [siteId, deriveSiteStatus(coverPercentages.get(siteId) ?? [])]));
  }

  latestSurvey(siteId: string): Promise<LatestSurveySummary | null> {
    return this.surveys.latestSurvey(siteId);
  }


  async importSite(site: SiteWriteInput): Promise<'INSERTED' | 'SKIPPED' | 'INVALID_GEOMETRY' | 'OUTSIDE_COVERAGE'> {
    try {
      return await this.transaction(async (tx) => await this.sites.import(tx, site) ? 'INSERTED' : 'SKIPPED');
    } catch (error) {
      if (error instanceof BadRequestException) return 'INVALID_GEOMETRY';
      if (error instanceof UnprocessableEntityException) return 'OUTSIDE_COVERAGE';
      throw error;
    }
  }


  create(site: SiteWriteInput, actorId: string) {
    return this.transaction((tx) => this.sites.create(tx, site, actorId));
  }

  transaction<T>(work: (tx: SiteWriteTransaction) => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }

  hasSiteCode(code: string): Promise<boolean> {
    return this.transaction((tx) => this.sites.hasCode(tx, code));
  }
  lockSiteForSurvey(tx: SiteWriteTransaction, code: string, lon: number, lat: number) {
    return this.sites.lockForSurvey(tx, code, lon, lat);
  }

  lockActiveSite(tx: SiteWriteTransaction, id: string): Promise<boolean> {
    return this.sites.lockActive(tx, id);
  }

  siteWithinDistance(tx: SiteWriteTransaction, id: string, lon: number, lat: number): Promise<boolean> {
    return this.sites.withinDistance(tx, id, lon, lat);
  }


  update(code: string, patch: SitePatch, actorId: string) {
    return this.transaction(async (tx) => {
      const current = await this.sites.lock(tx, code);
      if (!current) throw new NotFoundException({ code: 'SITE_NOT_FOUND', message: 'Site not found', details: {} });
      if (current.version !== patch.version) {
        throw new ConflictException({ code: 'VERSION_CONFLICT', message: 'Site version conflict', details: { current: {
          type: 'Feature',
          geometry: current.geometry,
          properties: { code, name: current.name, province_code: current.provinceCode, area_rai: Number(current.areaRai), version: current.version },
        } } });
      }
      let spatial: SiteSpatial | undefined;
      if (patch.geometry) {
        const source = JSON.stringify(patch.geometry);
        const derived = await this.sites.deriveSpatial(tx, source);
        if (await this.surveyConstraints.hasSurveysOutside(tx, current.id, source)) {
          throw new ConflictException({ code: 'SURVEYS_OUTSIDE', message: 'Geometry would strand linked Surveys', details: {} });
        }
        spatial = { ...derived, source };
      }
      return this.sites.update(tx, current, patch, actorId, spatial);
    });
  }

  retire(code: string, actorId: string): Promise<void> {
    return this.transaction(async (tx) => {
      const current = await this.sites.lock(tx, code);
      if (!current) throw new NotFoundException({ code: 'SITE_NOT_FOUND', message: 'Site not found', details: {} });
      if (await this.surveyConstraints.hasSurveys(tx, current.id)) {
        throw new ConflictException({ code: 'SITE_HAS_SURVEYS', message: 'Site has linked Surveys', details: {} });
      }
      await this.sites.retire(tx, current, actorId);
    });
  }
}
