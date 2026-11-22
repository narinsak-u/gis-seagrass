import { ApiProperty } from '@nestjs/swagger';

export class ApiErrorEnvelope {
  @ApiProperty({ type: 'object', required: ['code', 'message', 'details'], properties: {
    code: { type: 'string' },
    message: { type: 'string' },
    details: { type: 'object', additionalProperties: true },
  } })
  error!: { code: string; message: string; details: Record<string, unknown> };
}

export const SITE_ERROR_SCHEMA = { $ref: '#/components/schemas/ApiErrorEnvelope' } as const;

const siteSummary = {
  type: 'object',
  required: ['code', 'name', 'province_code', 'area_rai', 'version'],
  properties: {
    code: { type: 'string' },
    name: { type: 'string' },
    province_code: { type: 'string' },
    area_rai: { type: 'number' },
    version: { type: 'integer' },
  },
} as const;

const geometry = {
  type: 'object',
  required: ['type', 'coordinates'],
  properties: {
    type: { type: 'string', enum: ['MultiPolygon'] },
    coordinates: { type: 'array', items: { type: 'array', items: { type: 'array', items: { type: 'array', items: { type: 'number' } } } } },
  },
} as const;

export const SITE_LIST_SCHEMA = {
  type: 'object',
  required: ['items', 'total', 'page'],
  properties: {
    items: { type: 'array', items: siteSummary },
    total: { type: 'integer' },
    page: { type: 'integer' },
  },
} as const;

export const SITE_FEATURE_SCHEMA = {
  type: 'object',
  required: ['type', 'geometry', 'properties'],
  properties: {
    type: { type: 'string', enum: ['Feature'] },
    geometry,
    properties: siteSummary,
  },
} as const;

export const SITE_DETAIL_SCHEMA = {
  ...SITE_FEATURE_SCHEMA,
  properties: {
    ...siteSummary,
    required: [...siteSummary.required, 'latest_survey'],
    properties: {
      ...siteSummary.properties,
      latest_survey: {
        oneOf: [
          { type: 'null' },
          {
            type: 'object',
            required: ['survey_ref', 'surveyed_on', 'cover_percent'],
            properties: {
              survey_ref: { type: 'string', nullable: true },
              surveyed_on: { type: 'string', format: 'date' },
              cover_percent: { type: 'number' },
            },
          },
        ],
      },
    },
  },
} as const;

export const SITE_FEATURE_COLLECTION_SCHEMA = {
  type: 'object',
  required: ['type', 'features'],
  properties: {
    type: { type: 'string', enum: ['FeatureCollection'] },
    features: { type: 'array', items: SITE_FEATURE_SCHEMA },
  },
} as const;

export const SITE_CREATE_BODY_SCHEMA = {
  type: 'object',
  required: ['type', 'geometry', 'properties'],
  properties: {
    type: { type: 'string', enum: ['Feature'] },
    geometry: {
      type: 'object',
      required: ['type', 'coordinates'],
      properties: {
        type: { type: 'string', enum: ['Polygon', 'MultiPolygon'] },
        coordinates: { type: 'array' },
      },
    },
    properties: {
      type: 'object',
      required: ['code', 'name'],
      properties: { code: { type: 'string' }, name: { type: 'string' } },
    },
  },
} as const;

export const SITE_PATCH_BODY_SCHEMA = {
  type: 'object',
  required: ['version'],
  properties: {
    version: { type: 'integer', minimum: 1 },
    name: { type: 'string' },
    geometry: SITE_CREATE_BODY_SCHEMA.properties.geometry,
  },
} as const;
