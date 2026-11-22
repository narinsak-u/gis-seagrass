import { ApiBody, ApiExtraModels, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, Param, Patch, Post, UnprocessableEntityException, NotFoundException, Query } from '@nestjs/common';
import { isRecord } from '../import/guards';
import { parseSiteFeature, SiteValidationError } from '../import/sites';
import { ApiErrorEnvelope, SITE_CREATE_BODY_SCHEMA, SITE_DETAIL_SCHEMA, SITE_ERROR_SCHEMA, SITE_FEATURE_SCHEMA, SITE_LIST_SCHEMA, SITE_PATCH_BODY_SCHEMA } from './site-openapi';

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
@ApiExtraModels(ApiErrorEnvelope)
@Controller('sites')
export class SitesController {
  constructor(private readonly pool: Pool) {}

  @Post()
  @ApiBody({ schema: SITE_CREATE_BODY_SCHEMA })
  @ApiResponse({ status: 201, description: 'Created Site GeoJSON Feature', schema: SITE_FEATURE_SCHEMA })
  @ApiResponse({ status: 400, description: 'VALIDATION_ERROR or INVALID_GEOMETRY', schema: SITE_ERROR_SCHEMA })
  @ApiResponse({ status: 409, description: 'DUPLICATE_CODE', schema: SITE_ERROR_SCHEMA })
  @ApiResponse({ status: 422, description: 'OUTSIDE_COVERAGE', schema: SITE_ERROR_SCHEMA })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR', schema: SITE_ERROR_SCHEMA })
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

  @Patch(':code')
  @ApiBody({ schema: SITE_PATCH_BODY_SCHEMA })
  @ApiResponse({ status: 200, description: 'Updated Site GeoJSON Feature', schema: SITE_FEATURE_SCHEMA })
  @ApiResponse({ status: 400, description: 'VALIDATION_ERROR or INVALID_GEOMETRY', schema: SITE_ERROR_SCHEMA })
  @ApiResponse({ status: 404, description: 'SITE_NOT_FOUND', schema: SITE_ERROR_SCHEMA })
  @ApiResponse({ status: 409, description: 'VERSION_CONFLICT or SURVEYS_OUTSIDE', schema: SITE_ERROR_SCHEMA })
  @ApiResponse({ status: 422, description: 'OUTSIDE_COVERAGE', schema: SITE_ERROR_SCHEMA })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR', schema: SITE_ERROR_SCHEMA })
  async update(@Param('code') code: string, @Body() body: unknown): Promise<CreatedSiteFeature> {
    const patch = validateSitePatch(body);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query<{ id: string; version: number; name: string }>(
        'SELECT id, version, name FROM sites WHERE code = $1 AND deleted_at IS NULL FOR UPDATE',
        [code],
      );
      if (!locked.rowCount) throw new NotFoundException({ code: 'SITE_NOT_FOUND', message: 'Site not found', details: {} });
      if (locked.rows[0].version !== patch.version) {
        throw new ConflictException({ code: 'VERSION_CONFLICT', message: 'Site version conflict', details: {} });
      }
      let derived: { province_code: string; area_rai: string; geometry: CreatedSiteFeature['geometry'] } | undefined;
      if (patch.geometry) {
        const source = JSON.stringify(patch.geometry);
        const validity = await client.query<{ valid: boolean; empty: boolean }>(
          `SELECT ST_IsValid(geom) AS valid, ST_IsEmpty(geom) AS empty
             FROM (SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) AS geom) input`,
          [source],
        );
        if (!validity.rows[0].valid || validity.rows[0].empty) {
          throw new BadRequestException({ code: 'INVALID_GEOMETRY', message: 'Invalid geometry', details: {} });
        }
        const result = await client.query<{
          province_code: string | null; area_rai: string; geometry: CreatedSiteFeature['geometry'];
        }>(
          `WITH candidate AS (
             SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) AS geom
           ), coverage AS (
             SELECT p.code, ST_Area(ST_Intersection(c.geom, p.geom)::geography) AS overlap_area
               FROM candidate c JOIN provinces p ON ST_Intersects(c.geom, p.geom)
           )
           SELECT (SELECT code FROM coverage WHERE overlap_area > 0 ORDER BY overlap_area DESC, code ASC LIMIT 1) AS province_code,
                  ROUND((ST_Area(ST_Multi(c.geom)::geography) / 1600)::numeric, 2)::text AS area_rai,
                  ST_AsGeoJSON(ST_Multi(c.geom))::jsonb AS geometry
             FROM candidate c`,
          [source],
        );
        const spatial = result.rows[0];
        if (spatial.province_code === null) {
          throw new UnprocessableEntityException({ code: 'OUTSIDE_COVERAGE', message: 'Site must overlap a Province', details: {} });
        }
        const outside = await client.query(
          `SELECT 1 FROM surveys
            WHERE site_id = $1
              AND NOT ST_DWithin(geom::geography, ST_SetSRID(ST_GeomFromGeoJSON($2), 4326)::geography, 50)
            LIMIT 1`,
          [locked.rows[0].id, source],
        );
        if (outside.rowCount) {
          throw new ConflictException({ code: 'SURVEYS_OUTSIDE', message: 'Geometry would strand linked Surveys', details: {} });
        }
        derived = { ...spatial, province_code: spatial.province_code };
      }
      const updated = derived
        ? await client.query<{ version: number; name: string; province_code: string; area_rai: string; geometry: CreatedSiteFeature['geometry'] }>(
          `UPDATE sites SET name = COALESCE($2, name), province_code = $3, area_rai = $4,
                  geom = ST_SetSRID(ST_GeomFromGeoJSON($5), 4326), version = version + 1
            WHERE id = $1 RETURNING version, name, province_code, area_rai::text, ST_AsGeoJSON(geom)::jsonb AS geometry`,
          [locked.rows[0].id, patch.name ?? null, derived.province_code, derived.area_rai, JSON.stringify(derived.geometry)],
        )
        : await client.query<{ version: number; name: string; province_code: string; area_rai: string; geometry: CreatedSiteFeature['geometry'] }>(
          `UPDATE sites SET name = $2, version = version + 1
            WHERE id = $1
            RETURNING version, name, province_code, area_rai::text, ST_AsGeoJSON(geom)::jsonb AS geometry`,
          [locked.rows[0].id, patch.name],
        );
      const row = updated.rows[0];
      await client.query('COMMIT');
      return {
        type: 'Feature',
        geometry: row.geometry,
        properties: {
          code,
          name: row.name,
          province_code: row.province_code,
          area_rai: Number(row.area_rai),
          version: row.version,
        },
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  @Delete(':code')
  @ApiResponse({ status: 204, description: 'Site soft-deleted' })
  @ApiResponse({ status: 404, description: 'SITE_NOT_FOUND', schema: SITE_ERROR_SCHEMA })
  @ApiResponse({ status: 409, description: 'SITE_HAS_SURVEYS', schema: SITE_ERROR_SCHEMA })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR', schema: SITE_ERROR_SCHEMA })
  @HttpCode(204)
  async remove(@Param('code') code: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query<{ id: string }>(
        'SELECT id FROM sites WHERE code = $1 AND deleted_at IS NULL FOR UPDATE',
        [code],
      );
      if (!locked.rowCount) throw new NotFoundException({ code: 'SITE_NOT_FOUND', message: 'Site not found', details: {} });
      const surveys = await client.query('SELECT 1 FROM surveys WHERE site_id = $1 LIMIT 1', [locked.rows[0].id]);
      if (surveys.rowCount) {
        throw new ConflictException({ code: 'SITE_HAS_SURVEYS', message: 'Site has linked Surveys', details: {} });
      }
      await client.query('UPDATE sites SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1', [locked.rows[0].id]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  @Get()
  @ApiQuery({ name: 'status', required: false, enum: ['active'], description: 'Active Sites only' })
  @ApiQuery({ name: 'province', required: false, type: String })
  @ApiQuery({ name: 'q', required: false, type: String })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Positive page number; defaults to 1' })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, description: '1–100; defaults to 20' })
  @ApiResponse({ status: 200, description: 'Paginated Site summaries', schema: SITE_LIST_SCHEMA })
  @ApiResponse({ status: 400, description: 'VALIDATION_ERROR', schema: SITE_ERROR_SCHEMA })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR', schema: SITE_ERROR_SCHEMA })
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
  @ApiResponse({ status: 200, description: 'Site GeoJSON Feature with latest Survey summary', schema: SITE_DETAIL_SCHEMA })
  @ApiResponse({ status: 404, description: 'SITE_NOT_FOUND', schema: SITE_ERROR_SCHEMA })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR', schema: SITE_ERROR_SCHEMA })
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

function validateSitePatch(body: unknown): { version: number; name?: string; geometry?: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown } } {
  if (!isRecord(body) || Object.keys(body).some((key) => !['version', 'name', 'geometry'].includes(key))
    || !Number.isSafeInteger(body.version) || (body.version as number) < 1
    || (body.name === undefined && body.geometry === undefined)
    || (body.name !== undefined && (typeof body.name !== 'string' || !body.name.trim() || body.name.includes('\0')))
    || (body.geometry !== undefined && (!isRecord(body.geometry)
      || Object.keys(body.geometry).sort().join(',') !== 'coordinates,type'))) {
    throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Validation failed', details: {} });
  }
  if (body.geometry !== undefined) {
    try {
      const site = parseSiteFeature({ type: 'Feature', properties: { code: 'patch', name: 'patch' }, geometry: body.geometry });
      return { version: body.version as number, ...(body.name === undefined ? {} : { name: body.name as string }), geometry: site.geometry };
    } catch (error) {
      if (error instanceof SiteValidationError
        && (error.message === 'INVALID_GEOMETRY' || error.message === 'INVALID_COORDINATES')) {
        throw new BadRequestException({ code: 'INVALID_GEOMETRY', message: 'Invalid geometry', details: {} });
      }
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Validation failed', details: {} });
    }
  }
  return { version: body.version as number, name: body.name as string };
}
