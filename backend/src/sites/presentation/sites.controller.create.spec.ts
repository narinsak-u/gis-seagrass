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
integration('POST /sites requires admin before validating parseable bodies', async () => {
  const invalid = { type: 'NotFeature' };
  for (const role of [null, 'viewer', 'editor'] as const) {
    const { response, body } = await createSite(invalid, role);
    expect(response.status).toBe(role === null ? 401 : 403);
    expect((body.error as Record<string, unknown>).code).toBe(role === null ? 'UNAUTHORIZED' : 'FORBIDDEN');
  }
  const invalidTokenResponse = await fetch(`${origin}/sites`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer invalid' },
    body: JSON.stringify(invalid),
  });
  expect(invalidTokenResponse.status).toBe(401);
  expect(((await invalidTokenResponse.json() as Record<string, any>).error).code).toBe('UNAUTHORIZED');

  await pool!.query('UPDATE users SET role = $1 WHERE id = $2', ['viewer', users.admin]);
  try {
    const { response, body } = await createSite(invalid, 'admin');
    expect(response.status).toBe(403);
    expect((body.error as Record<string, unknown>).code).toBe('FORBIDDEN');
  } finally {
    await pool!.query('UPDATE users SET role = $1 WHERE id = $2', ['admin', users.admin]);
  }
});

integration('POST /sites stores the authenticated creator and updater', async () => {
  const feature = siteFeature(`POST-${postToken}`, polygon(100.15, 10.15, 100.25, 10.25));
  const { response, body } = await createSite(feature);
  expect(response.status).toBe(201);
  expect(Object.keys(body).sort()).toStrictEqual(['geometry', 'properties', 'type']);
  expect(body.type).toBe('Feature');
  expect((body.geometry as Record<string, unknown>).type).toStrictEqual('MultiPolygon');
  const properties = body.properties as Record<string, unknown>;
  expect(properties).toStrictEqual({
    code: `POST-${postToken}`,
    name: `New POST-${postToken}`,
    province_code: provinceCodes[0],
    area_rai: properties.area_rai,
    version: 1,
  });
  expect(typeof properties.area_rai).toBe('number');
  const stored = await pool!.query<{ area_rai: string; geometrytype: string; province_code: string; created_by: string; updated_by: string; updated_at: Date }>(
    `SELECT area_rai::text, ST_GeometryType(geom) AS geometrytype, province_code, created_by::text, updated_by::text, updated_at
       FROM sites WHERE code = $1`,
    [`POST-${postToken}`],
  );
  expect(stored.rows[0].geometrytype).toBe('ST_MultiPolygon');
  expect(stored.rows[0].province_code).toBe(provinceCodes[0]);
  expect(properties.area_rai).toBe(Number(stored.rows[0].area_rai));
  expect(stored.rows[0].created_by).toBe(users.admin);
  expect(stored.rows[0].updated_by).toBe(users.admin);
  expect(Math.abs(Date.now() - stored.rows[0].updated_at.getTime()) < 10_000).toBeTruthy();
});

integration('POST /sites rejects client-supplied audit fields', async () => {
  const feature = siteFeature(`POST-${postToken}-FORGED`, polygon(100.15, 10.15, 100.25, 10.25), {
    created_by: users.viewer, updated_by: users.viewer, updated_at: '2000-01-01T00:00:00.000Z',
  });
  const { response, body } = await createSite(feature);
  expect(response.status).toBe(400);
  expect((body.error as Record<string, unknown>).code).toBe('VALIDATION_ERROR');
  expect((await pool!.query('SELECT 1 FROM sites WHERE code = $1', [`POST-${postToken}-FORGED`])).rowCount).toBe(0);
});

integration('POST and PATCH preserve narrow valid Site geometry in storage and GeoJSON responses', async () => {
  const narrow = (west: number) => ({
    type: 'Polygon',
    coordinates: [[[west, 10.15], [west + 0.0000000003, 10.15], [west + 0.0000000003, 10.150001], [west, 10.150001], [west, 10.15]]],
  });
  const code = `POST-${postToken}-THIN`;
  const checkGeometry = async (geometry: unknown) => {
    const checked = await pool!.query<{ valid: boolean; width: number }>(
      `SELECT ST_IsValid(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)) AS valid,
              ST_XMax(Box3D(ST_GeomFromGeoJSON($1))) - ST_XMin(Box3D(ST_GeomFromGeoJSON($1))) AS width`,
      [JSON.stringify(geometry)],
    );
    expect(checked.rows[0].valid).toBe(true);
    expect(checked.rows[0].width > 0).toBeTruthy();
  };
  const checkStored = async () => {
    const stored = await pool!.query<{ valid: boolean; width: number }>(
      `SELECT ST_IsValid(geom) AS valid, ST_XMax(Box3D(geom)) - ST_XMin(Box3D(geom)) AS width
         FROM sites WHERE code = $1`,
      [code],
    );
    expect(stored.rows[0].valid).toBe(true);
    expect(stored.rows[0].width > 0).toBeTruthy();
  };

  const created = await createSite(siteFeature(code, narrow(100.1234567891)));
  expect(created.response.status).toBe(201);
  await checkGeometry(created.body.geometry);
  await checkStored();

  const patched = await patchSite(code, { version: 1, geometry: narrow(100.1234567895) });
  expect(patched.response.status).toBe(200);
  await checkGeometry(patched.body.geometry);
  await checkStored();

  const detail = await json(`/sites/${code}`);
  await checkGeometry(detail.body.geometry);
  const bbox = await json('/sites.geojson?bbox=100,10,101,11');
  const features = bbox.body.features as Array<Record<string, unknown>>;
  const feature = features.find((item) => (item.properties as Record<string, unknown>).code === code);
  expect(feature).toBeTruthy();
  await checkGeometry(feature!.geometry);
});


integration('POST /sites accepts MultiPolygon, chooses greatest overlap and allows Site overlap', async () => {
  const { response, body } = await createSite(siteFeature(`MULTI-${postToken}`, {
    type: 'MultiPolygon',
    coordinates: [
      polygon(100.3, 10.3, 100.4, 10.4).coordinates,
      polygon(101.1, 10.1, 101.3, 10.3).coordinates,
    ],
  }));
  expect(response.status).toBe(201);
  expect((body.geometry as Record<string, unknown>).type).toBe('MultiPolygon');
  expect((body.properties as Record<string, unknown>).province_code).toBe(provinceCodes[1]);
  expect((await pool!.query('SELECT 1 FROM sites WHERE code = $1', [`MULTI-${postToken}`])).rowCount).toBe(1);
});

integration('POST /sites breaks equal geographic overlap ties by Province code', async () => {
  const { response, body } = await createSite(siteFeature(`TIE-${postToken}`, polygon(100.5, 10.2, 101.5, 10.8)));
  expect(response.status).toBe(201);
  expect((body.properties as Record<string, unknown>).province_code).toBe([provinceCodes[0], provinceCodes[1]].sort()[0]);
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
    expect(response.status).toBe(400);
    expect((body.error as Record<string, unknown>).code).toBe(code);
  }
  expect((await pool!.query('SELECT 1 FROM sites WHERE code = $1', [`BAD-${postToken}`])).rowCount).toBe(0);
});

integration('POST /sites rejects Province boundary-only contact and returns coverage error', async () => {
  const { response, body } = await createSite(siteFeature(`TOUCH-${postToken}`, polygon(99.9, 10.2, 100, 10.3)));
  expect(response.status).toBe(422);
  expect((body.error as Record<string, unknown>).code).toBe('OUTSIDE_COVERAGE');
  expect((await pool!.query('SELECT 1 FROM sites WHERE code = $1', [`TOUCH-${postToken}`])).rowCount).toBe(0);
});

integration('POST /sites reserves active and deleted codes without deleting historical rows', async () => {
  for (const code of [siteCodes[0], siteCodes[3]]) {
    const { response, body } = await createSite(siteFeature(code, polygon(100.2, 10.2, 100.3, 10.3)));
    expect(response.status).toBe(409);
    expect(body.error).toStrictEqual({
      code: 'DUPLICATE_CODE',
      message: 'Site code already exists',
      details: {},
    });
  }
  const history = await pool!.query<{ deleted_at: Date | null }>('SELECT deleted_at FROM sites WHERE code = $1', [siteCodes[3]]);
  expect(history.rows[0].deleted_at).toBeTruthy();
});

