import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, test } from 'vitest';
import { request as httpRequest } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';
import { AppModule } from '../app.module';
import { createDatabaseProvider, type DatabaseProvider } from '../platform/database';
import { runMigrations } from '../platform/database';
import { setupSwagger } from '../swagger';
import { signAccessToken } from '../auth/application/auth-token';

const testDatabaseUrl = process.env.IMPORT_TEST_DATABASE_URL;
const integration = testDatabaseUrl ? test : test.skip;
let app: INestApplication | undefined;
let clockApp: INestApplication | undefined;
let database: DatabaseProvider | undefined;
let pool: Pool | undefined;
let origin = '';
let provinceCode = '';
let siteCode = '';
let deletedSiteCode = '';
let siteId = '';
let speciesCodes: [string, string] = ['', ''];
let createdProvinceCode = '';
let createdSiteCodes: string[] = [];
let createdSpeciesCodes: string[] = [];
let users: Record<'viewer' | 'editor' | 'admin', string> = { viewer: '', editor: '', admin: '' };

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
    provinceCode = token.slice(0, 2);
    siteCode = `SURVEY-${token.slice(2, 18)}`;
    deletedSiteCode = `RETIRED-${token.slice(18, 34)}`;
    speciesCodes = [`TEST-A${token.slice(0, 16)}`, `TEST-B${token.slice(16, 32)}`];
    const existing = await pool.query(
      'SELECT 1 FROM provinces WHERE code = $1 UNION ALL SELECT 1 FROM sites WHERE code = ANY($2::text[]) UNION ALL SELECT 1 FROM species WHERE code = ANY($3::text[])',
      [provinceCode, [siteCode, deletedSiteCode], speciesCodes],
    );
    if (!existing.rowCount) break;
  } while (true);
  await pool.query('INSERT INTO species (code,name_th,name_sci) VALUES ($1,$1,$1),($2,$2,$2)', speciesCodes);
  createdSpeciesCodes = speciesCodes;
  await pool.query(
    `INSERT INTO provinces (code,name_th,geom)
     VALUES ($1,'Survey test province',ST_Multi(ST_GeomFromText('POLYGON((99 9,101 9,101 11,99 11,99 9))',4326)))`,
    [provinceCode],
  );
  createdProvinceCode = provinceCode;
  const sites = await pool.query<{ id: string; code: string }>(
    `INSERT INTO sites (code,name,province_code,geom,area_rai,deleted_at)
     VALUES
       ($1,'Survey test site',$3,ST_Multi(ST_GeomFromText('POLYGON((100.15 10.15,100.15005 10.15,100.15005 10.15005,100.15 10.15005,100.15 10.15))',4326)),1,NULL),
       ($2,'Retired test site',$3,ST_Multi(ST_GeomFromText('POLYGON((100.16 10.16,100.16005 10.16,100.16005 10.16005,100.16 10.16005,100.16 10.16))',4326)),1,now())
     RETURNING id,code`,
    [siteCode, deletedSiteCode, provinceCode],
  );
  createdSiteCodes = sites.rows.map(({ code }) => code);
  siteId = sites.rows.find(({ code }) => code === siteCode)?.id ?? '';
  users = { viewer: randomUUID(), editor: randomUUID(), admin: randomUUID() };
  await pool.query(
    'INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, $3, $4), ($5, $6, $7, $8), ($9, $10, $11, $12)',
    [users.viewer, `${randomUUID()}@example.test`, 'unused', 'viewer', users.editor, `${randomUUID()}@example.test`, 'unused', 'editor', users.admin, `${randomUUID()}@example.test`, 'unused', 'admin'],
  );
  app = await NestFactory.create(AppModule.register(database), { logger: false, rawBody: true });
  setupSwagger(app);
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address();
  assert.ok(address && typeof address === 'object');
  origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  if (pool) {
    if (siteId) {
      await pool.query('DELETE FROM survey_species WHERE survey_id IN (SELECT id FROM surveys WHERE site_id = $1)', [siteId]);
      await pool.query('DELETE FROM surveys WHERE site_id = $1', [siteId]);
    }
    if (createdSiteCodes.length) await pool.query('DELETE FROM sites WHERE code = ANY($1::text[])', [createdSiteCodes]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [Object.values(users)]);
    if (createdProvinceCode) await pool.query('DELETE FROM provinces WHERE code = $1', [createdProvinceCode]);
    if (createdSpeciesCodes.length) await pool.query('DELETE FROM species WHERE code = ANY($1::text[])', [createdSpeciesCodes]);
  }
  if (app) await app.close();
  else await database?.close();
});

async function request(path: string, method = 'GET', body?: unknown, token?: string): Promise<{ response: Response; body: Record<string, unknown> }> {
  return requestText(path, method, body === undefined ? undefined : JSON.stringify(body), token);
}

async function requestText(path: string, method = 'GET', body?: string, token?: string): Promise<{ response: Response; body: Record<string, unknown> }> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${origin}${path}`, { method, headers, body });
  return { response, body: response.status === 204 ? {} : await response.json() as Record<string, unknown> };
}

function accessToken(role: 'viewer' | 'editor' | 'admin'): string {
  return signAccessToken(users[role]);
}

function signedToken(sub: string, iat: number, exp: number): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const content = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub, iat, exp })}`;
  const signature = createHmac('sha256', process.env.JWT_SECRET!).update(content).digest('base64url');
  return `${content}.${signature}`;
}

function expiredToken(): string {
  return signedToken(users.viewer, 1, 2);
}

async function create(body: unknown, code = siteCode, token: string | null = accessToken('admin')) {
  return request(`/sites/${code}/surveys`, 'POST', body, token ?? undefined);
}

async function todayAndDates(): Promise<{ today: string; yesterday: string; tomorrow: string }> {
  const result = await pool!.query<{ today: string; yesterday: string; tomorrow: string }>(
    `SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok')::date::text AS today,
            ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok')::date - 1)::text AS yesterday,
            ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok')::date + 1)::text AS tomorrow`,
  );
  return result.rows[0];
}

async function validSurvey(overrides: Record<string, unknown> = {}) {
  const { today } = await todayAndDates();
  return { lon: 100.150025, lat: 10.150025, surveyed_on: today, cover_percent: 40, species: [speciesCodes[0]], ...overrides };
}

async function resetSurveys(): Promise<void> {
  await pool!.query('DELETE FROM survey_species WHERE survey_id IN (SELECT id FROM surveys WHERE site_id = $1)', [siteId]);
  await pool!.query('DELETE FROM surveys WHERE site_id = $1', [siteId]);
}

async function status(): Promise<Record<string, unknown>> {
  const response = await request(`/sites/${siteCode}/surveys`, 'GET', undefined, accessToken('viewer'));
  return response.body;
}

async function waitForSiteLock(): Promise<boolean> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await pool!.query<{ blocked: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database()
       AND wait_event_type = 'Lock' AND query ILIKE '%select%sites%for%update%') AS blocked`,
    );
    if (result.rows[0].blocked) return true;
    // PostgreSQL lock scheduling uses the real database clock.
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return false;
}

integration('Swagger documents Survey operations, payloads, and error responses', async () => {
  const response = await fetch(`${origin}/docs-json`);
  assert.equal(response.status, 200);
  type Schema = {
    $ref?: string;
    required?: string[];
    minProperties?: number;
    anyOf?: Schema[];
    not?: Schema;
    properties?: Record<string, Schema>;
    items?: Schema;
    nullable?: boolean;
  };
  type Operation = {
    description?: string;
    requestBody?: { content?: Record<string, { schema?: Schema }> };
    security?: Array<Record<string, string[]>>;
    responses?: Record<string, { content?: Record<string, { schema?: Schema }> }>;
  };
  const document = await response.json() as {
    paths: Record<string, Record<string, Operation>>;
    components?: { schemas?: Record<string, Schema>; securitySchemes?: Record<string, { type?: string; scheme?: string; bearerFormat?: string }> };
  };
  const post = document.paths['/sites/{code}/surveys'].post;
  const patch = document.paths['/surveys/{id}'].patch;
  const remove = document.paths['/surveys/{id}'].delete;
  const list = document.paths['/sites/{code}/surveys'].get;
  assert.ok(post && patch && remove && list);
  assert.deepEqual(document.components?.securitySchemes?.['access-token'], { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' });
  assert.deepEqual(post.security, [{ 'access-token': [] }]);
  assert.match(post.description ?? '', /admin/);
  assert.deepEqual(patch.security, [{ 'access-token': [] }]);
  assert.match(patch.description ?? '', /admin/);
  for (const [operation, statuses] of [
    [list, ['200', '400', '401', '403', '404', '500']],
    [post, ['201', '400', '401', '403', '404', '422', '500']],
    [patch, ['200', '400', '401', '403', '404', '422', '500']],
    [remove, ['204', '400', '401', '403', '404', '500']],
  ] as const) {
    for (const code of statuses) assert.ok(operation.responses?.[code], `Missing documented response ${code}`);
  }
  const resolveSchema = (schema?: Schema) => schema?.$ref
    ? document.components?.schemas?.[schema.$ref.split('/').at(-1)!]
    : schema;
  const requestSchema = (operation: Operation) => resolveSchema(operation.requestBody?.content?.['application/json']?.schema);
  const responseSchema = (operation: Operation, code: string) =>
    resolveSchema(operation.responses?.[code]?.content?.['application/json']?.schema);
  for (const operation of [list, post, patch, remove]) {
    assert.deepEqual(Object.keys(responseSchema(operation, '500')?.properties ?? {}), ['error']);
    assert.deepEqual(Object.keys(responseSchema(operation, '500')?.properties?.error?.properties ?? {}).sort(), ['code', 'details', 'message']);
  }
  const postSchema = requestSchema(post);
  const patchSchema = requestSchema(patch);
  assert.deepEqual((postSchema?.required ?? []).slice().sort(), ['cover_percent', 'lat', 'lon', 'species', 'surveyed_on']);
  assert.deepEqual(Object.keys(postSchema?.properties ?? {}).sort(), ['cover_percent', 'lat', 'lon', 'note', 'species', 'surveyed_on']);
  assert.deepEqual(Object.keys(patchSchema?.properties ?? {}).sort(), ['cover_percent', 'lat', 'lon', 'note', 'species', 'surveyed_on']);
  assert.equal(patchSchema?.minProperties, 1);
  assert.deepEqual(patchSchema?.anyOf?.[0]?.required, ['lon', 'lat']);
  assert.deepEqual(patchSchema?.anyOf?.[1]?.not?.anyOf?.map((schema) => schema.required), [['lon'], ['lat']]);
  const postResponse = responseSchema(post, '201');
  const patchResponse = responseSchema(patch, '200');
  const listResponse = responseSchema(list, '200');
  assert.deepEqual(Object.keys(postResponse?.properties ?? {}).sort(), ['cover_percent', 'id', 'lat', 'lon', 'note', 'siteStatus', 'species', 'surveyed_on']);
  assert.deepEqual(Object.keys(patchResponse?.properties ?? {}).sort(), ['cover_percent', 'id', 'lat', 'lon', 'note', 'siteStatus', 'species', 'surveyed_on']);
  assert.deepEqual(Object.keys(listResponse?.properties ?? {}).sort(), ['items', 'page', 'total']);
  const listedSurvey = resolveSchema(listResponse?.properties?.items?.items);
  assert.deepEqual(Object.keys(listedSurvey?.properties ?? {}).sort(), ['cover_percent', 'created_by', 'id', 'lat', 'lon', 'note', 'species', 'surveyed_on']);
  assert.equal(listedSurvey?.properties?.created_by?.nullable, true);
});

integration('GET /sites/:code/surveys paginates deterministic list shapes and rejects invalid queries', async () => {
  await resetSurveys();
  const older = await pool!.query<{ id: string }>(
    `INSERT INTO surveys (site_id,geom,surveyed_on,cover_percent)
     VALUES ($1, ST_SetSRID(ST_MakePoint(100.150025,10.150025),4326), '2025-01-01', 10) RETURNING id::text`,
    [siteId],
  );
  const firstTie = await create(await validSurvey({ surveyed_on: '2025-02-01', cover_percent: 20 }));
  const secondTie = await create(await validSurvey({ surveyed_on: '2025-02-01', cover_percent: 30 }));
  assert.equal(firstTie.body.siteStatus, 'poor');
  assert.equal(secondTie.body.siteStatus, 'fair');
  await pool!.query("UPDATE surveys SET created_by = $1, photo_key = 'private-survey-secret' WHERE id = $2", [users.editor, secondTie.body.id]);
  const page = await request(`/sites/${siteCode}/surveys`, 'GET', undefined, accessToken('viewer'));
  assert.equal(page.response.status, 200);
  assert.deepEqual(Object.keys(page.body).sort(), ['items', 'page', 'total']);
  assert.equal(page.body.page, 1);
  assert.equal(page.body.total, 3);
  const items = page.body.items as Array<Record<string, unknown>>;
  assert.deepEqual(items.map(({ id }) => id), [secondTie.body.id, firstTie.body.id, older.rows[0].id]);
  assert.deepEqual(Object.keys(items[0]).sort(), ['cover_percent', 'created_by', 'id', 'lat', 'lon', 'note', 'species', 'surveyed_on']);
  assert.equal(items[0].created_by, users.editor);
  assert.equal(items[0].photo_key, undefined);
  assert.equal(items[0].siteStatus, undefined);
  assert.equal(items[2].created_by, null);
  assert.deepEqual(items[0].species, [speciesCodes[0]]);
  const secondPage = await request(`/sites/${siteCode}/surveys?page=2&pageSize=2`, 'GET', undefined, accessToken('editor'));
  assert.deepEqual((secondPage.body.items as Array<Record<string, unknown>>).map(({ id }) => id), [older.rows[0].id]);
  const emptyPage = await request(`/sites/${siteCode}/surveys?page=4&pageSize=1`, 'GET', undefined, accessToken('admin'));
  assert.deepEqual(emptyPage.body.items, []);
  const maxPage = await request(`/sites/${siteCode}/surveys?pageSize=100`, 'GET', undefined, accessToken('viewer'));
  assert.equal((maxPage.body.items as unknown[]).length, 3);
  for (const query of ['page=0', 'page=1.2', 'pageSize=0', 'pageSize=101', 'pageSize=abc', 'other=x']) {
    const invalid = await request(`/sites/${siteCode}/surveys?${query}`, 'GET', undefined, accessToken('viewer'));
    assert.equal(invalid.response.status, 400);
    assert.equal(((invalid.body.error as Record<string, unknown>).code), 'VALIDATION_ERROR');
    assert.deepEqual(Object.keys(invalid.body.error as object).sort(), ['code', 'details', 'message']);
  }
});

integration('GET /sites/:code/surveys authenticates active current users before Site lookup', async () => {
  const path = `/sites/MISSING-${siteCode}/surveys`;
  for (const token of [undefined, 'not-a-token', expiredToken()]) {
    const denied = await request(path, 'GET', undefined, token);
    assert.equal(denied.response.status, 401);
    assert.deepEqual(denied.body.error, { code: 'UNAUTHORIZED', message: 'Authentication required', details: {} });
  }
  const invalidQuery = await request(`/sites/MISSING-${siteCode}/surveys?page=0`);
  assert.equal(invalidQuery.response.status, 401);
  const malformed = await new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
    const req = httpRequest(new URL(path, origin), { method: 'GET', headers: { 'content-type': 'application/json', 'content-length': '1' } }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body }));
    });
    req.on('error', reject);
    req.end('{');
  });
  assert.equal(malformed.status, 400);
  assert.deepEqual(JSON.parse(malformed.body).error, { code: 'VALIDATION_ERROR', message: 'Validation failed', details: {} });
  const invalidSignature = `${accessToken('viewer').slice(0, -1)}x`;
  assert.equal((await request(path, 'GET', undefined, invalidSignature)).response.status, 401);
  const now = Math.floor(Date.now() / 1000);
  assert.equal((await request(path, 'GET', undefined, signedToken('not-a-uuid', now, now + 60))).response.status, 401);
  const validMissing = await request(path, 'GET', undefined, accessToken('viewer'));
  assert.equal(validMissing.response.status, 404);
  await pool!.query('UPDATE users SET is_active = false WHERE id = $1', [users.viewer]);
  const inactive = await request(path, 'GET', undefined, accessToken('viewer'));
  assert.equal(inactive.response.status, 401);
  await pool!.query('UPDATE users SET is_active = true WHERE id = $1', [users.viewer]);
  const deletedUser = randomUUID();
  await pool!.query('INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, $3, $4)', [deletedUser, `${randomUUID()}@example.test`, 'unused', 'viewer']);
  const deletedToken = signAccessToken(deletedUser);
  await pool!.query('DELETE FROM users WHERE id = $1', [deletedUser]);
  assert.equal((await request(path, 'GET', undefined, deletedToken)).response.status, 401);
  for (const role of ['viewer', 'editor', 'admin'] as const) {
    assert.equal((await request(`/sites/${siteCode}/surveys`, 'GET', undefined, accessToken(role))).response.status, 200);
  }
  assert.equal((await request('/health')).response.status, 200);
  assert.equal((await request('/sites')).response.status, 200);
  assert.equal((await fetch(`${origin}/docs`)).status, 200);
  assert.equal((await request('/sites.geojson?bbox=99,9,101,11')).response.status, 200);
  assert.equal((await request(`/sites/${siteCode}`)).response.status, 200);
  assert.equal((await fetch(`${origin}/docs-json`)).status, 200);
});

integration('POST /sites/:code/surveys authenticates admins before validation and Site lookup', async () => {
  await resetSurveys();
  const malformed = { invalid: true };
  for (const token of [null, 'not-a-token', expiredToken()]) {
    for (const code of [siteCode, `MISSING-${siteCode}`, deletedSiteCode]) {
      const denied = await create(malformed, code, token);
      assert.equal(denied.response.status, 401);
      assert.deepEqual(denied.body.error, { code: 'UNAUTHORIZED', message: 'Authentication required', details: {} });
    }
  }
  for (const role of ['viewer', 'editor'] as const) {
    for (const code of [siteCode, `MISSING-${siteCode}`, deletedSiteCode]) {
      const denied = await create(malformed, code, accessToken(role));
      assert.equal(denied.response.status, 403);
      assert.deepEqual(denied.body.error, { code: 'FORBIDDEN', message: 'Insufficient permissions', details: {} });
    }
  }
  assert.equal((await pool!.query('SELECT count(*)::int AS count FROM surveys WHERE site_id = $1', [siteId])).rows[0].count, 0);
});

integration('POST records authenticated Survey actors and exposes creator to protected reads', async () => {
  await resetSurveys();
  const body = await validSurvey();
  for (const key of ['created_by', 'updated_by', 'updated_at']) {
    const forged = await create({ ...body, [key]: users.viewer });
    assert.equal(forged.response.status, 400);
    assert.equal((forged.body.error as Record<string, unknown>).code, 'VALIDATION_ERROR');
  }
  const created = await create(body);
  assert.equal(created.response.status, 201);
  assert.deepEqual(Object.keys(created.body).sort(), ['cover_percent', 'id', 'lat', 'lon', 'note', 'siteStatus', 'species', 'surveyed_on']);
  const stored = await pool!.query<{ created_by: string; updated_by: string; updated_at: Date }>(
    'SELECT created_by::text, updated_by::text, updated_at FROM surveys WHERE id = $1', [created.body.id],
  );
  assert.equal(stored.rows[0].created_by, users.admin);
  assert.equal(stored.rows[0].updated_by, users.admin);
  assert.ok(stored.rows[0].updated_at instanceof Date);
  const listed = await request(`/sites/${siteCode}/surveys`, 'GET', undefined, accessToken('viewer'));
  const item = (listed.body.items as Array<Record<string, unknown>>).find(({ id }) => id === created.body.id);
  assert.equal(item?.created_by, users.admin);
});


integration('POST /sites/:code/surveys enforces API shapes, site visibility, and malformed JSON envelope', async () => {
  await resetSurveys();
  const created = await create(await validSurvey({ note: 'น้ำขุ่น', species: [speciesCodes[0], speciesCodes[1], speciesCodes[0]] }));
  assert.equal(created.response.status, 201);
  assert.deepEqual(Object.keys(created.body).sort(), ['cover_percent', 'id', 'lat', 'lon', 'note', 'siteStatus', 'species', 'surveyed_on']);
  assert.equal(created.body.siteStatus, 'fair');
  assert.deepEqual((created.body.species as string[]).sort(), [...speciesCodes].sort());
  assert.equal(created.body.note, 'น้ำขุ่น');
  const absentNote = await create(await validSurvey({ species: [] }));
  assert.equal(absentNote.body.note, null);
  assert.deepEqual(absentNote.body.species, []);
  for (const code of [`MISSING-${siteCode}`, deletedSiteCode]) {
    const missing = await create(await validSurvey(), code);
    assert.equal(missing.response.status, 404);
    assert.equal((missing.body.error as Record<string, unknown>).code, 'SITE_NOT_FOUND');
  }
  const malformed = await fetch(`${origin}/sites/${siteCode}/surveys`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{',
  });
  assert.equal(malformed.status, 400);
  assert.deepEqual((await malformed.json() as Record<string, unknown>).error, {
    code: 'VALIDATION_ERROR', message: 'Validation failed', details: {},
  });
  const badBody = await create({ ...(await validSurvey()), id: '1', site_id: '1' });
  assert.equal(badBody.response.status, 400);
  assert.equal((badBody.body.error as Record<string, unknown>).code, 'VALIDATION_ERROR');
});

integration('POST validates coordinates, cover precision, strict Bangkok dates, and species atomically', async () => {
  await resetSurveys();
  const dates = await todayAndDates();
  const base = await validSurvey();
  const invalidBodies = [
    { ...base, lon: '100.15' }, { ...base, lat: '10.15' }, { ...base, lon: Number.NaN },
    { ...base, lon: 181 }, { ...base, lat: -91 }, { ...base, lon: Infinity },
    { ...base, cover_percent: -0.01 }, { ...base, cover_percent: 100.01 },
    { ...base, cover_percent: 1.001 }, { ...base, cover_percent: '10' },
    { ...base, surveyed_on: dates.tomorrow }, { ...base, surveyed_on: '2025-2-01' },
    { ...base, surveyed_on: '2025-02-29' }, { ...base, species: [speciesCodes[0], `UNKNOWN-${siteCode}`] },
    { ...base, species: 'not-an-array' }, { ...base, unknown: true },
    { lon: base.lon, lat: base.lat, surveyed_on: base.surveyed_on, cover_percent: 20 },
  ];
  for (const body of invalidBodies) {
    const invalid = await create(body);
    assert.equal(invalid.response.status, 400, JSON.stringify(body));
    assert.equal((invalid.body.error as Record<string, unknown>).code, 'VALIDATION_ERROR');
  }
  const nonFinite = await fetch(`${origin}/sites/${siteCode}/surveys`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken('admin')}` },
    body: `{"lon":1e400,"lat":10.15,"surveyed_on":"${dates.today}","cover_percent":40,"species":[]}`,
  });
  assert.equal(nonFinite.status, 400);
  assert.equal(((await nonFinite.json() as Record<string, unknown>).error as Record<string, unknown>).code, 'VALIDATION_ERROR');
  const roundedLiteral = await fetch(`${origin}/sites/${siteCode}/surveys`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken('admin')}` },
    body: `{"lon":100.15,"lat":10.15,"surveyed_on":"${dates.today}","cover_percent":1.0000000000000001,"species":[]}`,
  });
  assert.equal(roundedLiteral.status, 400);
  assert.equal(((await roundedLiteral.json() as Record<string, unknown>).error as Record<string, unknown>).code, 'VALIDATION_ERROR');
  const nulNote = await requestText(`/sites/${siteCode}/surveys`, 'POST', JSON.stringify({ ...base, note: 'bad\0note' }), accessToken('admin'));
  assert.equal(nulNote.response.status, 400);
  assert.equal((nulNote.body.error as Record<string, unknown>).code, 'VALIDATION_ERROR');
  assert.equal((await pool!.query('SELECT count(*)::int AS count FROM surveys WHERE site_id = $1', [siteId])).rows[0].count, 0);
});

integration('POST and PATCH use the Bangkok calendar date across midnight', async () => {
  await resetSurveys();
  const previousOptions = process.env.PGOPTIONS;
  let clockDatabase: DatabaseProvider | undefined;
  try {
    await pool!.query('CREATE SCHEMA survey_test_clock');
    await pool!.query('CREATE TABLE survey_test_clock.fixed_time (instant timestamptz NOT NULL)');
    await pool!.query("INSERT INTO survey_test_clock.fixed_time VALUES ('2025-01-01 16:59:59+00')");
    await pool!.query(`CREATE FUNCTION survey_test_clock.clock_timestamp() RETURNS timestamptz
      LANGUAGE sql VOLATILE AS $$ SELECT instant FROM survey_test_clock.fixed_time $$`);
    process.env.PGOPTIONS = '-c search_path=survey_test_clock,pg_catalog,public';
    clockDatabase = createDatabaseProvider();
    clockApp = await NestFactory.create(AppModule.register(clockDatabase), { logger: false, rawBody: true });
    await clockApp.listen(0, '127.0.0.1');
    const address = clockApp.getHttpServer().address();
    assert.ok(address && typeof address === 'object');
    const clockOrigin = `http://127.0.0.1:${address.port}`;
    const send = async (path: string, method: string, body: unknown, token: string | null = accessToken('admin')) => fetch(`${clockOrigin}${path}`, {
      method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body),
    });
    const yesterday = await send(`/sites/${siteCode}/surveys`, 'POST', await validSurvey({ surveyed_on: '2025-01-01' }));
    assert.equal(yesterday.status, 201);
    const id = (await yesterday.json() as { id: string }).id;
    assert.equal((await send(`/sites/${siteCode}/surveys`, 'POST', await validSurvey({ surveyed_on: '2025-01-02' }))).status, 400);
    assert.equal((await send(`/surveys/${id}`, 'PATCH', { surveyed_on: '2025-01-02' })).status, 400);
    await pool!.query("UPDATE survey_test_clock.fixed_time SET instant = '2025-01-01 17:00:00+00'");
    assert.equal((await send(`/surveys/${id}`, 'PATCH', { surveyed_on: '2025-01-02' })).status, 200);
    assert.equal((await send(`/sites/${siteCode}/surveys`, 'POST', await validSurvey({ surveyed_on: '2025-01-02' }))).status, 201);
  } finally {
    if (clockApp) await clockApp.close();
    else await clockDatabase?.close();
    if (previousOptions === undefined) delete process.env.PGOPTIONS;
    else process.env.PGOPTIONS = previousOptions;
    await pool!.query('DROP SCHEMA IF EXISTS survey_test_clock CASCADE');
    await resetSurveys();
  }
});

integration('POST uses PostGIS geography meters inclusively at site boundary, 30, and 50 meters', async () => {
  await resetSurveys();
  const point = await pool!.query<{ lon: number; lat: number }>(
    `SELECT ST_X(p)::float8 AS lon, ST_Y(p)::float8 AS lat FROM (
       SELECT ST_Project(ST_SetSRID(ST_MakePoint(100.15005,10.150025),4326)::geography,$1::double precision,pi()/2)::geometry AS p
     ) q`, [30],
  );
  const at30 = await create(await validSurvey(point.rows[0]));
  assert.equal(at30.response.status, 201);
  const at50Point = await pool!.query<{ lon: number; lat: number; within: boolean }>(
    `SELECT ST_X(p)::float8 AS lon, ST_Y(p)::float8 AS lat,
            ST_DWithin(site.geom::geography,p::geography,50) AS within
     FROM sites site CROSS JOIN (
       SELECT ST_Project(ST_SetSRID(ST_MakePoint(100.15005,10.15005),4326)::geography,50::double precision,pi()/4)::geometry AS p
     ) q
     WHERE site.id = $1`,
    [siteId],
  );
  assert.equal(at50Point.rows[0].within, true);
  const at50 = await create(await validSurvey({ lon: at50Point.rows[0].lon, lat: at50Point.rows[0].lat }));
  assert.equal(at50.response.status, 201);
  const boundary = await create(await validSurvey({ lon: 100.15005, lat: 10.150025 }));
  assert.equal(boundary.response.status, 201);
  const inside = await create(await validSurvey({ lon: 100.150025, lat: 10.150025 }));
  assert.equal(inside.response.status, 201);
});

integration('POST rejects 200-meter points with OUTSIDE_SITE', async () => {
  await resetSurveys();
  const point = await pool!.query<{ lon: number; lat: number }>(
    `SELECT ST_X(p)::float8 AS lon, ST_Y(p)::float8 AS lat FROM (
       SELECT ST_Project(ST_SetSRID(ST_MakePoint(100.15005,10.150025),4326)::geography,200::double precision,pi()/2)::geometry AS p
     ) q`,
  );
  const outside = await create(await validSurvey(point.rows[0]));
  assert.equal(outside.response.status, 422);
  assert.equal((outside.body.error as Record<string, unknown>).code, 'OUTSIDE_SITE');
  assert.equal((await pool!.query('SELECT count(*)::int AS count FROM surveys WHERE site_id = $1', [siteId])).rows[0].count, 0);
  const original = await create(await validSurvey());
  assert.equal(original.response.status, 201);
  const rejectedPatch = await request(`/surveys/${original.body.id}`, 'PATCH', point.rows[0], accessToken('admin'));
  assert.equal(rejectedPatch.response.status, 422);
  assert.equal((rejectedPatch.body.error as Record<string, unknown>).code, 'OUTSIDE_SITE');
  const stored = await pool!.query<{ lon: number; lat: number }>(
    'SELECT ST_X(geom)::float8 AS lon, ST_Y(geom)::float8 AS lat FROM surveys WHERE id = $1', [original.body.id],
  );
  assert.deepEqual(stored.rows[0], { lon: 100.150025, lat: 10.150025 });
});

integration('POST and PATCH derive status from all latest-date Surveys and threshold means', async () => {
  await resetSurveys();
  const { today, yesterday } = await todayAndDates();
  assert.equal((await status()).total, 0);
  const thresholds = [[0, 'poor'], [24.99, 'poor'], [25, 'fair'], [49.99, 'fair'], [50, 'good'], [74.99, 'good'], [75, 'very_good'], [100, 'very_good']] as const;
  for (const [cover, expected] of thresholds) {
    await resetSurveys();
    const response = await create(await validSurvey({ surveyed_on: today, cover_percent: cover }));
    assert.equal(response.body.siteStatus, expected);
  }
  await resetSurveys();
  const older = await create(await validSurvey({ surveyed_on: yesterday, cover_percent: 90 }));
  assert.equal(older.body.siteStatus, 'very_good');
  const firstLatest = await create(await validSurvey({ surveyed_on: today, cover_percent: 20 }));
  assert.equal(firstLatest.body.siteStatus, 'poor');
  const secondLatest = await create(await validSurvey({ surveyed_on: today, cover_percent: 80 }));
  assert.equal(secondLatest.body.siteStatus, 'good');
  const updated = await request(`/surveys/${firstLatest.body.id}`, 'PATCH', { cover_percent: 40 }, accessToken('admin'));
  assert.equal(updated.response.status, 200);
  assert.equal(updated.body.siteStatus, 'good');
  const removed = await request(`/surveys/${secondLatest.body.id}`, 'DELETE', undefined, accessToken('admin'));
  assert.equal(removed.response.status, 204);
  assert.equal(await removed.response.text(), '');
  const siteAfterDelete = await request(`/sites/${siteCode}`);
  assert.equal((siteAfterDelete.body.properties as Record<string, unknown>).siteStatus, 'fair');
  const afterDelete = await request(`/surveys/${firstLatest.body.id}`, 'PATCH', { note: 'recomputed' }, accessToken('admin'));
  assert.equal(afterDelete.body.siteStatus, 'fair');
  const remaining = await request(`/surveys/${firstLatest.body.id}`, 'PATCH', { surveyed_on: yesterday }, accessToken('admin'));
  assert.equal(remaining.response.status, 200);
  assert.equal(remaining.body.siteStatus, 'good');
  const deleteLatest = await request(`/surveys/${older.body.id}`, 'DELETE', undefined, accessToken('admin'));
  assert.equal(deleteLatest.response.status, 204);
  assert.equal((await status()).total, 1);
  const deleteLast = await request(`/surveys/${firstLatest.body.id}`, 'DELETE', undefined, accessToken('admin'));
  assert.equal(deleteLast.response.status, 204);
  await resetSurveys();
  const empty = await status();
  assert.equal(empty.total, 0);
  const detail = await request(`/sites/${siteCode}`);
  assert.equal((detail.body.properties as Record<string, unknown>).latest_survey, null);
});

integration('PATCH validates IDs and partial edits; replaces species only when supplied and clears note on null', async () => {
  await resetSurveys();
  const initial = await create(await validSurvey({ species: [...speciesCodes], note: 'keep me' }));
  const roundedPatch = await fetch(`${origin}/surveys/${initial.body.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken('admin')}` },
    body: '{"cover_percent":1.0000000000000001}',
  });
  assert.equal(roundedPatch.status, 400);
  assert.equal(((await roundedPatch.json() as Record<string, unknown>).error as Record<string, unknown>).code, 'VALIDATION_ERROR');
  const unchangedCover = await pool!.query<{ cover_percent: string }>('SELECT cover_percent FROM surveys WHERE id = $1', [initial.body.id]);
  assert.equal(unchangedCover.rows[0].cover_percent, '40.00');
  assert.equal((await request('/surveys/abc', 'PATCH', { note: 'x' })).response.status, 401);
  assert.equal((await request('/surveys/abc', 'PATCH', { note: 'x' }, 'not-a-token')).response.status, 401);
  for (const role of ['viewer', 'editor'] as const) {
    const forbidden = await request('/surveys/abc', 'PATCH', { note: 'x' }, accessToken(role));
    assert.equal(forbidden.response.status, 403);
    assert.equal((forbidden.body.error as Record<string, unknown>).code, 'FORBIDDEN');
  }
  for (const id of ['0', '-1', '01', '1.0', 'abc']) {
    const invalid = await request(`/surveys/${id}`, 'PATCH', { note: 'x' }, accessToken('admin'));
    assert.equal(invalid.response.status, 400);
    assert.equal((invalid.body.error as Record<string, unknown>).code, 'VALIDATION_ERROR');
  }
  for (const id of ['0', '-1', '01', '1.0', 'abc']) {
    const invalid = await request(`/surveys/${id}`, 'DELETE', undefined, accessToken('admin'));
    assert.equal(invalid.response.status, 400);
    assert.equal((invalid.body.error as Record<string, unknown>).code, 'VALIDATION_ERROR');
  }
  const unknown = await request('/surveys/999999999999999999', 'PATCH', { note: 'x' }, accessToken('admin'));
  assert.equal(unknown.response.status, 404);
  assert.equal((unknown.body.error as Record<string, unknown>).code, 'SURVEY_NOT_FOUND');
  for (const body of [{}, { lon: 100.15 }, { lat: 10.15 }, { site_id: '2' }, { species: [`UNKNOWN-${siteCode}`] }]) {
    const invalid = await request(`/surveys/${initial.body.id}`, 'PATCH', body, accessToken('admin'));
    assert.equal(invalid.response.status, 400);
    assert.equal((invalid.body.error as Record<string, unknown>).code, 'VALIDATION_ERROR');
  }
  const forged = await request(`/surveys/${initial.body.id}`, 'PATCH', {
    note: 'forged', created_by: users.viewer, updated_by: users.viewer, updated_at: '2000-01-01T00:00:00Z',
  }, accessToken('admin'));
  assert.equal(forged.response.status, 400);
  const unchanged = await request(`/surveys/${initial.body.id}`, 'PATCH', { cover_percent: 41 }, accessToken('admin'));
  assert.equal(unchanged.response.status, 200);
  assert.equal(unchanged.body.note, 'keep me');
  assert.deepEqual((unchanged.body.species as string[]).sort(), [...speciesCodes].sort());
  const beforeSpecies = await pool!.query<{ created_by: string | null }>('SELECT created_by FROM surveys WHERE id = $1', [initial.body.id]);
  await pool!.query("UPDATE surveys SET updated_at = '2000-01-01 00:00:00+00', updated_by = $2 WHERE id = $1", [initial.body.id, users.viewer]);
  const replaced = await request(`/surveys/${initial.body.id}`, 'PATCH', { species: [speciesCodes[1], speciesCodes[1]] }, accessToken('admin'));
  assert.deepEqual(replaced.body.species, [speciesCodes[1]]);
  const audited = await pool!.query<{ created_by: string | null; updated_by: string | null; updated_at: Date }>(
    'SELECT created_by, updated_by, updated_at FROM surveys WHERE id = $1', [initial.body.id],
  );
  assert.equal(audited.rows[0].created_by, beforeSpecies.rows[0].created_by);
  assert.equal(audited.rows[0].updated_by, users.admin);
  assert.ok(audited.rows[0].updated_at > new Date('2000-01-01T00:00:00Z'));
  const savedSpecies = await pool!.query<{ species_code: string }>(
    'SELECT species_code FROM survey_species WHERE survey_id = $1 ORDER BY species_code', [initial.body.id],
  );
  assert.deepEqual(savedSpecies.rows.map(({ species_code }) => species_code), [speciesCodes[1]]);
  const cleared = await request(`/surveys/${initial.body.id}`, 'PATCH', { note: null }, accessToken('admin'));
  const savedNote = await pool!.query<{ note: string | null }>('SELECT note FROM surveys WHERE id = $1', [initial.body.id]);
  assert.equal(savedNote.rows[0].note, null);
  const newPosition = await pool!.query<{ lon: number; lat: number }>(
    `SELECT ST_X(p)::float8 AS lon, ST_Y(p)::float8 AS lat FROM (
       SELECT ST_Project(ST_SetSRID(ST_MakePoint(100.15005,10.150025),4326)::geography,20::double precision,pi()/2)::geometry AS p
     ) q`,
  );
  const loneCoordinate = await request(`/surveys/${initial.body.id}`, 'PATCH', { lon: newPosition.rows[0].lon }, accessToken('admin'));
  assert.equal(loneCoordinate.response.status, 400);
  const moved = await request(`/surveys/${initial.body.id}`, 'PATCH', newPosition.rows[0], accessToken('admin'));
  assert.equal(moved.body.lon, newPosition.rows[0].lon);
  assert.equal(moved.body.lat, newPosition.rows[0].lat);
});

integration('DELETE /surveys/:id authorizes before ID validation or lookup', async () => {
  for (const token of [undefined, 'invalid']) {
    const unauthenticated = await request('/surveys/not-a-number', 'DELETE', undefined, token);
    assert.equal(unauthenticated.response.status, 401);
    assert.equal((unauthenticated.body.error as Record<string, unknown>).code, 'UNAUTHORIZED');
  }
  for (const role of ['viewer', 'editor'] as const) {
    const forbidden = await request('/surveys/not-a-number', 'DELETE', undefined, accessToken(role));
    assert.equal(forbidden.response.status, 403);
    assert.equal((forbidden.body.error as Record<string, unknown>).code, 'FORBIDDEN');
  }
  const malformed = await request('/surveys/not-a-number', 'DELETE', undefined, accessToken('admin'));
  assert.equal(malformed.response.status, 400);
  assert.equal((malformed.body.error as Record<string, unknown>).code, 'VALIDATION_ERROR');
  const missing = await request('/surveys/9223372036854775807', 'DELETE', undefined, accessToken('admin'));
  assert.equal(missing.response.status, 404);
  assert.equal((missing.body.error as Record<string, unknown>).code, 'SURVEY_NOT_FOUND');
});

integration('DELETE hard-deletes Survey and species links, recomputes Site status, and preserves the shared error envelope', async () => {
  await resetSurveys();
  const created = await create(await validSurvey({ species: [...speciesCodes] }));
  const id = created.body.id as string;
  const populatedSite = await request(`/sites/${siteCode}`);
  assert.equal(((populatedSite.body.properties as Record<string, unknown>)).siteStatus, 'fair');
  const deleted = await request(`/surveys/${id}`, 'DELETE', undefined, accessToken('admin'));
  assert.equal(deleted.response.status, 204);
  assert.equal(await deleted.response.text(), '');
  assert.equal((await pool!.query('SELECT 1 FROM surveys WHERE id = $1', [id])).rowCount, 0);
  assert.equal((await pool!.query('SELECT 1 FROM survey_species WHERE survey_id = $1', [id])).rowCount, 0);
  const emptySite = await request(`/sites/${siteCode}`);
  assert.equal(((emptySite.body.properties as Record<string, unknown>)).siteStatus, 'no_data');
  const unknown = await request(`/surveys/${id}`, 'DELETE', undefined, accessToken('admin'));
  assert.equal(unknown.response.status, 404);
  assert.equal((unknown.body.error as Record<string, unknown>).code, 'SURVEY_NOT_FOUND');
});

integration('Survey create and Site geometry edit serialize without violating distance invariant', async () => {
  await resetSurveys();
  const coordinator = await pool!.connect();
  let committed = false;
  try {
    await coordinator.query('BEGIN');
    await coordinator.query('SELECT id FROM sites WHERE code = $1 FOR UPDATE', [siteCode]);
    const write = create(await validSurvey());
    const blocked = await waitForSiteLock();
    assert.ok(blocked, 'Survey POST should wait for the Site row lock');
    const edit = request(`/sites/${siteCode}`, 'PATCH', {
      version: 1,
      geometry: { type: 'Polygon', coordinates: [[[100.152,10.152],[100.1522,10.152],[100.1522,10.1522],[100.152,10.1522],[100.152,10.152]]] },
    }, accessToken('admin'));
    await coordinator.query('COMMIT');
    committed = true;
    const [edited, result] = await Promise.all([edit, write]);
    if (result.response.status === 201) {
      assert.equal(edited.response.status, 409);
      const invariant = await pool!.query<{ violations: number }>(
        `SELECT count(*)::int AS violations FROM surveys v JOIN sites s ON s.id = v.site_id
         WHERE v.site_id = $1 AND NOT ST_DWithin(s.geom::geography,v.geom::geography,50)`, [siteId],
      );
      assert.equal(invariant.rows[0].violations, 0);
    } else {
      assert.equal(result.response.status, 422);
      assert.equal((result.body.error as Record<string, unknown>).code, 'OUTSIDE_SITE');
      assert.equal(edited.response.status, 200);
      assert.equal((await pool!.query('SELECT count(*)::int AS count FROM surveys WHERE site_id = $1', [siteId])).rows[0].count, 0);
    }
  } finally {
    if (!committed) await coordinator.query('ROLLBACK');
    await pool!.query(
      `UPDATE sites SET geom = ST_Multi(ST_GeomFromText('POLYGON((100.15 10.15,100.15005 10.15,100.15005 10.15005,100.15 10.15005,100.15 10.15))',4326)),
         version = 1 WHERE id = $1`, [siteId],
    );
    coordinator.release();
  }
});

integration('Survey location PATCH and Site geometry edit cannot commit incompatible positions', async () => {
  await resetSurveys();
  const initial = await create(await validSurvey());
  const point = await pool!.query<{ lon: number; lat: number }>(
    `SELECT ST_X(p)::float8 AS lon, ST_Y(p)::float8 AS lat FROM (
       SELECT ST_Project(ST_SetSRID(ST_MakePoint(100.15005,10.150025),4326)::geography,40,pi()/2)::geometry AS p
     ) q`,
  );
  const coordinator = await pool!.connect();
  let committed = false;
  try {
    await coordinator.query('BEGIN');
    await coordinator.query('SELECT id FROM sites WHERE code = $1 FOR UPDATE', [siteCode]);
    const location = request(`/surveys/${initial.body.id}`, 'PATCH', point.rows[0], accessToken('admin'));
    assert.ok(await waitForSiteLock(), 'Survey PATCH should wait for the Site row lock');
    const geometry = request(`/sites/${siteCode}`, 'PATCH', {
      version: 1,
      geometry: { type: 'Polygon', coordinates: [[[100.1496,10.15],[100.14965,10.15],[100.14965,10.15005],[100.1496,10.15005],[100.1496,10.15]]] },
    }, accessToken('admin'));
    await coordinator.query('COMMIT');
    committed = true;
    const [moved, edited] = await Promise.all([location, geometry]);
    if (moved.response.status === 200) {
      assert.equal(edited.response.status, 409);
      assert.equal((edited.body.error as Record<string, unknown>).code, 'SURVEYS_OUTSIDE');
    } else {
      assert.equal(moved.response.status, 422);
      assert.equal((moved.body.error as Record<string, unknown>).code, 'OUTSIDE_SITE');
      assert.equal(edited.response.status, 200);
    }
    const invariant = await pool!.query<{ violations: number }>(
      `SELECT count(*)::int AS violations FROM surveys v JOIN sites s ON s.id = v.site_id
       WHERE v.site_id = $1 AND NOT ST_DWithin(s.geom::geography,v.geom::geography,50)`, [siteId],
    );
    assert.equal(invariant.rows[0].violations, 0);
  } finally {
    if (!committed) await coordinator.query('ROLLBACK');
    await pool!.query(
      `UPDATE sites SET geom = ST_Multi(ST_GeomFromText('POLYGON((100.15 10.15,100.15005 10.15,100.15005 10.15005,100.15 10.15005,100.15 10.15))',4326)),
         version = 1 WHERE id = $1`, [siteId],
    );
    coordinator.release();
  }
});

integration('Site delete racing Survey create cannot commit both delete and a linked Survey', async () => {
  await resetSurveys();
  const coordinator = await pool!.connect();
  let committed = false;
  try {
    await coordinator.query('BEGIN');
    await coordinator.query('SELECT id FROM sites WHERE code = $1 FOR UPDATE', [siteCode]);
    const write = create(await validSurvey());
    const blocked = await waitForSiteLock();
    assert.ok(blocked, 'Survey POST should wait for the Site row lock');
    const deletion = request(`/sites/${siteCode}`, 'DELETE', undefined, accessToken('admin'));
    await coordinator.query('COMMIT');
    committed = true;
    const [deleted, result] = await Promise.all([deletion, write]);
    if (result.response.status === 201) {
      assert.equal(deleted.response.status, 409);
      assert.equal((deleted.body.error as Record<string, unknown>).code, 'SITE_HAS_SURVEYS');
      assert.equal((await pool!.query('SELECT deleted_at FROM sites WHERE id = $1', [siteId])).rows[0].deleted_at, null);
      const invariant = await pool!.query<{ distance: number }>(
        `SELECT ST_Distance(s.geom::geography,v.geom::geography) AS distance
           FROM surveys v JOIN sites s ON s.id = v.site_id WHERE v.id = $1`, [result.body.id],
      );
      assert.ok(invariant.rows[0].distance <= 50);
    } else {
      assert.equal(result.response.status, 404);
      assert.equal((result.body.error as Record<string, unknown>).code, 'SITE_NOT_FOUND');
      assert.equal(deleted.response.status, 204);
      assert.ok((await pool!.query<{ deleted_at: Date | null }>('SELECT deleted_at FROM sites WHERE id = $1', [siteId])).rows[0].deleted_at);
      assert.equal((await pool!.query('SELECT count(*)::int AS count FROM surveys WHERE site_id = $1', [siteId])).rows[0].count, 0);
    }
  } finally {
    if (!committed) await coordinator.query('ROLLBACK');
    await resetSurveys();
    await pool!.query('UPDATE sites SET deleted_at = NULL, version = 1 WHERE id = $1', [siteId]);
    coordinator.release();
  }
});
