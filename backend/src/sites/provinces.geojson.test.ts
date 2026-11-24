import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { BadRequestException, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';
import { AppModule } from '../app.module';
import { createDatabaseProvider, runMigrations, type DatabaseProvider } from '../platform/database';
import { setupSwagger } from '../swagger';
import { ProvinceQueries } from './application/province-queries';
import type { ProvinceGeoJsonRow, ProvinceReadRepository } from './application/province-read.repository';
import { parseBbox, requireValidBbox } from './presentation/bbox.validation';

test('shared bbox validation accepts valid WGS84 envelopes and rejects invalid values', () => {
  assert.deepEqual(parseBbox('98.5,7.2,100.4,9.8'), [98.5, 7.2, 100.4, 9.8]);
  assert.deepEqual(requireValidBbox('-180,-90,180,90'), [-180, -90, 180, 90]);

  const invalidCases: unknown[] = [
    undefined,
    '',
    '100,10,102',
    '100,10,,11',
    '100,10,NaN,11',
    '100,10,Infinity,11',
    '-181,10,102,11',
    '100,10,181,11',
    '100,-91,102,11',
    '100,10,102,91',
    '100,10,100,11',
    '100,10,101,10',
    '101,10,100,11',
    '100,11,101,10',
    ['100,10,101,11'],
  ];

  for (const invalid of invalidCases) {
    assert.equal(parseBbox(invalid), undefined, `expected parseBbox(${JSON.stringify(invalid)}) to fail`);
    assert.throws(
      () => requireValidBbox(invalid),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        const payload = error.getResponse() as Record<string, unknown>;
        assert.equal(payload.code, 'INVALID_BBOX');
        return true;
      },
      `expected requireValidBbox(${JSON.stringify(invalid)}) to throw INVALID_BBOX`,
    );
  }
});

test('ProvinceQueries maps repository rows into a GeoJSON FeatureCollection with code and name_th', async () => {
  const sampleGeometry = {
    type: 'MultiPolygon' as const,
    coordinates: [[[[99, 7], [100, 7], [100, 8], [99, 8], [99, 7]]]],
  };
  let capturedBbox: [number, number, number, number] | undefined;
  const repository: ProvinceReadRepository = {
    async withinBbox(bbox): Promise<ProvinceGeoJsonRow[]> {
      capturedBbox = bbox;
      return [
        { code: '81', name_th: 'กระบี่', geometry: sampleGeometry },
        { code: '92', name_th: 'ตรัง', geometry: sampleGeometry },
      ];
    },
  };

  const queries = new ProvinceQueries(repository);
  const collection = await queries.withinBbox([98.5, 7, 100.5, 8.5]);

  assert.deepEqual(capturedBbox, [98.5, 7, 100.5, 8.5]);
  assert.deepEqual(collection, {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: sampleGeometry,
        properties: { code: '81', name_th: 'กระบี่' },
      },
      {
        type: 'Feature',
        geometry: sampleGeometry,
        properties: { code: '92', name_th: 'ตรัง' },
      },
    ],
  });
});

const testDatabaseUrl = process.env.IMPORT_TEST_DATABASE_URL;
const integration = testDatabaseUrl ? test : test.skip;
let app: INestApplication | undefined;
let database: DatabaseProvider | undefined;
let pool: Pool | undefined;
let origin = '';
let provinceCodes: string[] = [];

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
  assert.ok(address && typeof address === 'object');
  origin = `http://127.0.0.1:${address.port}`;
});

after(async () => {
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
  assert.equal(response.status, 200);
  assert.equal(body.type, 'FeatureCollection');
  const features = (body.features as Array<Record<string, unknown>>).filter((feature) =>
    provinceCodes.includes(String((feature.properties as Record<string, unknown>).code)),
  );
  assert.deepEqual(
    features.map((feature) => (feature.properties as Record<string, unknown>).code),
    [provinceCodes[0], provinceCodes[1]],
  );
  assert.deepEqual(features[0], {
    type: 'Feature',
    geometry: {
      type: 'MultiPolygon',
      coordinates: [[[[100, 10], [101, 10], [101, 11], [100, 11], [100, 10]]]],
    },
    properties: { code: provinceCodes[0], name_th: 'จังหวัดตะวันตก' },
  });
  assert.deepEqual(features[1]?.properties, {
    code: provinceCodes[1],
    name_th: 'จังหวัดตะวันออก',
  });
});

integration('GET /provinces.geojson includes interior contact and excludes Provinces outside bbox', async () => {
  const interior = await json('?bbox=100.2,10.2,100.8,10.8');
  assert.equal(interior.response.status, 200);
  const matchingInterior = (interior.body.features as Array<{ properties: { code: string } }>)
    .map(({ properties }) => properties.code)
    .filter((code) => provinceCodes.includes(code));
  assert.deepEqual(matchingInterior, [provinceCodes[0]]);

  const emptyGap = await json('?bbox=102.5,10.2,103.5,10.8');
  assert.equal(emptyGap.response.status, 200);
  const matchingGap = (emptyGap.body.features as Array<{ properties: { code: string } }>)
    .filter(({ properties }) => provinceCodes.includes(properties.code));
  assert.deepEqual(matchingGap, []);
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
    assert.equal(response.status, 400, query);
    const error = body.error as Record<string, unknown>;
    assert.equal(error.code, 'INVALID_BBOX', query);
    assert.equal(typeof error.message, 'string', query);
    assert.equal(typeof error.details, 'object', query);
  }
});

integration('GET /provinces.geojson rejects unsupported query parameters with VALIDATION_ERROR', async () => {
  const { response, body } = await json('?bbox=100,10,102,11&province=81');
  assert.equal(response.status, 400);
  assert.equal((body.error as Record<string, unknown>).code, 'VALIDATION_ERROR');
});

integration('OpenAPI exposes GET /provinces.geojson with bbox parameter and Province FeatureCollection schema', async () => {
  const response = await fetch(`${origin}/docs-json`);
  assert.equal(response.status, 200);
  const doc = await response.json() as {
    paths: Record<string, { get?: { parameters?: Array<{ name: string; required?: boolean }>; responses?: Record<string, { content?: Record<string, { schema?: Record<string, unknown> }> }> } }>;
  };
  const op = doc.paths['/provinces.geojson']?.get;
  assert.ok(op);
  assert.deepEqual(op.parameters?.map(({ name }) => name), ['bbox']);
  assert.equal(op.parameters?.[0]?.required, true);
  assert.ok(op.responses?.['200']);
  assert.equal(
    op.responses?.['400']?.content?.['application/json']?.schema?.$ref,
    '#/components/schemas/ApiErrorEnvelope',
  );
});
