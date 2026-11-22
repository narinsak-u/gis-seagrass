import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';
import { AppModule } from '../app.module';
import { runMigrations } from '../database/migrate';

const testDatabaseUrl = process.env.IMPORT_TEST_DATABASE_URL;
const integration = testDatabaseUrl ? test : test.skip;
let app: INestApplication | undefined;
let pool: Pool | undefined;
let origin = '';
let provinceCodes: string[] = [];
let siteCodes: string[] = [];
let createdSiteCodes: string[] = [];
let siteToken = '';
let postToken = '';

before(async () => {
  if (!testDatabaseUrl) return;
  const url = new URL(testDatabaseUrl);
  process.env.PGHOST = url.hostname;
  process.env.PGPORT = url.port || '5432';
  process.env.PGUSER = decodeURIComponent(url.username);
  process.env.PGPASSWORD = decodeURIComponent(url.password);
  process.env.PGDATABASE = decodeURIComponent(url.pathname.slice(1));
  await runMigrations();
  pool = new Pool({ connectionString: testDatabaseUrl });
  do {
    const token = randomUUID().replaceAll('-', '').toUpperCase();
    provinceCodes = [token.slice(0, 2), token.slice(2, 4)];
    siteToken = token.slice(4, 12);
    postToken = `POST-${token.slice(12, 16)}`;
    siteCodes = ['ALPHA', 'BETA', 'GAMMA', 'HISTORY'].map((name) => `${name}-${siteToken}`);
    const postCodes = ['POST', 'MULTI', 'TIE', 'BAD', 'TOUCH'].map((name) => `${name}-${postToken}`);
    if (provinceCodes[0] === provinceCodes[1]) continue;
    const existing = await pool.query(
      'SELECT 1 FROM provinces WHERE code = ANY($1::varchar[]) UNION ALL SELECT 1 FROM sites WHERE code = ANY($2::text[])',
      [provinceCodes, [...siteCodes, ...postCodes]],
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
      ($1,'Zebra meadow',$2,ST_Multi(ST_GeomFromText('POLYGON((100.1 10.1,100.2 10.1,100.2 10.2,100.1 10.2,100.1 10.1))',4326)),1,NULL),
      ($3,'alpha lagoon',$4,ST_Multi(ST_GeomFromText('POLYGON((100.3 10.1,100.4 10.1,100.4 10.2,100.3 10.2,100.3 10.1))',4326)),2,NULL),
      ($5,'Another zone',$6,ST_Multi(ST_GeomFromText('POLYGON((101.1 10.1,101.2 10.1,101.2 10.2,101.1 10.2,101.1 10.1))',4326)),3,NULL),
      ($7,'Retired site',$2,ST_Multi(ST_GeomFromText('POLYGON((100.5 10.1,100.6 10.1,100.6 10.2,100.5 10.2,100.5 10.1))',4326)),1,now())`,
    [siteCodes[0], provinceCodes[0], siteCodes[1], provinceCodes[0], siteCodes[2], provinceCodes[1], siteCodes[3]],
  );
  app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address();
  assert.ok(address && typeof address === 'object');
  origin = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await app?.close();
  if (pool) {
    await pool.query('DELETE FROM sites WHERE code = ANY($1::text[])', [[...siteCodes, ...createdSiteCodes]]);
    await pool.query('DELETE FROM provinces WHERE code = ANY($1::varchar[])', [provinceCodes]);
    await pool.end();
  }
});

async function json(path: string): Promise<{ response: Response; body: Record<string, unknown> }> {
  const response = await fetch(`${origin}${path}`);
  return { response, body: await response.json() as Record<string, unknown> };
}

async function createSite(feature: unknown): Promise<{ response: Response; body: Record<string, unknown> }> {
  const properties = feature && typeof feature === 'object' && 'properties' in feature ? feature.properties : undefined;
  const code = properties && typeof properties === 'object' && 'code' in properties ? properties.code : undefined;
  if (typeof code === 'string') createdSiteCodes.push(code);
  const response = await fetch(`${origin}/sites`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(feature),
  });
  return { response, body: await response.json() as Record<string, unknown> };
}

const polygon = (west: number, south: number, east: number, north: number) => ({
  type: 'Polygon',
  coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
});

const siteFeature = (code: string, geometry: unknown, extra: Record<string, unknown> = {}) => ({
  type: 'Feature',
  geometry,
  properties: { code, name: `New ${code}`, ...extra },
});

integration('POST /sites stores Polygon as MultiPolygon and returns server-derived values', async () => {
  const feature = siteFeature(`POST-${postToken}`, polygon(100.15, 10.15, 100.25, 10.25));
  const { response, body } = await createSite(feature);
  assert.equal(response.status, 201);
  assert.deepEqual(Object.keys(body).sort(), ['geometry', 'properties', 'type']);
  assert.equal(body.type, 'Feature');
  assert.deepEqual((body.geometry as Record<string, unknown>).type, 'MultiPolygon');
  const properties = body.properties as Record<string, unknown>;
  assert.deepEqual(properties, {
    code: `POST-${postToken}`,
    name: `New POST-${postToken}`,
    province_code: provinceCodes[0],
    area_rai: properties.area_rai,
    version: 1,
  });
  assert.equal(typeof properties.area_rai, 'number');
  const stored = await pool!.query<{ area_rai: string; geometrytype: string; province_code: string }>(
    `SELECT area_rai::text, ST_GeometryType(geom) AS geometrytype, province_code
       FROM sites WHERE code = $1`,
    [`POST-${postToken}`],
  );
  assert.equal(stored.rows[0].geometrytype, 'ST_MultiPolygon');
  assert.equal(stored.rows[0].province_code, provinceCodes[0]);
  assert.equal(properties.area_rai, Number(stored.rows[0].area_rai));
});

integration('POST /sites accepts MultiPolygon, chooses greatest overlap and allows Site overlap', async () => {
  const { response, body } = await createSite(siteFeature(`MULTI-${postToken}`, {
    type: 'MultiPolygon',
    coordinates: [
      polygon(100.3, 10.3, 100.4, 10.4).coordinates,
      polygon(101.1, 10.1, 101.3, 10.3).coordinates,
    ],
  }));
  assert.equal(response.status, 201);
  assert.equal((body.geometry as Record<string, unknown>).type, 'MultiPolygon');
  assert.equal((body.properties as Record<string, unknown>).province_code, provinceCodes[1]);
  assert.equal((await pool!.query('SELECT 1 FROM sites WHERE code = $1', [`MULTI-${postToken}`])).rowCount, 1);
});

integration('POST /sites breaks equal geographic overlap ties by Province code', async () => {
  const { response, body } = await createSite(siteFeature(`TIE-${postToken}`, polygon(100.5, 10.2, 101.5, 10.8)));
  assert.equal(response.status, 201);
  assert.equal((body.properties as Record<string, unknown>).province_code, [provinceCodes[0], provinceCodes[1]].sort()[0]);
});

integration('POST /sites rejects strict field violations and invalid geometries', async () => {
  const base = siteFeature(`BAD-${postToken}`, polygon(100.2, 10.2, 100.3, 10.3));
  const invalidRequests = [
    [{ ...base, properties: { ...(base.properties), province_code: provinceCodes[0] } }, 'VALIDATION_ERROR'],
    [{ ...base, extra: true }, 'VALIDATION_ERROR'],
    [siteFeature(`BAD-${postToken}`, { type: 'Polygon', coordinates: [] }), 'INVALID_GEOMETRY'],
    [siteFeature(`BAD-${postToken}`, polygon(181, 10, 182, 11)), 'INVALID_GEOMETRY'],
    [siteFeature(`BAD-${postToken}`, { type: 'Polygon', coordinates: [[[100.2, 10.2], [100.3, 10.2], [100.2, 10.3], [100.3, 10.2], [100.2, 10.2]]] }), 'INVALID_GEOMETRY'],
  ] as const;
  for (const [feature, code] of invalidRequests) {
    const { response, body } = await createSite(feature);
    assert.equal(response.status, 400);
    assert.equal((body.error as Record<string, unknown>).code, code);
  }
  assert.equal((await pool!.query('SELECT 1 FROM sites WHERE code = $1', [`BAD-${postToken}`])).rowCount, 0);
});

integration('POST /sites rejects Province boundary-only contact and returns coverage error', async () => {
  const { response, body } = await createSite(siteFeature(`TOUCH-${postToken}`, polygon(99.9, 10.2, 100, 10.3)));
  assert.equal(response.status, 422);
  assert.equal((body.error as Record<string, unknown>).code, 'OUTSIDE_COVERAGE');
  assert.equal((await pool!.query('SELECT 1 FROM sites WHERE code = $1', [`TOUCH-${postToken}`])).rowCount, 0);
});

integration('POST /sites reserves active and deleted codes without deleting historical rows', async () => {
  for (const code of [siteCodes[0], siteCodes[3]]) {
    const { response, body } = await createSite(siteFeature(code, polygon(100.2, 10.2, 100.3, 10.3)));
    assert.equal(response.status, 409);
    assert.equal((body.error as Record<string, unknown>).code, 'DUPLICATE_CODE');
  }
  const history = await pool!.query<{ deleted_at: Date | null }>('SELECT deleted_at FROM sites WHERE code = $1', [siteCodes[3]]);
  assert.ok(history.rows[0].deleted_at);
});

integration('GET /sites returns exact numeric summaries without geometry, sorted and paginated', async () => {
  const { response, body } = await json(`/sites?q=${siteToken}`);
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(body).sort(), ['items', 'page', 'total']);
  assert.equal(body.total, 3);
  assert.equal(body.page, 1);
  const items = body.items as Array<Record<string, unknown>>;
  assert.deepEqual(items.map((item) => item.code), [...siteCodes.slice(0, 3)].sort());
  for (const item of items) {
    assert.deepEqual(Object.keys(item).sort(), ['area_rai', 'code', 'name', 'province_code', 'version']);
    assert.equal(typeof item.area_rai, 'number');
    assert.equal(typeof item.version, 'number');
  }
  const page = await json(`/sites?page=2&pageSize=2&q=${siteToken}`);
  assert.equal(page.body.total, 3);
  assert.equal(page.body.page, 2);
  assert.deepEqual((page.body.items as Array<Record<string, unknown>>).map((item) => item.code), [[...siteCodes.slice(0, 3)].sort()[2]]);
  assert.equal(((await json(`/sites?page=4&pageSize=1&q=${siteToken}`)).body.items as unknown[]).length, 0);
  assert.equal(((await json(`/sites?pageSize=100&q=${siteToken}`)).body.items as unknown[]).length, 3);
});

integration('GET /sites/:code returns GeoJSON detail and a null latest Survey when none exists', async () => {
  const { response, body } = await json(`/sites/${siteCodes[1]}`);
  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    type: 'Feature',
    geometry: {
      type: 'MultiPolygon',
      coordinates: [[[[100.3, 10.1], [100.4, 10.1], [100.4, 10.2], [100.3, 10.2], [100.3, 10.1]]]],
    },
    properties: {
      code: siteCodes[1],
      name: 'alpha lagoon',
      province_code: provinceCodes[0],
      area_rai: 2,
      version: 1,
      latest_survey: null,
    },
  });
});

integration('GET /sites/:code selects latest Survey by date then identity and preserves null references', async () => {
  const refs = [`${siteToken}-OLD`, `${siteToken}-TIE`];
  try {
    await pool!.query(
      `INSERT INTO surveys (site_id, survey_ref, geom, surveyed_on, cover_percent)
       SELECT id, $2, ST_SetSRID(ST_MakePoint(100.35,10.15),4326), DATE '2025-01-01', 11
         FROM sites WHERE code = $1
       UNION ALL
       SELECT id, $3, ST_SetSRID(ST_MakePoint(100.35,10.15),4326), DATE '2025-02-03', 44
         FROM sites WHERE code = $1
       UNION ALL
       SELECT id, NULL, ST_SetSRID(ST_MakePoint(100.35,10.15),4326), DATE '2025-02-03', 37
         FROM sites WHERE code = $1`,
      [siteCodes[0], ...refs],
    );
    const { response, body } = await json(`/sites/${siteCodes[0]}`);
    assert.equal(response.status, 200);
    assert.deepEqual((body.properties as Record<string, unknown>).latest_survey, {
      survey_ref: null,
      surveyed_on: '2025-02-03',
      cover_percent: 37,
    });
  } finally {
    await pool!.query('DELETE FROM surveys WHERE survey_ref = ANY($1::text[]) OR (survey_ref IS NULL AND site_id = (SELECT id FROM sites WHERE code = $2))', [refs, siteCodes[0]]);
  }
});

integration('GET /sites/:code hides missing and soft-deleted Sites with SITE_NOT_FOUND', async () => {
  for (const code of [`MISSING-${siteToken}`, siteCodes[3]]) {
    const { response, body } = await json(`/sites/${code}`);
    assert.equal(response.status, 404);
    assert.deepEqual(body.error, { code: 'SITE_NOT_FOUND', message: 'Site not found', details: {} });
  }
});

integration('GET /sites combines active status, province filter, and case-insensitive substring search', async () => {
  const query = new URLSearchParams({ status: 'active', province: provinceCodes[0], q: 'LAGOO' });
  const { response, body } = await json(`/sites?${query}`);
  assert.equal(response.status, 200);
  assert.deepEqual((body.items as Array<Record<string, unknown>>).map((item) => item.code), [siteCodes[1]]);
  const codeSearch = await json(`/sites?q=${siteCodes[1].slice(0, 5).toLowerCase()}`);
  assert.deepEqual((codeSearch.body.items as Array<Record<string, unknown>>).map((item) => item.code), [siteCodes[1]]);
  for (const path of ['/sites?status=deleted', '/sites?page=0', '/sites?pageSize=101', '/sites?unknown=x', '/sites?page=1.2', '/sites?search=old', '/sites?page_size=2']) {
    const invalid = await json(path);
    assert.equal(invalid.response.status, 400);
    assert.deepEqual(invalid.body.error, { code: 'VALIDATION_ERROR', message: 'Validation failed', details: {} });
  }
});

integration('HTTP errors use shared envelopes and health remains available', async () => {
  const unknown = await json('/missing-route');
  assert.equal(unknown.response.status, 404);
  assert.deepEqual(unknown.body.error, { code: 'NOT_FOUND', message: 'Not Found', details: {} });

  const malformed = await fetch(`${origin}/missing-route`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{',
  });
  assert.equal(malformed.status, 400);
  assert.deepEqual((await malformed.json() as Record<string, unknown>).error, { code: 'VALIDATION_ERROR', message: 'Validation failed', details: {} });

  const healthy = await json('/health');
  assert.equal(healthy.response.status, 200);
  assert.equal(healthy.body.db, 'ok');
});

integration('unexpected database failures return generic internal errors', async () => {
  await pool!.query('ALTER TABLE sites RENAME TO sites_test_hidden');
  try {
    const failure = await json('/sites');
    assert.equal(failure.response.status, 500);
    assert.deepEqual(failure.body.error, { code: 'INTERNAL_ERROR', message: 'Internal server error', details: {} });
  } finally {
    await pool!.query('ALTER TABLE sites_test_hidden RENAME TO sites');
  }
});
