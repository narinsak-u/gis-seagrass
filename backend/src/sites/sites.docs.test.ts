import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { runMigrations } from '../database/migrate';
import { setupSwagger } from '../swagger';

const testDatabaseUrl = process.env.IMPORT_TEST_DATABASE_URL;
const integration = testDatabaseUrl ? test : test.skip;
let app: INestApplication | undefined;
let origin = '';

before(async () => {
  if (!testDatabaseUrl) return;
  const url = new URL(testDatabaseUrl);
  process.env.PGHOST = url.hostname;
  process.env.PGPORT = url.port || '5432';
  process.env.PGUSER = decodeURIComponent(url.username);
  process.env.PGPASSWORD = decodeURIComponent(url.password);
  process.env.PGDATABASE = decodeURIComponent(url.pathname.slice(1));
  await runMigrations();
  app = await NestFactory.create(AppModule, { logger: false });
  setupSwagger(app);
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address();
  assert.ok(address && typeof address === 'object');
  origin = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await app?.close();
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
  assert.ok(create.requestBody?.content?.['application/json']?.schema);
  assert.ok(update.requestBody?.content?.['application/json']?.schema);

  const operations = [
    { operation: list, success: '200' },
    { operation: create, success: '201' },
    { operation: bbox, success: '200' },
    { operation: detail, success: '200' },
    { operation: update, success: '200' },
    { operation: remove, success: '204' },
  ];

  for (const { operation, success } of operations) {
    const responses = operation?.responses ?? {};
    assert.ok(responses[success], `missing success response ${success}`);
    const failures = Object.entries(responses).filter(([status]) => Number(status) >= 400);
    assert.ok(failures.length, 'missing failure response');
    for (const [status, response] of failures) {
      assert.equal(
        response.content?.['application/json']?.schema?.$ref,
        '#/components/schemas/ApiErrorEnvelope',
        `failure response ${status} must use the shared error schema`,
      );
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
  parameters?: Array<{ name: string }>;
  requestBody?: { content?: Record<string, { schema?: OpenApiSchema }> };
  responses?: Record<string, OpenApiResponse>;
}
interface OpenApiResponse {
  content?: Record<string, { schema?: { $ref?: string } }>;
}

interface OpenApiSchema {
  properties?: Record<string, OpenApiSchema>;
}

