import { ApiExtraModels, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { SITE_ERROR_SCHEMA, SITE_FEATURE_COLLECTION_SCHEMA } from './sites.openapi';
import { ApiErrorEnvelope } from '../../platform/http';
import type { PublicSiteSummary } from '../domain/site.types';
import { SiteQueries } from '../application/site-queries';
import { requireValidBbox } from './bbox.validation';
import { SiteGeoJsonQueryDto } from './sites.dto';



interface SiteFeature {
  type: 'Feature';
  geometry: { type: 'MultiPolygon'; coordinates: number[][][][] };
  properties: PublicSiteSummary;
}

interface SiteFeatureCollection {
  type: 'FeatureCollection';
  features: SiteFeature[];
}




@ApiExtraModels(ApiErrorEnvelope)
@Controller('sites.geojson')
export class SitesGeoJsonController {
  constructor(private readonly siteQueries: SiteQueries) {}

  @Get()
  @ApiQuery({ name: 'bbox', required: true, type: String, description: 'minLon,minLat,maxLon,maxLat in WGS84' })
  @ApiQuery({ name: 'province', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, enum: ['active'], description: 'Active Sites only' })
  @ApiResponse({ status: 200, description: 'GeoJSON FeatureCollection of intersecting Sites', schema: SITE_FEATURE_COLLECTION_SCHEMA })
  @ApiResponse({ status: 400, description: 'INVALID_BBOX or VALIDATION_ERROR', schema: SITE_ERROR_SCHEMA })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR', schema: SITE_ERROR_SCHEMA })
  async list(@Query() query: SiteGeoJsonQueryDto): Promise<SiteFeatureCollection> {
    if (query.province !== undefined && query.province.length !== 2) throw new BadRequestException();
    const bbox = requireValidBbox(query.bbox);
    return this.siteQueries.withinBbox(bbox, query.province);
  }
}
