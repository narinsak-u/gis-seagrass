import { randomUUID } from 'node:crypto';
import { expect, afterAll, beforeAll, test } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Pool, type PoolClient } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../platform/database';
import { createSiteSurveyImportOperations } from '../../import/infrastructure/site-survey-operations';
import { importSurveys, type SurveyImportResult } from '../../import/application/import-surveys';
import type { ParsedSurvey } from '../../import/parser/surveys';
import { AppModule } from '../../app.module';
import { signAccessToken } from '../../auth/application/auth-token';
import { createDatabaseProvider, type DatabaseProvider } from '../../platform/database';
import { runMigrations } from '../../platform/database';
const testDatabaseUrl = process.env.IMPORT_TEST_DATABASE_URL;
const integration = testDatabaseUrl ? test : test.skip;
let app: INestApplication | undefined;
let database: DatabaseProvider | undefined;
let pool: Pool | undefined;
let origin = '';
let siteCodes: string[] = [];
let provinceCodes: string[] = [];
let createdSiteCodes: string[] = [];
let surveyRefs: string[] = [];
let siteToken = '';
let importSpeciesCode = '';
let postToken = '';
let users: Record<'viewer' | 'editor' | 'admin', string> = { viewer: '', editor: '', admin: '' };

function importSurveyRecords(client: PoolClient, records: ParsedSurvey[]) {
  const writer = createSiteSurveyImportOperations(drizzle(client, { schema })).surveyCommands;
  return importSurveys(writer, records);
}

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
    const token = randomUUID().replaceAll('-', '').toUpperCase();
    provinceCodes = [token.slice(0, 2), token.slice(2, 4)];
    siteToken = token.slice(4, 12);
    importSpeciesCode = `PATCH-SPECIES-${token.slice(12, 20)}`;
    postToken = `POST-${token.slice(20, 24)}`;
    siteCodes = ['ALPHA', 'BETA', 'GAMMA', 'HISTORY'].map((name) => `${name}-${siteToken}`);
    const postCodes = ['POST', 'MULTI', 'TIE', 'BAD', 'TOUCH'].map((name) => `${name}-${postToken}`);
    if (provinceCodes[0] === provinceCodes[1]) continue;
    const existing = await pool.query(
      'SELECT 1 FROM provinces WHERE code = ANY($1::varchar[]) UNION ALL SELECT 1 FROM sites WHERE code = ANY($2::text[])',
      [provinceCodes, [...siteCodes, ...postCodes]],
    );
    if (!existing.rowCount) break;
  } while (true);
  await pool.query('INSERT INTO species (code,name_th,name_sci) VALUES ($1,$1,$1)', [importSpeciesCode]);
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
  users = { viewer: randomUUID(), editor: randomUUID(), admin: randomUUID() };
  await pool.query(
    'INSERT INTO users (id, email, password_hash, role) VALUES ($1,$2,$3,$4),($5,$6,$7,$8),($9,$10,$11,$12)',
    [users.viewer, `${users.viewer}@example.test`, 'unused', 'viewer',
      users.editor, `${users.editor}@example.test`, 'unused', 'editor',
      users.admin, `${users.admin}@example.test`, 'unused', 'admin'],
  );
  app = await NestFactory.create(AppModule.register(database), { logger: false });
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address();
  expect(address && typeof address === 'object').toBeTruthy();
  origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  if (pool) {
    if (surveyRefs.length) {
      await pool.query('DELETE FROM survey_species WHERE survey_id IN (SELECT id FROM surveys WHERE survey_ref = ANY($1::text[]))', [surveyRefs]);
      await pool.query('DELETE FROM surveys WHERE survey_ref = ANY($1::text[])', [surveyRefs]);
    }
    await pool.query('DELETE FROM sites WHERE code = ANY($1::text[])', [[...siteCodes, ...createdSiteCodes]]);
    await pool.query('DELETE FROM provinces WHERE code = ANY($1::varchar[])', [provinceCodes]);
    await pool.query('DELETE FROM species WHERE code = $1', [importSpeciesCode]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [Object.values(users)]);
  }
  if (app) await app.close();
  else await database?.close();
});

async function json(path: string): Promise<{ response: Response; body: Record<string, unknown> }> {
  const response = await fetch(`${origin}${path}`);
  return { response, body: await response.json() as Record<string, unknown> };
}
function accessToken(role: keyof typeof users): string {
  return signAccessToken(users[role]);
}

async function createSite(feature: unknown, role?: keyof typeof users | null): Promise<{ response: Response; body: Record<string, unknown> }> {
  const properties = feature && typeof feature === 'object' && 'properties' in feature ? feature.properties : undefined;
  const code = properties && typeof properties === 'object' && 'code' in properties ? properties.code : undefined;
  if (typeof code === 'string') createdSiteCodes.push(code);
  const response = await fetch(`${origin}/sites`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(role === null ? {} : { authorization: `Bearer ${accessToken(role ?? 'admin')}` }) },
    body: JSON.stringify(feature),
  });
  return { response, body: await response.json() as Record<string, unknown> };
}

async function patchSite(code: string, body: unknown, token: string | null = accessToken('admin')): Promise<{ response: Response; body: Record<string, unknown> }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token !== null) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${origin}/sites/${code}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() as Record<string, unknown> };
}

async function deleteSite(code: string, role: keyof typeof users | null = 'admin'): Promise<Response> {
  return fetch(`${origin}/sites/${code}`, {
    method: 'DELETE',
    headers: role === null ? {} : { authorization: `Bearer ${accessToken(role)}` },
  });
}

async function waitForBlockedQuery(query: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const blocked = await pool!.query<{ blocked: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE $1
       ) AS blocked`,
      [`%${query}%`],
    );
    if (blocked.rows[0].blocked) return;
    // Poll PostgreSQL's lock state; fake time cannot advance database lock scheduling.
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for blocked query: ${query}`);
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
integration('GET /sites returns exact numeric summaries without geometry, sorted and paginated', async () => {
  const { response, body } = await json(`/sites?q=${siteToken}`);
  expect(response.status).toBe(200);
  expect(Object.keys(body).sort()).toStrictEqual(['items', 'page', 'total']);
  expect(body.total).toBe(3);
  expect(body.page).toBe(1);
  const items = body.items as Array<Record<string, unknown>>;
  expect(items.map((item) => item.code)).toStrictEqual([...siteCodes.slice(0, 3)].sort());
  for (const item of items) {
    expect(Object.keys(item).sort()).toStrictEqual(['area_rai', 'code', 'name', 'province_code', 'siteStatus', 'version']);
    expect(item.siteStatus).toBe('no_data');
    expect(typeof item.area_rai).toBe('number');
    expect(typeof item.version).toBe('number');
  }
  const page = await json(`/sites?page=2&pageSize=2&q=${siteToken}`);
  expect(page.body.total).toBe(3);
  expect(page.body.page).toBe(2);
  expect((page.body.items as Array<Record<string, unknown>>).map((item) => item.code)).toStrictEqual([[...siteCodes.slice(0, 3)].sort()[2]]);
  expect(((await json(`/sites?page=4&pageSize=1&q=${siteToken}`)).body.items as unknown[]).length).toBe(0);
  expect(((await json(`/sites?pageSize=100&q=${siteToken}`)).body.items as unknown[]).length).toBe(3);
});

integration('GET /sites/:code returns GeoJSON detail and a null latest Survey when none exists', async () => {
  const { response, body } = await json(`/sites/${siteCodes[1]}`);
  expect(response.status).toBe(200);
  expect(body).toStrictEqual({
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
      siteStatus: 'no_data',
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
    expect(response.status).toBe(200);
    expect((body.properties as Record<string, unknown>).latest_survey).toStrictEqual({
      survey_ref: null,
      surveyed_on: '2025-02-03',
      cover_percent: 37,
    });
  } finally {
    await pool!.query('DELETE FROM surveys WHERE survey_ref = ANY($1::text[]) OR (survey_ref IS NULL AND site_id = (SELECT id FROM sites WHERE code = $2))', [refs, siteCodes[0]]);
  }
});

integration('public Site status averages latest-date Surveys and recomputes after mutations', async () => {
  const refs = [`${siteToken}-STATUS-OLD`, `${siteToken}-STATUS-A`, `${siteToken}-STATUS-B`];
  const siteId = (await pool!.query<{ id: string }>('SELECT id FROM sites WHERE code = $1', [siteCodes[0]])).rows[0].id;
  try {
    await pool!.query(
      `INSERT INTO surveys (site_id, survey_ref, geom, surveyed_on, cover_percent)
       VALUES ($1, $2, ST_SetSRID(ST_MakePoint(100.15,10.15),4326), DATE '2025-01-01', 1),
              ($1, $3, ST_SetSRID(ST_MakePoint(100.15,10.15),4326), DATE '2025-02-03', 70),
              ($1, $4, ST_SetSRID(ST_MakePoint(100.15,10.15),4326), DATE '2025-02-03', 80)`,
      [siteId, ...refs],
    );
    const expectStatus = async (expected: string) => {
      const [list, detail, map] = await Promise.all([
        json(`/sites?q=${siteCodes[0]}`),
        json(`/sites/${siteCodes[0]}`),
        json('/sites.geojson?bbox=100,10,100.3,10.3'),
      ]);
      expect(((list.body.items as Array<Record<string, unknown>>)[0]).siteStatus).toBe(expected);
      expect(((detail.body.properties as Record<string, unknown>)).siteStatus).toBe(expected);
      const feature = (map.body.features as Array<Record<string, unknown>>)
        .find((item) => (item.properties as Record<string, unknown>).code === siteCodes[0]);
      expect((feature?.properties as Record<string, unknown>).siteStatus).toBe(expected);
    };
    await expectStatus('very_good');
    await pool!.query('UPDATE surveys SET cover_percent = 30 WHERE survey_ref = $1', [refs[2]]);
    await expectStatus('good');
    await pool!.query('DELETE FROM surveys WHERE survey_ref = ANY($1::text[])', [[refs[1], refs[2]]]);
    await expectStatus('poor');
    await pool!.query('DELETE FROM surveys WHERE survey_ref = $1', [refs[0]]);
    await expectStatus('no_data');
  } finally {
    await pool!.query('DELETE FROM surveys WHERE survey_ref = ANY($1::text[])', [refs]);
  }
});

integration('GET /sites/:code hides missing and soft-deleted Sites with SITE_NOT_FOUND', async () => {
  for (const code of [`MISSING-${siteToken}`, siteCodes[3]]) {
    const { response, body } = await json(`/sites/${code}`);
    expect(response.status).toBe(404);
    expect(body.error).toStrictEqual({ code: 'SITE_NOT_FOUND', message: 'Site not found', details: {} });
  }
});

integration('GET /sites combines active status, province filter, and case-insensitive substring search', async () => {
  const query = new URLSearchParams({ status: 'active', province: provinceCodes[0], q: 'LAGOO' });
  const { response, body } = await json(`/sites?${query}`);
  expect(response.status).toBe(200);
  expect((body.items as Array<Record<string, unknown>>).map((item) => item.code)).toStrictEqual([siteCodes[1]]);
  const codeSearch = await json(`/sites?q=${siteCodes[1].slice(0, 5).toLowerCase()}`);
  expect((codeSearch.body.items as Array<Record<string, unknown>>).map((item) => item.code)).toStrictEqual([siteCodes[1]]);
  for (const path of ['/sites?status=deleted', '/sites?page=0', '/sites?pageSize=101', '/sites?unknown=x', '/sites?page=1.2', '/sites?search=old', '/sites?page_size=2']) {
    const invalid = await json(path);
    expect(invalid.response.status).toBe(400);
    expect(invalid.body.error).toStrictEqual({ code: 'VALIDATION_ERROR', message: 'Validation failed', details: {} });
  }
});

integration('HTTP errors use shared envelopes and health remains available', async () => {
  const unknown = await json('/missing-route');
  expect(unknown.response.status).toBe(404);
  expect(unknown.body.error).toStrictEqual({ code: 'NOT_FOUND', message: 'Not Found', details: {} });

  const malformed = await fetch(`${origin}/missing-route`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{',
  });
  expect(malformed.status).toBe(400);
  expect((await malformed.json() as Record<string, unknown>).error).toStrictEqual({ code: 'VALIDATION_ERROR', message: 'Validation failed', details: {} });

  const healthy = await json('/health');
  expect(healthy.response.status).toBe(200);
  expect(healthy.body.db).toBe('ok');
});

integration('unexpected database failures return generic internal errors', async () => {
  await pool!.query('ALTER TABLE sites RENAME TO sites_test_hidden');
  try {
    const failure = await json('/sites');
    expect(failure.response.status).toBe(500);
    expect(failure.body.error).toStrictEqual({ code: 'INTERNAL_ERROR', message: 'Internal server error', details: {} });
  } finally {
    await pool!.query('ALTER TABLE sites_test_hidden RENAME TO sites');
  }
});

