import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';
import { AppModule } from '../app.module';
import { createDatabaseProvider, type DatabaseProvider } from '../platform/database';
import { runMigrations } from '../platform/database';

const testDatabaseUrl = process.env.IMPORT_TEST_DATABASE_URL;
const integration = testDatabaseUrl ? test : test.skip;
let app: INestApplication | undefined;
let database: DatabaseProvider | undefined;
let pool: Pool | undefined;
let origin = '';
let provinceCodes: string[] = [];
let siteCodes: string[] = [];
let token = '';

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
    provinceCodes = [value.slice(0, 2), value.slice(2, 4)];
    token = value.slice(4, 12);
    siteCodes = ['ALPHA', 'BOUNDARY', 'OUTSIDE', 'RETIRED'].map((name) => `${name}-${token}`);
    if (provinceCodes[0] === provinceCodes[1]) continue;
    const existing = await pool.query(
      'SELECT 1 FROM provinces WHERE code = ANY($1::varchar[]) UNION ALL SELECT 1 FROM sites WHERE code = ANY($2::text[])',
      [provinceCodes, siteCodes],
    );
    if (!existing.rowCount) break;
  } while (true);
  await pool.query(
    `INSERT INTO provinces (code, name_th, geom) VALUES
      ($1, 'West', ST_Multi(ST_GeomFromText('POLYGON((100 10,101 10,101 11,100 11,100 10))',4326))),
      ($2, 'East', ST_Multi(ST_GeomFromText('POLYGON((101 10,102 10,102 11,101 11,101 10))',4326)))`,
    provinceCodes,
  );
  await pool.query(
    `INSERT INTO sites (code,name,province_code,geom,area_rai,deleted_at) VALUES
      ($1,'Alpha meadow',$2,ST_Multi(ST_GeomFromText('POLYGON((100.1 10.1,100.2 10.1,100.2 10.2,100.1 10.2,100.1 10.1))',4326)),1,NULL),
      ($3,'Boundary reef',$2,ST_Multi(ST_GeomFromText('POLYGON((100.3 10.1,100.4 10.1,100.4 10.2,100.3 10.2,100.3 10.1))',4326)),2,NULL),
      ($5,'East meadow',$4,ST_Multi(ST_GeomFromText('POLYGON((101.1 10.1,101.2 10.1,101.2 10.2,101.1 10.2,101.1 10.1))',4326)),3,NULL),
      ($6,'Retired meadow',$2,ST_Multi(ST_GeomFromText('POLYGON((100.7 10.1,100.8 10.1,100.8 10.2,100.7 10.2,100.7 10.1))',4326)),4,now())`,
    [siteCodes[0], provinceCodes[0], siteCodes[1], provinceCodes[1], siteCodes[2], siteCodes[3]],
  );
  app = await NestFactory.create(AppModule.register(database), { logger: false });
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address();
  assert.ok(address && typeof address === 'object');
  origin = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (pool) {
    await pool.query('DELETE FROM sites WHERE code = ANY($1::text[])', [siteCodes]);
    await pool.query('DELETE FROM provinces WHERE code = ANY($1::varchar[])', [provinceCodes]);
  }
  if (app) await app.close();
  else await database?.close();
});

async function json(query: string): Promise<{ response: Response; body: Record<string, unknown> }> {
  const response = await fetch(`${origin}/sites.geojson${query}`);
  return { response, body: await response.json() as Record<string, unknown> };
}

integration('GET /sites.geojson returns sorted active Features including boundary contact', async () => {
  const { response, body } = await json('?bbox=100.2,10.1,100.3,10.2');
  assert.equal(response.status, 200);
  assert.equal(body.type, 'FeatureCollection');
  const features = body.features as Array<Record<string, unknown>>;
  assert.deepEqual(features.map((feature) => (feature.properties as Record<string, unknown>).code), [siteCodes[0], siteCodes[1]]);
  assert.deepEqual(features[0], {
    type: 'Feature',
    geometry: {
      type: 'MultiPolygon',
      coordinates: [[[[100.1, 10.1], [100.2, 10.1], [100.2, 10.2], [100.1, 10.2], [100.1, 10.1]]]],
    },
    properties: { code: siteCodes[0], name: 'Alpha meadow', province_code: provinceCodes[0], area_rai: 1, version: 1, siteStatus: 'no_data' },
  });
});

integration('GET /sites.geojson filters by province and active status', async () => {
  const { response, body } = await json(`?bbox=100,10,102,11&province=${provinceCodes[1]}&status=active`);
  assert.equal(response.status, 200);
  assert.deepEqual(
    (body.features as Array<{ properties: { code: string; province_code: string } }>).map(({ properties }) => [properties.code, properties.province_code]),
    [[siteCodes[2], provinceCodes[1]]],
  );
});

integration('GET /sites.geojson includes interior contact and excludes nonintersecting or deleted Sites', async () => {
  const interior = await json('?bbox=100.11,10.11,100.19,10.19');
  assert.equal(interior.response.status, 200);
  assert.deepEqual(
    (interior.body.features as Array<{ properties: { code: string } }>).map(({ properties }) => properties.code),
    [siteCodes[0]],
  );
  const nonintersecting = await json('?bbox=100.5,10.1,100.6,10.2');
  assert.deepEqual(nonintersecting.body.features, []);
  const retired = await json('?bbox=100.7,10.1,100.8,10.2');
  assert.deepEqual(retired.body.features, []);
});

integration('GET /sites.geojson rejects missing, malformed, out-of-range, zero-size, and inverted bboxes', async () => {
  for (const query of ['', '?bbox=100,10,102', '?bbox=100,10,NaN,11', '?bbox=-181,10,102,11', '?bbox=100,10,100,11', '?bbox=101,10,100,11', '?bbox=100,11,101,10']) {
    const { response, body } = await json(query);
    assert.equal(response.status, 400, query);
    assert.equal((body.error as Record<string, unknown>).code, 'INVALID_BBOX', query);
  }
});

integration('GET /sites.geojson rejects unsupported status', async () => {
  const { response, body } = await json('?bbox=100,10,102,11&status=deleted');
  assert.equal(response.status, 400);
  assert.equal((body.error as Record<string, unknown>).code, 'VALIDATION_ERROR');
});
