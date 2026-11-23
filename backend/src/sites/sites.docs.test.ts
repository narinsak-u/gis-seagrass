import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createDatabaseProvider, type DatabaseProvider } from '../database/provider';
import { runMigrations } from '../database/migrate';
import { setupSwagger } from '../swagger';

const testDatabaseUrl = process.env.IMPORT_TEST_DATABASE_URL;
const integration = testDatabaseUrl ? test : test.skip;
let app: INestApplication | undefined;
let database: DatabaseProvider | undefined;

before(async () => {
  process.env.JWT_SECRET ??= 'isolated-integration-signing-secret-32-bytes';
  if (!testDatabaseUrl) return;
  const url = new URL(testDatabaseUrl);
  process.env.PGHOST = url.hostname;
  process.env.PGPORT = url.port || '5432';
  process.env.PGUSER = decodeURIComponent(url.username);
  process.env.PGPASSWORD = decodeURIComponent(url.password);
  process.env.PGDATABASE = decodeURIComponent(url.pathname.slice(1));
  database = createDatabaseProvider();
  await runMigrations(database);
  app = await NestFactory.create(AppModule.register(database), { logger: false });
  setupSwagger(app);
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address();
  assert.ok(address && typeof address === 'object');
  origin = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (app) await app.close();
  else await database?.close();
});

integration('Swagger UI and OpenAPI document expose the Site API contract over HTTP', async () => {
  const uiResponse = await fetch(`${origin}/docs`);
  assert.equal(uiResponse.status, 200);
  assert.match(uiResponse.headers.get('content-type') ?? '', /text\/html/);
  assert.match(await uiResponse.text(), /swagger-ui/);

  const documentResponse = await fetch(`${origin}/docs-json`);
  assert.equal(documentResponse.status, 200);
  const document = await documentResponse.json() as OpenApiDocument;
  assert.equal(document.openapi.startsWith('3.'), true);

  const paths = document.paths;
  const list = paths['/sites']?.get;
  const create = paths['/sites']?.post;
  const bbox = paths['/sites.geojson']?.get;
  const detail = paths['/sites/{code}']?.get;
  const update = paths['/sites/{code}']?.patch;
  const remove = paths['/sites/{code}']?.delete;
  assert.ok(list && create && bbox && detail && update && remove);
  assert.deepEqual(new Set(list.parameters?.map(({ name }) => name)), new Set(['status', 'province', 'q', 'page', 'pageSize']));
  assert.deepEqual(new Set(bbox.parameters?.map(({ name }) => name)), new Set(['bbox', 'province', 'status']));
  const listSchema = list.responses?.['200']?.content?.['application/json']?.schema;
  const listItem = listSchema?.properties?.items?.items;
  const featureSchema = bbox.responses?.['200']?.content?.['application/json']?.schema;
  const featureStatus = featureSchema?.properties?.features?.items?.properties?.properties?.properties?.siteStatus;
  const listStatus = listItem?.properties?.siteStatus;
  assert.deepEqual(listStatus?.enum, ['very_good', 'good', 'fair', 'poor', 'no_data']);
  assert.deepEqual(featureStatus?.enum, ['very_good', 'good', 'fair', 'poor', 'no_data']);
  assert.ok(create.security?.some((scheme) => 'access-token' in scheme));
  assert.ok(create.responses?.['401']);
  assert.ok(create.responses?.['403']);
  const createSchema = create.requestBody?.content?.['application/json']?.schema;
  const patchSchema = update.requestBody?.content?.['application/json']?.schema;
  assert.ok(createSchema && patchSchema);
  assert.deepEqual(createSchema.required, ['type', 'geometry', 'properties']);
  assert.deepEqual(createSchema.properties?.properties?.required, ['code', 'name']);
  assert.deepEqual(createSchema.properties?.geometry?.required, ['type', 'coordinates']);
  assert.deepEqual(patchSchema.required, ['version']);
  assert.match(update.description ?? '', /active admin/i);
  assert.match(update.description ?? '', /editor.*(?:name|geometry).*(?:denied|forbidden|cannot)/i);
  assert.ok(update.responses?.['401'] && update.responses['403']);
  assert.ok(update.security?.some((scheme) => 'access-token' in scheme));
  const conflictSchema = update.responses?.['409']?.content?.['application/json']?.schema;
  const versionConflict = conflictSchema?.anyOf?.[1]?.properties?.error?.properties?.details;
  assert.ok(versionConflict?.properties?.current);
  assert.equal(versionConflict.properties.current.type, 'object');

  const detailSchema = detail.responses?.['200']?.content?.['application/json']?.schema;
  assert.ok(detailSchema);
  assert.equal(detailSchema.type, 'object');
  assert.deepEqual(detailSchema.required, ['type', 'geometry', 'properties']);
  assert.equal(detailSchema.properties?.type?.enum?.includes('Feature'), true);
  assert.ok(detailSchema.properties?.geometry);
  assert.deepEqual(
    detailSchema.properties?.properties?.required,
    ['code', 'name', 'province_code', 'area_rai', 'version', 'siteStatus', 'latest_survey'],
  );
  assert.deepEqual(detailSchema.properties?.properties?.properties?.siteStatus?.enum, ['very_good', 'good', 'fair', 'poor', 'no_data']);
  const latestSurvey = detailSchema.properties?.properties?.properties?.latest_survey;
  assert.ok(latestSurvey);
  assert.equal(latestSurvey.nullable, true);
  assert.deepEqual(latestSurvey.required, ['survey_ref', 'surveyed_on', 'cover_percent']);
  assert.ok(latestSurvey.properties?.survey_ref && latestSurvey.properties.surveyed_on && latestSurvey.properties.cover_percent);

  const operations = [
    { operation: list, success: '200' },
    { operation: create, success: '201' },
    { operation: bbox, success: '200' },
    { operation: detail, success: '200' },
    { operation: update, success: '200' },
    { operation: remove, success: '204' },
  ];
  assert.ok(remove.security?.some((requirement) => 'access-token' in requirement));
  assert.ok(remove.responses?.['401']);
  assert.ok(remove.responses?.['403']);

  for (const { operation, success } of operations) {
    const responses = operation?.responses ?? {};
    assert.ok(responses[success], `missing success response ${success}`);
    const failures = Object.entries(responses).filter(([status]) => Number(status) >= 400);
    assert.ok(failures.length, 'missing failure response');
    for (const [status, response] of failures) {
      if (operation === update && status === '409') {
        assert.ok(response.content?.['application/json']?.schema?.anyOf);
      } else {
        assert.equal(
          response.content?.['application/json']?.schema?.$ref,
          '#/components/schemas/ApiErrorEnvelope',
          `failure response ${status} must use the shared error schema`,
        );
      }
    }
  }

  const errorSchema = document.components?.schemas?.ApiErrorEnvelope;
  assert.ok(errorSchema);
  const error = errorSchema.properties?.error;
  assert.ok(error?.properties?.code && error.properties.message && error.properties.details);
});

interface OpenApiDocument {
  openapi: string;
  paths: Record<string, Partial<Record<'get' | 'post' | 'patch' | 'delete', OpenApiOperation>>>;
  components?: { schemas?: Record<string, OpenApiSchema> };
}

interface OpenApiOperation {
  description?: string;
  parameters?: Array<{ name: string }>;
  requestBody?: { content?: Record<string, { schema?: OpenApiSchema }> };
  responses?: Record<string, OpenApiResponse>;
  security?: Array<Record<string, string[]>>;
}
interface OpenApiResponse {
  content?: Record<string, { schema?: OpenApiSchema }>;
}

interface OpenApiSchema {
  $ref?: string;
  type?: string;
  nullable?: boolean;
  required?: string[];
  enum?: string[];
  properties?: Record<string, OpenApiSchema>;
  items?: OpenApiSchema;
  anyOf?: OpenApiSchema[];
}
