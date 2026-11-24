import { expect, afterAll, beforeAll, test } from 'vitest';
import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';
import { AppModule } from '../../app.module';
import { createDatabaseProvider, runMigrations, type DatabaseProvider } from '../../platform/database';
import { setupSwagger } from '../../swagger';

const testDatabaseUrl = process.env.IMPORT_TEST_DATABASE_URL;
const integration = testDatabaseUrl ? test : test.skip;
let app: INestApplication | undefined;
let database: DatabaseProvider | undefined;
let pool: Pool | undefined;
let origin = '';
let provinceCodes: string[] = [];

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
  pool = database.pool;
  do {
    const value = randomUUID().replaceAll('-', '').toUpperCase();
    const candidates = [value.slice(0, 2), value.slice(2, 4), value.slice(4, 6)].sort();
    if (new Set(candidates).size !== 3) continue;
    const existing = await pool.query('SELECT 1 FROM provinces WHERE code = ANY($1::varchar[])', [candidates]);
    if (!existing.rowCount) {
      provinceCodes = candidates;
      break;
    }
  } while (true);

  await pool.query(
    `INSERT INTO provinces (code, name_th, geom) VALUES
      ($1, 'จังหวัดตะวันตก', ST_Multi(ST_GeomFromText('POLYGON((100 10,101 10,101 11,100 11,100 10))',4326))),
      ($2, 'จังหวัดตะวันออก', ST_Multi(ST_GeomFromText('POLYGON((101 10,102 10,102 11,101 11,101 10))',4326))),
      ($3, 'จังหวัดห่างไกล', ST_Multi(ST_GeomFromText('POLYGON((104 10,105 10,105 11,104 11,104 10))',4326)))`,
    provinceCodes,
  );
  app = await NestFactory.create(AppModule.register(database), { logger: false });
  setupSwagger(app);
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address();
  expect(address && typeof address === 'object').toBeTruthy();
  origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  if (pool && provinceCodes.length) {
    await pool.query('DELETE FROM provinces WHERE code = ANY($1::varchar[])', [provinceCodes]);
  }
  if (app) await app.close();
  else await database?.close();
});

async function json(query: string): Promise<{ response: Response; body: Record<string, unknown> }> {
  const response = await fetch(`${origin}/provinces.geojson${query}`);
  return { response, body: await response.json() as Record<string, unknown> };
}

integration('GET /provinces.geojson returns sorted Province MultiPolygons including boundary contact', async () => {
  // Bbox touches the shared boundary at longitude 101 and extends into the east province
  const { response, body } = await json('?bbox=101,10.2,101.5,10.8');
  expect(response.status).toBe(200);
  expect(body.type).toBe('FeatureCollection');
  const features = (body.features as Array<Record<string, unknown>>).filter((feature) =>
    provinceCodes.includes(String((feature.properties as Record<string, unknown>).code)),
  );
  expect(features.map((feature) => (feature.properties as Record<string, unknown>).code)).toStrictEqual([provinceCodes[0], provinceCodes[1]]);
  expect(features[0]).toStrictEqual({
    type: 'Feature',
    geometry: {
      type: 'MultiPolygon',
      coordinates: [[[[100, 10], [101, 10], [101, 11], [100, 11], [100, 10]]]],
    },
    properties: { code: provinceCodes[0], name_th: 'จังหวัดตะวันตก' },
  });
  expect(features[1]?.properties).toStrictEqual({
    code: provinceCodes[1],
    name_th: 'จังหวัดตะวันออก',
  });
});

integration('GET /provinces.geojson includes interior contact and excludes Provinces outside bbox', async () => {
  const interior = await json('?bbox=100.2,10.2,100.8,10.8');
  expect(interior.response.status).toBe(200);
  const matchingInterior = (interior.body.features as Array<{ properties: { code: string } }>)
    .map(({ properties }) => properties.code)
    .filter((code) => provinceCodes.includes(code));
  expect(matchingInterior).toStrictEqual([provinceCodes[0]]);

  const emptyGap = await json('?bbox=102.5,10.2,103.5,10.8');
  expect(emptyGap.response.status).toBe(200);
  const matchingGap = (emptyGap.body.features as Array<{ properties: { code: string } }>)
    .filter(({ properties }) => provinceCodes.includes(properties.code));
  expect(matchingGap).toStrictEqual([]);
});

integration('GET /provinces.geojson rejects missing, malformed, out-of-range, zero-size, and inverted bboxes', async () => {
  for (const query of [
    '',
    '?bbox=100,10,102',
    '?bbox=100,10,NaN,11',
    '?bbox=-181,10,102,11',
    '?bbox=100,10,181,11',
    '?bbox=100,-91,102,11',
    '?bbox=100,10,102,91',
    '?bbox=100,10,100,11',
    '?bbox=100,10,101,10',
    '?bbox=101,10,100,11',
    '?bbox=100,11,101,10',
  ]) {
    const { response, body } = await json(query);
    expect(response.status, query).toBe(400);
    const error = body.error as Record<string, unknown>;
    expect(error.code, query).toBe('INVALID_BBOX');
    expect(typeof error.message, query).toBe('string');
    expect(typeof error.details, query).toBe('object');
  }
});

integration('GET /provinces.geojson rejects unsupported query parameters with VALIDATION_ERROR', async () => {
  const { response, body } = await json('?bbox=100,10,102,11&province=81');
  expect(response.status).toBe(400);
  expect((body.error as Record<string, unknown>).code).toBe('VALIDATION_ERROR');
});

integration('OpenAPI exposes GET /provinces.geojson with bbox parameter and Province FeatureCollection schema', async () => {
  const response = await fetch(`${origin}/docs-json`);
  expect(response.status).toBe(200);
  const doc = await response.json() as {
    paths: Record<string, { get?: { parameters?: Array<{ name: string; required?: boolean }>; responses?: Record<string, { content?: Record<string, { schema?: Record<string, unknown> }> }> } }>;
  };
  const op = doc.paths['/provinces.geojson']?.get!;
  expect(op).toBeTruthy();
  expect(op.parameters?.map(({ name }) => name)).toStrictEqual(['bbox']);
  expect(op.parameters?.[0]?.required).toBe(true);
  expect(op.responses?.['200']).toBeTruthy();
  expect(op.responses?.['400']?.content?.['application/json']?.schema?.$ref).toBe('#/components/schemas/ApiErrorEnvelope');
});
