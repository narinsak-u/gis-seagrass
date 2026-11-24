import { expect, afterAll, beforeAll, test } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module';
import { createDatabaseProvider, type DatabaseProvider } from '../../src/platform/database';
import { runMigrations } from '../../src/platform/database';
import { setupSwagger } from '../../src/swagger';

const testDatabaseUrl = process.env.IMPORT_TEST_DATABASE_URL;
const integration = testDatabaseUrl ? test : test.skip;
let app: INestApplication | undefined;
let database: DatabaseProvider | undefined;

let origin = '';

beforeAll(async () => {
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
  expect(address && typeof address === 'object').toBeTruthy();
  origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  if (app) await app.close();
  else await database?.close();
});

integration('Swagger UI and OpenAPI document expose the Site API contract over HTTP', async () => {
  const uiResponse = await fetch(`${origin}/docs`);
  expect(uiResponse.status).toBe(200);
  expect(uiResponse.headers.get('content-type') ?? '').toMatch(/text\/html/);
  expect(await uiResponse.text()).toMatch(/swagger-ui/);

  const documentResponse = await fetch(`${origin}/docs-json`);
  expect(documentResponse.status).toBe(200);
  const document = await documentResponse.json() as OpenApiDocument;
  expect(document.openapi.startsWith('3.')).toBe(true);
  expect(document.servers).toStrictEqual([{ url: '/api' }]);

  const paths = document.paths;
  const list = paths['/sites']?.get!;
  const create = paths['/sites']?.post!;
  const bbox = paths['/sites.geojson']?.get!;
  const detail = paths['/sites/{code}']?.get!;
  const update = paths['/sites/{code}']?.patch!;
  const remove = paths['/sites/{code}']?.delete!;
  expect(list && create && bbox && detail && update && remove).toBeTruthy();
  expect(new Set(list.parameters?.map(({ name }) => name))).toStrictEqual(new Set(['status', 'province', 'q', 'page', 'pageSize']));
  expect(new Set(bbox.parameters?.map(({ name }) => name))).toStrictEqual(new Set(['bbox', 'province', 'status']));
  const listSchema = list.responses?.['200']?.content?.['application/json']?.schema;
  const listItem = listSchema?.properties?.items?.items;
  const featureSchema = bbox.responses?.['200']?.content?.['application/json']?.schema;
  const featureStatus = featureSchema?.properties?.features?.items?.properties?.properties?.properties?.siteStatus;
  const listStatus = listItem?.properties?.siteStatus;
  expect(listStatus?.enum).toStrictEqual(['very_good', 'good', 'fair', 'poor', 'no_data']);
  expect(featureStatus?.enum).toStrictEqual(['very_good', 'good', 'fair', 'poor', 'no_data']);
  expect(create.security?.some((scheme) => 'access-token' in scheme)).toBeTruthy();
  expect(create.responses?.['401']).toBeTruthy();
  expect(create.responses?.['403']).toBeTruthy();
  const createSchema = create.requestBody?.content?.['application/json']?.schema!;
  const patchSchema = update.requestBody?.content?.['application/json']?.schema!;
  expect(createSchema && patchSchema).toBeTruthy();
  expect(createSchema.required).toStrictEqual(['type', 'geometry', 'properties']);
  expect(createSchema.properties?.properties?.required).toStrictEqual(['code', 'name']);
  expect(createSchema.properties?.geometry?.required).toStrictEqual(['type', 'coordinates']);
  expect(patchSchema.required).toStrictEqual(['version']);
  expect(update.description ?? '').toMatch(/active admin/i);
  expect(update.description ?? '').toMatch(/editor.*(?:name|geometry).*(?:denied|forbidden|cannot)/i);
  expect(update.responses?.['401'] && update.responses['403']).toBeTruthy();
  expect(update.security?.some((scheme) => 'access-token' in scheme)).toBeTruthy();
  const conflictSchema = update.responses?.['409']?.content?.['application/json']?.schema;
  const versionConflict = conflictSchema?.anyOf?.[1]?.properties?.error?.properties?.details!;
  expect(versionConflict?.properties?.current).toBeTruthy();
  expect(versionConflict.properties!.current.type).toBe('object');

  const detailSchema = detail.responses?.['200']?.content?.['application/json']?.schema!;
  expect(detailSchema).toBeTruthy();
  expect(detailSchema.type).toBe('object');
  expect(detailSchema.required).toStrictEqual(['type', 'geometry', 'properties']);
  expect(detailSchema.properties?.type?.enum?.includes('Feature')).toBe(true);
  expect(detailSchema.properties?.geometry).toBeTruthy();
  expect(detailSchema.properties?.properties?.required).toStrictEqual(['code', 'name', 'province_code', 'area_rai', 'version', 'siteStatus', 'latest_survey']);
  expect(detailSchema.properties?.properties?.properties?.siteStatus?.enum).toStrictEqual(['very_good', 'good', 'fair', 'poor', 'no_data']);
  const latestSurvey = detailSchema.properties?.properties?.properties?.latest_survey!;
  expect(latestSurvey).toBeTruthy();
  expect(latestSurvey.nullable).toBe(true);
  expect(latestSurvey.required).toStrictEqual(['survey_ref', 'surveyed_on', 'cover_percent']);
  expect(latestSurvey.properties?.survey_ref && latestSurvey.properties.surveyed_on && latestSurvey.properties.cover_percent).toBeTruthy();

  const operations = [
    { operation: list, success: '200' },
    { operation: create, success: '201' },
    { operation: bbox, success: '200' },
    { operation: detail, success: '200' },
    { operation: update, success: '200' },
    { operation: remove, success: '204' },
  ];
  expect(remove.security?.some((requirement) => 'access-token' in requirement)).toBeTruthy();
  expect(remove.responses?.['401']).toBeTruthy();
  expect(remove.responses?.['403']).toBeTruthy();

  for (const { operation, success } of operations) {
    const responses = operation?.responses ?? {};
    expect(responses[success], `missing success response ${success}`).toBeTruthy();
    const failures = Object.entries(responses).filter(([status]) => Number(status) >= 400);
    expect(failures.length, 'missing failure response').toBeTruthy();
    for (const [status, response] of failures) {
      if (operation === update && status === '409') {
        expect(response.content?.['application/json']?.schema?.anyOf).toBeTruthy();
      } else {
        expect(response.content?.['application/json']?.schema?.$ref, `failure response ${status} must use the shared error schema`).toBe('#/components/schemas/ApiErrorEnvelope');
      }
    }
  }

  const errorSchema = document.components?.schemas?.ApiErrorEnvelope!;
  expect(errorSchema).toBeTruthy();
  const error = errorSchema.properties?.error;
  expect(error?.properties?.code && error.properties.message && error.properties.details).toBeTruthy();
});

interface OpenApiDocument {
  openapi: string;
  servers?: Array<{ url: string }>;
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
