import { ApiExtraModels, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { ApiErrorEnvelope, SITE_ERROR_SCHEMA, SITE_FEATURE_COLLECTION_SCHEMA } from './site-openapi';
import type { SiteSummary } from './site.types';


interface SiteFeature {
  type: 'Feature';
  geometry: { type: 'MultiPolygon'; coordinates: number[][][][] };
  properties: SiteSummary;
}

interface SiteFeatureCollection {
  type: 'FeatureCollection';
  features: SiteFeature[];
}

const ALLOWED_QUERY_KEYS = ['bbox', 'province', 'status'];

@ApiExtraModels(ApiErrorEnvelope)
@Controller('sites.geojson')
export class SitesGeoJsonController {
  constructor(private readonly pool: Pool) {}

  @Get()
  @ApiQuery({ name: 'bbox', required: true, type: String, description: 'minLon,minLat,maxLon,maxLat in WGS84' })
  @ApiQuery({ name: 'province', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, enum: ['active'], description: 'Active Sites only' })
  @ApiResponse({ status: 200, description: 'GeoJSON FeatureCollection of intersecting Sites', schema: SITE_FEATURE_COLLECTION_SCHEMA })
  @ApiResponse({ status: 400, description: 'INVALID_BBOX or VALIDATION_ERROR', schema: SITE_ERROR_SCHEMA })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR', schema: SITE_ERROR_SCHEMA })
  async list(@Query() query: Record<string, unknown>): Promise<SiteFeatureCollection> {
    if (Object.keys(query).some((key) => !ALLOWED_QUERY_KEYS.includes(key))) throw new BadRequestException();
    if (query.status !== undefined && query.status !== 'active') throw new BadRequestException();
    if (query.province !== undefined && (typeof query.province !== 'string' || query.province.length !== 2)) {
      throw new BadRequestException();
    }

    const bbox = parseBbox(query.bbox);
    if (!bbox) {
      throw new BadRequestException({ code: 'INVALID_BBOX', message: 'Invalid bbox', details: {} });
    }
    const values: Array<string | number> = [...bbox];
    const provinceFilter = query.province === undefined ? '' : ` AND s.province_code = $${values.push(query.province)}`;
    const result = await this.pool.query<{
      code: string;
      name: string;
      province_code: string;
      area_rai: string;
      version: number;
      geometry: SiteFeature['geometry'];
    }>(
      `SELECT s.code, s.name, s.province_code, s.area_rai::text, s.version,
              ST_AsGeoJSON(s.geom, 15)::jsonb AS geometry
         FROM sites s
        WHERE s.deleted_at IS NULL
          AND ST_Intersects(s.geom, ST_MakeEnvelope($1, $2, $3, $4, 4326))${provinceFilter}
        ORDER BY s.code ASC`,
      values,
    );
    return {
      type: 'FeatureCollection',
      features: result.rows.map((row) => ({
        type: 'Feature',
        geometry: row.geometry,
        properties: {
          code: row.code,
          name: row.name,
          province_code: row.province_code,
          area_rai: Number(row.area_rai),
          version: row.version,
        },
      })),
    };
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
