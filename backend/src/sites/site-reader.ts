import { Inject, Injectable } from '@nestjs/common';
import { ApplicationError } from '../domain/application-error';
import { SiteSurveyCoordinator } from '../site-survey/site-survey.coordinator';
import { SITE_READ_PORT, type SiteReadFilters, type SiteReadPort } from './site-read.port';
import type { PublicSiteSummary } from './site.types';

export interface SiteList {
  items: PublicSiteSummary[];
  total: number;
  page: number;
}

export interface SiteFeature {
  type: 'Feature';
  geometry: { type: 'MultiPolygon'; coordinates: number[][][][] };
  properties: PublicSiteSummary & {
    latest_survey?: null | { survey_ref: string | null; surveyed_on: string; cover_percent: number };
  };
}

@Injectable()
export class SiteReader {
  constructor(
    @Inject(SITE_READ_PORT) private readonly sites: SiteReadPort,
    private readonly siteSurvey: SiteSurveyCoordinator,
  ) {}

  async list(filters: SiteReadFilters): Promise<SiteList> {
    const { rows, total } = await this.sites.list(filters);
    const statuses = await this.siteSurvey.statuses(rows.map(({ id }) => id));
    return {
      items: rows.map((row) => ({
        code: row.code,
        name: row.name,
        province_code: row.province_code,
        area_rai: Number(row.area_rai),
        version: row.version,
        siteStatus: statuses.get(row.id) ?? 'no_data',
      })),
      total,
      page: filters.page,
    };
  }

  async detail(code: string): Promise<SiteFeature> {
    const row = await this.sites.detail(code);
    if (!row) throw new ApplicationError('SITE_NOT_FOUND', 'Site not found');
    const [statuses, latestSurvey] = await Promise.all([
      this.siteSurvey.statuses([row.id]),
      this.siteSurvey.latestSurvey(row.id),
    ]);
    return {
      type: 'Feature',
      geometry: row.geometry,
      properties: {
        code: row.code,
        name: row.name,
        province_code: row.province_code,
        area_rai: Number(row.area_rai),
        version: row.version,
        siteStatus: statuses.get(row.id) ?? 'no_data',
        latest_survey: latestSurvey,
      },
    };
  }

  async withinBbox(bbox: [number, number, number, number], province?: string): Promise<{ type: 'FeatureCollection'; features: SiteFeature[] }> {
    const rows = await this.sites.withinBbox(bbox, province);
    const statuses = await this.siteSurvey.statuses(rows.map(({ id }) => id));
    return {
      type: 'FeatureCollection',
      features: rows.map((row) => ({
        type: 'Feature',
        geometry: row.geometry,
        properties: {
          code: row.code,
          name: row.name,
          province_code: row.province_code,
          area_rai: Number(row.area_rai),
          version: row.version,
          siteStatus: statuses.get(row.id) ?? 'no_data',
        },
      })),
    };
  }
}
