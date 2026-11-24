import { Controller, Get, Query } from '@nestjs/common';
import { ApiExtraModels, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { ApiErrorEnvelope } from '../../platform/http';
import { ProvinceQueries, type ProvinceFeatureCollection } from '../application/province-queries';
import { requireValidBbox } from './bbox.validation';
import { ProvinceGeoJsonQueryDto } from './sites.dto';
import { PROVINCE_FEATURE_COLLECTION_SCHEMA, SITE_ERROR_SCHEMA } from './sites.openapi';

@ApiExtraModels(ApiErrorEnvelope)
@Controller('provinces.geojson')
export class ProvincesGeoJsonController {
  constructor(private readonly provinceQueries: ProvinceQueries) {}

  @Get()
  @ApiQuery({ name: 'bbox', required: true, type: String, description: 'minLon,minLat,maxLon,maxLat in WGS84' })
  @ApiResponse({ status: 200, description: 'GeoJSON FeatureCollection of intersecting Provinces', schema: PROVINCE_FEATURE_COLLECTION_SCHEMA })
  @ApiResponse({ status: 400, description: 'INVALID_BBOX or VALIDATION_ERROR', schema: SITE_ERROR_SCHEMA })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR', schema: SITE_ERROR_SCHEMA })
  async list(@Query() query: ProvinceGeoJsonQueryDto): Promise<ProvinceFeatureCollection> {
    const bbox = requireValidBbox(query.bbox);
    return this.provinceQueries.withinBbox(bbox);
  }
}
