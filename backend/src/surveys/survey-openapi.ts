export const SURVEY_ERROR_SCHEMA = {
  type: 'object', required: ['error'], properties: {
    error: { type: 'object', required: ['code', 'message', 'details'], properties: {
      code: { type: 'string' }, message: { type: 'string' }, details: { type: 'object', additionalProperties: true },
    } },
  },
};

const survey = {
  type: 'object', required: ['id', 'lon', 'lat', 'surveyed_on', 'cover_percent', 'species', 'note'], properties: {
    id: { type: 'string', pattern: '^[1-9][0-9]*$' }, lon: { type: 'number', minimum: -180, maximum: 180 },
    lat: { type: 'number', minimum: -90, maximum: 90 }, surveyed_on: { type: 'string', format: 'date' },
    cover_percent: { type: 'number', minimum: 0, maximum: 100 }, species: { type: 'array', items: { type: 'string' } },
    note: { type: 'string', nullable: true },
  }, additionalProperties: false,
};

export const SURVEY_LIST_SCHEMA = {
  type: 'object', required: ['items', 'total', 'page'], properties: {
    items: { type: 'array', items: survey }, total: { type: 'integer' }, page: { type: 'integer' },
  },
};
export const SURVEY_WRITE_SCHEMA = {
  ...survey,
  required: [...survey.required, 'siteStatus'],
  properties: { ...survey.properties, siteStatus: { type: 'string', enum: ['very_good', 'good', 'fair', 'poor', 'no_data'] } },
};
export const SURVEY_CREATE_BODY_SCHEMA = {
  type: 'object', required: ['lon', 'lat', 'surveyed_on', 'cover_percent', 'species'],
  properties: {
    lon: { type: 'number', minimum: -180, maximum: 180 }, lat: { type: 'number', minimum: -90, maximum: 90 },
    surveyed_on: { type: 'string', format: 'date' }, cover_percent: { type: 'number', minimum: 0, maximum: 100 },
    species: { type: 'array', items: { type: 'string' } }, note: { type: 'string', nullable: true },
  }, additionalProperties: false,
};
export const SURVEY_PATCH_BODY_SCHEMA = {
  ...SURVEY_CREATE_BODY_SCHEMA,
  required: [],
};
