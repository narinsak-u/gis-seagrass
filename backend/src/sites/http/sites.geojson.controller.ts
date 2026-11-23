import { ApiExtraModels, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { SITE_ERROR_SCHEMA, SITE_FEATURE_COLLECTION_SCHEMA } from './site-openapi';
import { ApiErrorEnvelope } from '../../platform/http';
import type { PublicSiteSummary } from '../domain/site.types';
import { SiteReader } from '../application/site-reader';
import { SiteGeoJsonQueryDto } from './site.dto';



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
  constructor(private readonly siteReader: SiteReader) {}

  @Get()
  @ApiQuery({ name: 'bbox', required: true, type: String, description: 'minLon,minLat,maxLon,maxLat in WGS84' })
  @ApiQuery({ name: 'province', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, enum: ['active'], description: 'Active Sites only' })
  @ApiResponse({ status: 200, description: 'GeoJSON FeatureCollection of intersecting Sites', schema: SITE_FEATURE_COLLECTION_SCHEMA })
  @ApiResponse({ status: 400, description: 'INVALID_BBOX or VALIDATION_ERROR', schema: SITE_ERROR_SCHEMA })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR', schema: SITE_ERROR_SCHEMA })
  async list(@Query() query: SiteGeoJsonQueryDto): Promise<SiteFeatureCollection> {
    if (query.province !== undefined && query.province.length !== 2) throw new BadRequestException();
    const bbox = parseBbox(query.bbox);
    if (!bbox) {
      throw new BadRequestException({ code: 'INVALID_BBOX', message: 'Invalid bbox', details: {} });
    }
    return this.siteReader.withinBbox(bbox, query.province);
  }
}

function parseBbox(value: unknown): [number, number, number, number] | undefined {
  if (typeof value !== 'string') return undefined;
  const parts = value.split(',');
  if (parts.length !== 4 || parts.some((part) => part.trim() === '')) return undefined;
  const bounds = parts.map(Number);
  const [minLon, minLat, maxLon, maxLat] = bounds;
  if (!bounds.every(Number.isFinite)
    || minLon < -180 || maxLon > 180 || minLat < -90 || maxLat > 90
    || minLon >= maxLon || minLat >= maxLat) return undefined;
  return [minLon, minLat, maxLon, maxLat];
}
