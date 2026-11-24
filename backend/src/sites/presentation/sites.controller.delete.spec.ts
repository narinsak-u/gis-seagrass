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
integration('DELETE /sites requires admin before looking up a Site', async () => {
  for (const [role, status, code] of [
    [null, 401, `MISSING-${siteToken}`],
    ['viewer', 403, `MISSING-${siteToken}`],
    ['editor', 403, siteCodes[0]],
  ] as const) {
    const response = await deleteSite(code, role);
    expect(response.status).toBe(status);
    expect(((await response.json() as Record<string, unknown>).error as Record<string, unknown>).code).toBe(status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN');
  }
});

integration('DELETE /sites soft-deletes only Survey-free Sites and preserves code and audit actors', async () => {
  const code = `DELETE-${siteToken}`;
  const created = await createSite(siteFeature(code, polygon(100.6, 10.1, 100.7, 10.2)));
  expect(created.response.status).toBe(201);
  await pool!.query('UPDATE sites SET created_by = $2, updated_by = $2, updated_at = TIMESTAMPTZ \'2025-01-01\' WHERE code = $1',
    [code, users.viewer]);
  const deleted = await deleteSite(code);
  expect(deleted.status).toBe(204);
  expect(await deleted.text()).toBe('');
  const retained = await pool!.query<{ deleted_at: Date | null; created_by: string; updated_by: string; updated_at: Date }>(
    'SELECT deleted_at, created_by, updated_by, updated_at FROM sites WHERE code = $1', [code],
  );
  expect(retained.rows[0].deleted_at).toBeTruthy();
  expect(retained.rows[0].created_by).toBe(users.viewer);
  expect(retained.rows[0].updated_by).toBe(users.admin);
  expect(retained.rows[0].updated_at > new Date('2025-01-01')).toBeTruthy();
  for (const response of [await deleteSite(code), await deleteSite(`MISSING-${siteToken}`)]) {
    expect(response.status).toBe(404);
    expect((await response.json() as Record<string, unknown>).error).toStrictEqual({
      code: 'SITE_NOT_FOUND', message: 'Site not found', details: {},
    });
  }
  const recreation = await createSite(siteFeature(code, polygon(100.6, 10.1, 100.7, 10.2)));
  expect(recreation.response.status).toBe(409);
  expect((recreation.body.error as Record<string, unknown>).code).toBe('DUPLICATE_CODE');
  expect(((await json(`/sites?q=${code}`)).body.items as unknown[]).length).toBe(0);
  expect((await json(`/sites/${code}`)).response.status).toBe(404);
  const bbox = await json('/sites.geojson?bbox=100,10,101,11');
  expect(bbox.response.status).toBe(200);
  expect((bbox.body.features as Array<Record<string, unknown>>).some(
    (feature) => (feature.properties as Record<string, unknown>).code === code,
  )).toBe(false);
});

integration('DELETE /sites rejects Sites with linked Surveys', async () => {
  const code = siteCodes[0];
  const ref = `delete-conflict-${siteToken}`;
  surveyRefs.push(ref);
  await pool!.query(
    `INSERT INTO surveys (site_id, survey_ref, geom, surveyed_on, cover_percent)
     SELECT id, $2, ST_SetSRID(ST_MakePoint(100.15,10.15),4326), DATE '2025-01-01', 20
       FROM sites WHERE code = $1`,
    [code, ref],
  );
  const response = await deleteSite(code);
  expect(response.status).toBe(409);
  expect((await response.json() as Record<string, unknown>).error).toStrictEqual({
    code: 'SITE_HAS_SURVEYS', message: 'Site has linked Surveys', details: {},
  });
  expect((await pool!.query('SELECT deleted_at FROM sites WHERE code = $1', [code])).rows[0].deleted_at).toBe(null);
});

integration('DELETE /sites and Survey import serialize both lock orders', async () => {
  for (const importFirst of [true, false]) {
    const suffix = importFirst ? 'IMPORT-FIRST' : 'DELETE-FIRST';
    const code = `DELETE-RACE-${suffix}-${siteToken}`;
    const ref = `delete-race-${suffix}-${siteToken}`;
    surveyRefs.push(ref);
    const created = await createSite(siteFeature(code, polygon(100.1, 10.1, 100.2, 10.2)));
    expect(created.response.status).toBe(201);
    const coordinator = await pool!.connect();
    const importer = await pool!.connect();
    let committed = false;
    try {
      await coordinator.query('BEGIN');
      await coordinator.query('SELECT id FROM sites WHERE code = $1 FOR UPDATE', [code]);
      const date = await pool!.query<{ today: string }>("SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok')::date::text AS today");
      const record: ParsedSurvey = {
        row: 2,
        values: {
          survey_ref: ref, site_code: code, lon: '100.15', lat: '10.15',
          surveyed_on: date.rows[0].today, cover_percent: '40', species: importSpeciesCode,
        },
      };
      let importPromise: Promise<SurveyImportResult>;
      let deletePromise: Promise<Response>;
      if (importFirst) {
        importPromise = importSurveyRecords(importer, [record]);
        await waitForBlockedQuery('ST_DWithin(ST_SetSRID');
        deletePromise = deleteSite(code);
        await waitForBlockedQuery('SELECT id::text, version, name, province_code, area_rai::text,');
      } else {
        deletePromise = deleteSite(code);
        await waitForBlockedQuery('SELECT id::text, version, name, province_code, area_rai::text,');
        importPromise = importSurveyRecords(importer, [record]);
        await waitForBlockedQuery('ST_DWithin(ST_SetSRID');
      }
      await coordinator.query('COMMIT');
      committed = true;
      const [deleted, imported] = await Promise.all([deletePromise, importPromise]);
      if (imported.summary.inserted) {
        expect(deleted.status).toBe(409);
        expect(((await deleted.json() as Record<string, unknown>).error as Record<string, unknown>).code).toBe('SITE_HAS_SURVEYS');
      } else {
        expect(deleted.status).toBe(204);
        expect(imported.rejections.map(({ reason }) => reason)).toStrictEqual(['SITE_NOT_FOUND']);
      }
    } finally {
      if (!committed) await coordinator.query('ROLLBACK');
      importer.release();
      coordinator.release();
    }
  }
});

