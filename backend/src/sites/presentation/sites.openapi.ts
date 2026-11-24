import type { SchemaObject } from '@nestjs/swagger';

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
} satisfies SchemaObject;

const geometry = {
  type: 'object',
  required: ['type', 'coordinates'],
  properties: {
    type: { type: 'string', enum: ['MultiPolygon'] },
    coordinates: { type: 'array', items: { type: 'array', items: { type: 'array', items: { type: 'array', items: { type: 'number' } } } } },
  },
} satisfies SchemaObject;

export const SITE_LIST_SCHEMA = {
  type: 'object',
  required: ['items', 'total', 'page'],
  properties: {
    items: { type: 'array', items: {
      ...siteSummary,
      required: [...siteSummary.required, 'siteStatus'],
      properties: { ...siteSummary.properties, siteStatus: { type: 'string', enum: ['very_good', 'good', 'fair', 'poor', 'no_data'] } },
    } },
    total: { type: 'integer' },
    page: { type: 'integer' },
  },
} satisfies SchemaObject;

export const SITE_FEATURE_SCHEMA = {
  type: 'object',
  required: ['type', 'geometry', 'properties'],
  properties: {
    type: { type: 'string', enum: ['Feature'] },
    geometry,
    properties: siteSummary,
  },
} satisfies SchemaObject;
export const SITE_PATCH_ERROR_SCHEMA = {
  anyOf: [
    SITE_ERROR_SCHEMA,
    {
      type: 'object',
      required: ['error'],
      properties: {
        error: {
          type: 'object',
          required: ['code', 'message', 'details'],
          properties: {
            code: { type: 'string', enum: ['VERSION_CONFLICT'] },
            message: { type: 'string' },
            details: { type: 'object', required: ['current'], properties: { current: SITE_FEATURE_SCHEMA } },
          },
        },
      },
    },
  ],
} satisfies SchemaObject;
const publicSiteFeatureSchema = {
  ...SITE_FEATURE_SCHEMA,
  properties: {
    ...SITE_FEATURE_SCHEMA.properties,
    properties: {
      ...siteSummary,
      required: [...siteSummary.required, 'siteStatus'],
      properties: { ...siteSummary.properties, siteStatus: { type: 'string', enum: ['very_good', 'good', 'fair', 'poor', 'no_data'] } },
    },
  },
} satisfies SchemaObject;


export const SITE_DETAIL_SCHEMA = {
  type: 'object',
  required: ['type', 'geometry', 'properties'],
  properties: {
    type: { type: 'string', enum: ['Feature'] },
    geometry,
    properties: {
      type: 'object',
      required: ['code', 'name', 'province_code', 'area_rai', 'version', 'siteStatus', 'latest_survey'],
      properties: {
        ...siteSummary.properties,
        siteStatus: { type: 'string', enum: ['very_good', 'good', 'fair', 'poor', 'no_data'] },
        latest_survey: {
          type: 'object',
          nullable: true,
          required: ['survey_ref', 'surveyed_on', 'cover_percent'],
          properties: {
            survey_ref: { type: 'string', nullable: true },
            surveyed_on: { type: 'string', format: 'date' },
            cover_percent: { type: 'number' },
          },
        },
      },
    },
  },
} satisfies SchemaObject;

export const SITE_FEATURE_COLLECTION_SCHEMA = {
  type: 'object',
  required: ['type', 'features'],
  properties: {
    type: { type: 'string', enum: ['FeatureCollection'] },
    features: { type: 'array', items: publicSiteFeatureSchema },
  },
} satisfies SchemaObject;

const provinceFeatureSchema = {
  type: 'object',
  required: ['type', 'geometry', 'properties'],
  properties: {
    type: { type: 'string', enum: ['Feature'] },
    geometry,
    properties: {
      type: 'object',
      required: ['code', 'name_th'],
      properties: {
        code: { type: 'string' },
        name_th: { type: 'string' },
      },
    },
  },
} satisfies SchemaObject;

export const PROVINCE_FEATURE_COLLECTION_SCHEMA = {
  type: 'object',
  required: ['type', 'features'],
  properties: {
    type: { type: 'string', enum: ['FeatureCollection'] },
    features: { type: 'array', items: provinceFeatureSchema },
  },
} satisfies SchemaObject;

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
} satisfies SchemaObject;

export const SITE_PATCH_BODY_SCHEMA = {
  type: 'object',
  required: ['version'],
  properties: {
    version: { type: 'integer', minimum: 1 },
    name: { type: 'string' },
    geometry: SITE_CREATE_BODY_SCHEMA.properties.geometry,
  },
} satisfies SchemaObject;
