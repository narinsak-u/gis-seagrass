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
let siteToken = '';

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
    siteCodes = ['ALPHA', 'BETA', 'GAMMA', 'HISTORY'].map((name) => `${name}-${siteToken}`);
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
    await pool.query('DELETE FROM sites WHERE code = ANY($1::text[])', [siteCodes]);
    await pool.query('DELETE FROM provinces WHERE code = ANY($1::varchar[])', [provinceCodes]);
    await pool.end();
  }
});

async function json(path: string): Promise<{ response: Response; body: Record<string, unknown> }> {
  const response = await fetch(`${origin}${path}`);
  return { response, body: await response.json() as Record<string, unknown> };
}

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
