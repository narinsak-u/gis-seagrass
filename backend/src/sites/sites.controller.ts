import { Pool } from 'pg';

import { ApiBearerAuth, ApiBody, ApiExtraModels, ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req, NotFoundException, Query, UseGuards } from '@nestjs/common';
import { isRecord } from '../domain/guards';
import { AuthGuard, Roles, type AuthenticatedRequest } from '../auth/auth.guard';
import { parseSiteFeature, SiteValidationError } from './site-feature';
import type { PublicSiteSummary, SiteSummary } from './site.types';
import { SiteSurveyCoordinator } from '../site-survey/site-survey.coordinator';

import { ApiErrorEnvelope, SITE_CREATE_BODY_SCHEMA, SITE_DETAIL_SCHEMA, SITE_ERROR_SCHEMA, SITE_FEATURE_SCHEMA, SITE_LIST_SCHEMA, SITE_PATCH_BODY_SCHEMA, SITE_PATCH_ERROR_SCHEMA } from './site-openapi';



interface SiteList {
  items: PublicSiteSummary[];
  total: number;
  page: number;
}

interface SiteFeature {
  type: 'Feature';
  geometry: { type: 'MultiPolygon'; coordinates: number[][][][] };
  properties: PublicSiteSummary & {
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
  constructor(private readonly pool: Pool, private readonly siteSurvey: SiteSurveyCoordinator) {}

  @Post()
  @UseGuards(AuthGuard)
  @Roles('admin')
  @ApiBearerAuth('access-token')
  @ApiOperation({ description: 'Requires an active admin. Audit fields are set from the authenticated user.' })
  @ApiBody({ schema: SITE_CREATE_BODY_SCHEMA })
  @ApiResponse({ status: 201, description: 'Created Site GeoJSON Feature', schema: SITE_FEATURE_SCHEMA })
  @ApiResponse({ status: 400, description: 'VALIDATION_ERROR or INVALID_GEOMETRY', schema: SITE_ERROR_SCHEMA })
  @ApiResponse({ status: 401, description: 'UNAUTHORIZED', schema: SITE_ERROR_SCHEMA })
  @ApiResponse({ status: 403, description: 'FORBIDDEN', schema: SITE_ERROR_SCHEMA })
  @ApiResponse({ status: 409, description: 'DUPLICATE_CODE', schema: SITE_ERROR_SCHEMA })
  @ApiResponse({ status: 422, description: 'OUTSIDE_COVERAGE', schema: SITE_ERROR_SCHEMA })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR', schema: SITE_ERROR_SCHEMA })
  async create(@Req() request: AuthenticatedRequest, @Body() body: unknown): Promise<CreatedSiteFeature> {
    const site = validateCreateFeature(body);
    try {
      return await this.siteSurvey.create(site, request.user.id);
    } catch (error) {
      if (isRecord(error) && error.code === '23505' && error.constraint === 'uq_sites_code') {
        throw new ConflictException({ code: 'DUPLICATE_CODE', message: 'Site code already exists', details: {} });
      }
      throw error;
    }
  }

  @Patch(':code')
  @UseGuards(AuthGuard)
  @Roles('admin')
  @ApiBearerAuth('access-token')
  @ApiOperation({ description: 'Requires an active admin. Editor name and geometry changes are forbidden.' })
  @ApiBody({ schema: SITE_PATCH_BODY_SCHEMA })
  @ApiResponse({ status: 200, description: 'Updated Site GeoJSON Feature', schema: SITE_FEATURE_SCHEMA })
  @ApiResponse({ status: 400, description: 'VALIDATION_ERROR or INVALID_GEOMETRY', schema: SITE_ERROR_SCHEMA })
  @ApiResponse({ status: 401, description: 'UNAUTHORIZED', schema: SITE_ERROR_SCHEMA })
  @ApiResponse({ status: 403, description: 'FORBIDDEN', schema: SITE_ERROR_SCHEMA })
  @ApiResponse({ status: 404, description: 'SITE_NOT_FOUND', schema: SITE_ERROR_SCHEMA })
  @ApiResponse({ status: 409, description: 'VERSION_CONFLICT returns details.current as the current Site Feature; SURVEYS_OUTSIDE rejects stranded Surveys', schema: SITE_PATCH_ERROR_SCHEMA })
  @ApiResponse({ status: 422, description: 'OUTSIDE_COVERAGE', schema: SITE_ERROR_SCHEMA })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR', schema: SITE_ERROR_SCHEMA })
  async update(@Param('code') code: string, @Body() body: unknown, @Req() request: AuthenticatedRequest): Promise<CreatedSiteFeature> {
    const patch = validateSitePatch(body);
    return this.siteSurvey.update(code, patch, request.user.id);
  }

  @Delete(':code')
  @UseGuards(AuthGuard)
  @Roles('admin')
  @ApiBearerAuth('access-token')
  @ApiOperation({ description: 'Requires an active admin. Soft-deletes Sites without linked Surveys and records the admin as updater.' })
  @ApiResponse({ status: 204, description: 'Site soft-deleted' })
  @ApiResponse({ status: 401, description: 'UNAUTHORIZED', schema: SITE_ERROR_SCHEMA })
  @ApiResponse({ status: 403, description: 'FORBIDDEN', schema: SITE_ERROR_SCHEMA })
  @ApiResponse({ status: 404, description: 'SITE_NOT_FOUND', schema: SITE_ERROR_SCHEMA })
  @ApiResponse({ status: 409, description: 'SITE_HAS_SURVEYS', schema: SITE_ERROR_SCHEMA })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR', schema: SITE_ERROR_SCHEMA })
  @HttpCode(204)
  async remove(@Param('code') code: string, @Req() request: AuthenticatedRequest): Promise<void> {
    await this.siteSurvey.retire(code, request.user.id);
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
      id: string;
      code: string;
      name: string;
      province_code: string;
      area_rai: string;
      version: number;
    }>(
      `SELECT s.id::text, s.code, s.name, s.province_code, s.area_rai::text, s.version
         FROM sites s
        WHERE ${where}
        ORDER BY s.code ASC
        LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, pageSize, offset],
    );
    const statuses = await this.siteSurvey.statuses(result.rows.map((row) => row.id));
    return {
      items: result.rows.map((row) => ({
        code: row.code,
        name: row.name,
        province_code: row.province_code,
        area_rai: Number(row.area_rai),
        version: row.version,
        siteStatus: statuses.get(row.id) ?? 'no_data',
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
      id: string;
      code: string;
      name: string;
      province_code: string;
      area_rai: string;
      version: number;
      geometry: { type: 'MultiPolygon'; coordinates: number[][][][] };
    }>(
      `SELECT s.id::text, s.code, s.name, s.province_code, s.area_rai::text, s.version,
              ST_AsGeoJSON(s.geom, 15)::jsonb AS geometry
         FROM sites s
        WHERE s.code = $1 AND s.deleted_at IS NULL`,
      [code],
    );
    const row = result.rows[0];
    if (!row) {
      throw new NotFoundException({ code: 'SITE_NOT_FOUND', message: 'Site not found', details: {} });
    }
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
