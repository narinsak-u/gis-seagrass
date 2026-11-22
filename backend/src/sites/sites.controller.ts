import { BadRequestException, Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { Pool } from 'pg';

interface SiteSummary {
  code: string;
  name: string;
  province_code: string;
  area_rai: number;
  version: number;
}

interface SiteList {
  items: SiteSummary[];
  total: number;
  page: number;
}

interface SiteFeature {
  type: 'Feature';
  geometry: { type: 'MultiPolygon'; coordinates: number[][][][] };
  properties: SiteSummary & {
    latest_survey: null | {
      survey_ref: string | null;
      surveyed_on: string;
      cover_percent: number;
    };
  };
}

const ALLOWED_QUERY_KEYS = ['status', 'province', 'q', 'page', 'pageSize'];
@Controller('sites')
export class SitesController {
  constructor(private readonly pool: Pool) {}

  @Get()
  async list(@Query() query: Record<string, unknown>): Promise<SiteList> {
    if (Object.keys(query).some((key) => !ALLOWED_QUERY_KEYS.includes(key))) throw new BadRequestException();
    if (query.status !== undefined && query.status !== 'active') throw new BadRequestException();

    const page = parsePositiveInteger(query.page, 1);
    const pageSize = parsePositiveInteger(query.pageSize, 20);
    if (page === undefined || pageSize === undefined || pageSize > 100
      || page > Math.floor(Number.MAX_SAFE_INTEGER / pageSize)) {
      throw new BadRequestException();
    }
    const province = query.province;
    const search = query.q;
    if ((province !== undefined && (typeof province !== 'string' || province.length !== 2))
      || (search !== undefined && typeof search !== 'string')) {
      throw new BadRequestException();
    }

    const filters = ['deleted_at IS NULL'];
    const values: Array<string | number> = [];
    if (province !== undefined) {
      values.push(province);
      filters.push(`province_code = $${values.length}`);
    }
    if (search !== undefined && search.length > 0) {
      values.push(search);
      filters.push(`(strpos(lower(code), lower($${values.length})) > 0 OR strpos(lower(name), lower($${values.length})) > 0)`);
    }
    const where = filters.join(' AND ');
    const count = await this.pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM sites WHERE ${where}`,
      values,
    );
    const offset = (page - 1) * pageSize;
    const result = await this.pool.query<{
      code: string;
      name: string;
      province_code: string;
      area_rai: string;
      version: number;
    }>(
      `SELECT code, name, province_code, area_rai::text, version
         FROM sites WHERE ${where}
        ORDER BY code ASC
        LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, pageSize, offset],
    );
    return {
      items: result.rows.map((row) => ({
        code: row.code,
        name: row.name,
        province_code: row.province_code,
        area_rai: Number(row.area_rai),
        version: row.version,
      })),
      total: Number(count.rows[0]?.total ?? 0),
      page,
    };
  }

  @Get(':code')
  async detail(@Param('code') code: string): Promise<SiteFeature> {
    const result = await this.pool.query<{
      code: string;
      name: string;
      province_code: string;
      area_rai: string;
      version: number;
      geometry: { type: 'MultiPolygon'; coordinates: number[][][][] };
      survey_ref: string | null;
      surveyed_on: string | null;
      cover_percent: string | null;
    }>(
      `SELECT s.code, s.name, s.province_code, s.area_rai::text, s.version,
              ST_AsGeoJSON(s.geom)::jsonb AS geometry,
              latest.survey_ref, latest.surveyed_on, latest.cover_percent::text
         FROM sites s
         LEFT JOIN LATERAL (
           SELECT survey_ref, surveyed_on::text, cover_percent
             FROM surveys
            WHERE site_id = s.id
            ORDER BY surveyed_on DESC, id DESC
            LIMIT 1
         ) latest ON true
        WHERE s.code = $1 AND s.deleted_at IS NULL`,
      [code],
    );
    const row = result.rows[0];
    if (!row) {
      throw new NotFoundException({ code: 'SITE_NOT_FOUND', message: 'Site not found', details: {} });
    }
    return {
      type: 'Feature',
      geometry: row.geometry,
      properties: {
        code: row.code,
        name: row.name,
        province_code: row.province_code,
        area_rai: Number(row.area_rai),
        version: row.version,
        latest_survey: row.surveyed_on === null ? null : {
          survey_ref: row.survey_ref,
          surveyed_on: row.surveyed_on,
          cover_percent: Number(row.cover_percent),
        },
      },
    };
  }
}

function parsePositiveInteger(value: unknown, fallback: number): number | undefined {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}
