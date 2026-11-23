import { ApiBearerAuth, ApiBody, ApiExtraModels, ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';

import { BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req, Query, UseGuards } from '@nestjs/common';
import { isRecord } from '../domain/guards';
import { AuthGuard, Roles, type AuthenticatedRequest } from '../auth/auth.guard';
import { parseSiteFeature, SiteValidationError } from './site-feature';
import type { SiteSummary } from './site.types';
import { SiteSurveyCoordinator } from '../site-survey/site-survey.coordinator';
import { SiteReader, type SiteFeature, type SiteList } from './site-reader';

import { ApiErrorEnvelope, SITE_CREATE_BODY_SCHEMA, SITE_DETAIL_SCHEMA, SITE_ERROR_SCHEMA, SITE_FEATURE_SCHEMA, SITE_LIST_SCHEMA, SITE_PATCH_BODY_SCHEMA, SITE_PATCH_ERROR_SCHEMA } from './site-openapi';

import { SiteFeatureDto, SiteListQueryDto, SitePatchDto } from './site.dto';



interface CreatedSiteFeature {
  type: 'Feature';
  geometry: { type: 'MultiPolygon'; coordinates: number[][][][] };
  properties: SiteSummary;
}



@ApiExtraModels(ApiErrorEnvelope)
@Controller('sites')
export class SitesController {
  constructor(private readonly siteReader: SiteReader, private readonly siteSurvey: SiteSurveyCoordinator) {}

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
  async create(@Req() request: AuthenticatedRequest, @Body() body: SiteFeatureDto): Promise<CreatedSiteFeature> {
    const site = validateCreateFeature(body);
    try {
      return await this.siteSurvey.create(site, request.user.id);
    } catch (error) {
      const databaseError = isRecord(error) && isRecord(error.cause) ? error.cause : error;
      if (isRecord(databaseError) && databaseError.code === '23505' && databaseError.constraint === 'uq_sites_code') {
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
  async update(@Param('code') code: string, @Body() body: SitePatchDto, @Req() request: AuthenticatedRequest): Promise<CreatedSiteFeature> {
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
  async list(@Query() query: SiteListQueryDto): Promise<SiteList> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    if (page > Math.floor(Number.MAX_SAFE_INTEGER / pageSize)) throw new BadRequestException();
    const province = query.province;
    const search = query.q;
    if (province !== undefined && province.length !== 2) throw new BadRequestException();
    return this.siteReader.list({ province, search, page, pageSize });
  }

  @Get(':code')
  @ApiResponse({ status: 200, description: 'Site GeoJSON Feature with latest Survey summary', schema: SITE_DETAIL_SCHEMA })
  @ApiResponse({ status: 404, description: 'SITE_NOT_FOUND', schema: SITE_ERROR_SCHEMA })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR', schema: SITE_ERROR_SCHEMA })
  async detail(@Param('code') code: string): Promise<SiteFeature> {
    return this.siteReader.detail(code);
  }
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
