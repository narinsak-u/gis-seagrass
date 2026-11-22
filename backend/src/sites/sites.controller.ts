import { BadRequestException, Body, ConflictException, Controller, Get, Param, Post, UnprocessableEntityException, NotFoundException, Query } from '@nestjs/common';
import { isRecord } from '../import/guards';
import { parseSiteFeature, SiteValidationError } from '../import/sites';
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

interface CreatedSiteFeature {
  type: 'Feature';
  geometry: { type: 'MultiPolygon'; coordinates: number[][][][] };
  properties: SiteSummary;
}

const ALLOWED_QUERY_KEYS = ['status', 'province', 'q', 'page', 'pageSize'];
@Controller('sites')
export class SitesController {
  constructor(private readonly pool: Pool) {}

  @Post()
  async create(@Body() body: unknown): Promise<CreatedSiteFeature> {
    const site = validateCreateFeature(body);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const source = JSON.stringify(site.geometry);
      const validity = await client.query<{ valid: boolean; empty: boolean }>(
        `SELECT ST_IsValid(geom) AS valid, ST_IsEmpty(geom) AS empty
           FROM (SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) AS geom) input`,
        [source],
      );
      if (!validity.rows[0].valid || validity.rows[0].empty) {
        throw new BadRequestException({ code: 'INVALID_GEOMETRY', message: 'Invalid geometry', details: {} });
      }
      const result = await client.query<{
        province_code: string | null;
        area_rai: string;
        geometry: CreatedSiteFeature['geometry'];
      }>(
        `WITH candidate AS (
           SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) AS geom
         ), coverage AS (
           SELECT p.code,
                  ST_Area(ST_Intersection(c.geom, p.geom)::geography) AS overlap_area
             FROM candidate c
             JOIN provinces p ON ST_Intersects(c.geom, p.geom)
         )
         SELECT (SELECT code FROM coverage WHERE overlap_area > 0 ORDER BY overlap_area DESC, code ASC LIMIT 1) AS province_code,
                ROUND((ST_Area(ST_Multi(c.geom)::geography) / 1600)::numeric, 2)::text AS area_rai,
                ST_AsGeoJSON(ST_Multi(c.geom))::jsonb AS geometry
           FROM candidate c`,
        [source],
      );
      const derived = result.rows[0];
      if (derived.province_code === null) {
        throw new UnprocessableEntityException({ code: 'OUTSIDE_COVERAGE', message: 'Site must overlap a Province', details: {} });
      }
      const inserted = await client.query<{ version: number; geometry: CreatedSiteFeature['geometry'] }>(
        `INSERT INTO sites (code, name, province_code, geom, area_rai)
         VALUES ($1, $2, $3, ST_SetSRID(ST_GeomFromGeoJSON($4), 4326), $5)
         RETURNING version, ST_AsGeoJSON(geom)::jsonb AS geometry`,
        [site.code, site.name, derived.province_code, JSON.stringify(derived.geometry), derived.area_rai],
      );
      await client.query('COMMIT');
      return {
        type: 'Feature',
        geometry: inserted.rows[0].geometry,
        properties: {
          code: site.code,
          name: site.name,
          province_code: derived.province_code,
          area_rai: Number(derived.area_rai),
          version: inserted.rows[0].version,
        },
      };
    } catch (error) {
      await client.query('ROLLBACK');
      if (isRecord(error) && error.code === '23505' && error.constraint === 'uq_sites_code') {
        throw new ConflictException({ code: 'DUPLICATE_CODE', message: 'Site code already exists', details: {} });
      }
      throw error;
    } finally {
      client.release();
    }
  }
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

function validateCreateFeature(body: unknown) {
  if (!isRecord(body) || Object.keys(body).sort().join(',') !== 'geometry,properties,type'
    || body.type !== 'Feature' || !isRecord(body.properties)
    || Object.keys(body.properties).some((key) => key !== 'code' && key !== 'name')
    || !isRecord(body.geometry) || Object.keys(body.geometry).sort().join(',') !== 'coordinates,type') {
    throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Validation failed', details: {} });
  }
  try {
    return parseSiteFeature(body);
  } catch (error) {
    if (error instanceof SiteValidationError
      && (error.message === 'INVALID_GEOMETRY' || error.message === 'INVALID_COORDINATES')) {
      throw new BadRequestException({ code: 'INVALID_GEOMETRY', message: 'Invalid geometry', details: {} });
    }
    throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Validation failed', details: {} });
  }
}
