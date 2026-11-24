import { ApplicationError } from '../../shared';
import type { LatestSurveySummary, SiteSurveyConstraintRepository, SurveyStatusRepository } from '../../surveys';
import { deriveSiteStatus, type SitePatch, type SiteSpatial, type SiteStatus, type SiteWriteInput, type SiteWriteRepository } from '../../sites';
import type { SiteSurveyTransactionRunner, SiteWriteTransaction } from './transaction-runner.port';

export class SiteSurveyCoordinator {
  constructor(
    private readonly surveys: SurveyStatusRepository,
    private readonly transactions: SiteSurveyTransactionRunner,
    private readonly sites: SiteWriteRepository,
    private readonly surveyConstraints: SiteSurveyConstraintRepository,
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
      if (error instanceof ApplicationError && error.code === 'INVALID_GEOMETRY') return 'INVALID_GEOMETRY';
      if (error instanceof ApplicationError && error.code === 'OUTSIDE_COVERAGE') return 'OUTSIDE_COVERAGE';
      throw error;
    }
  }


  create(site: SiteWriteInput, actorId: string) {
    return this.transaction((tx) => this.sites.create(tx, site, actorId));
  }

  transaction<T>(work: (tx: SiteWriteTransaction) => Promise<T>): Promise<T> {
    return this.transactions.run(work);
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
      if (!current) throw new ApplicationError('SITE_NOT_FOUND', 'Site not found');
      if (current.version !== patch.version) {
        throw new ApplicationError('VERSION_CONFLICT', 'Site version conflict', { current: {
          type: 'Feature',
          geometry: current.geometry,
          properties: { code, name: current.name, province_code: current.provinceCode, area_rai: Number(current.areaRai), version: current.version },
        } });
      }
      let spatial: SiteSpatial | undefined;
      if (patch.geometry) {
        const source = JSON.stringify(patch.geometry);
        const derived = await this.sites.deriveSpatial(tx, source);
        if (await this.surveyConstraints.hasSurveysOutside(tx, current.id, source)) {
          throw new ApplicationError('SURVEYS_OUTSIDE', 'Geometry would strand linked Surveys');
        }
        spatial = { ...derived, source };
      }
      return this.sites.update(tx, current, patch, actorId, spatial);
    });
  }

  retire(code: string, actorId: string): Promise<void> {
    return this.transaction(async (tx) => {
      const current = await this.sites.lock(tx, code);
      if (!current) throw new ApplicationError('SITE_NOT_FOUND', 'Site not found');
      if (await this.surveyConstraints.hasSurveys(tx, current.id)) {
        throw new ApplicationError('SITE_HAS_SURVEYS', 'Site has linked Surveys');
      }
      await this.sites.retire(tx, current, actorId);
    });
  }
}
