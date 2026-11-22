import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';
import { AppModule } from '../app.module';
import { runMigrations } from '../database/migrate';
import { setupSwagger } from '../swagger';

const testDatabaseUrl = process.env.IMPORT_TEST_DATABASE_URL;
const integration = testDatabaseUrl ? test : test.skip;
let app: INestApplication | undefined;
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
  app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
  setupSwagger(app);
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address();
  assert.ok(address && typeof address === 'object');
  origin = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await app?.close();
  if (!pool) return;
  if (siteId) {
    await pool.query('DELETE FROM survey_species WHERE survey_id IN (SELECT id FROM surveys WHERE site_id = $1)', [siteId]);
    await pool.query('DELETE FROM surveys WHERE site_id = $1', [siteId]);
  }
  if (createdSiteCodes.length) await pool.query('DELETE FROM sites WHERE code = ANY($1::text[])', [createdSiteCodes]);
  if (createdProvinceCode) await pool.query('DELETE FROM provinces WHERE code = $1', [createdProvinceCode]);
  if (createdSpeciesCodes.length) await pool.query('DELETE FROM species WHERE code = ANY($1::text[])', [createdSpeciesCodes]);
  await pool.end();
});

async function request(path: string, method = 'GET', body?: unknown): Promise<{ response: Response; body: Record<string, unknown> }> {
  return requestText(path, method, body === undefined ? undefined : JSON.stringify(body));
}

async function requestText(path: string, method = 'GET', body?: string): Promise<{ response: Response; body: Record<string, unknown> }> {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body,
  });
  return { response, body: response.status === 204 ? {} : await response.json() as Record<string, unknown> };
}

async function create(body: unknown, code = siteCode) {
  return request(`/sites/${code}/surveys`, 'POST', body);
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
  const response = await request(`/sites/${siteCode}/surveys`);
  return response.body;
}

async function waitForSiteLock(): Promise<boolean> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await pool!.query<{ blocked: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database()
       AND wait_event_type = 'Lock' AND query LIKE '%SELECT%sites%FOR%UPDATE%') AS blocked`,
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
  };
  type Operation = {
    requestBody?: { content?: Record<string, { schema?: Schema }> };
    responses?: Record<string, { content?: Record<string, { schema?: Schema }> }>;
  };
  const document = await response.json() as {
    paths: Record<string, Record<string, Operation>>;
    components?: { schemas?: Record<string, Schema> };
  };
  const post = document.paths['/sites/{code}/surveys'].post;
  const patch = document.paths['/surveys/{id}'].patch;
  const remove = document.paths['/surveys/{id}'].delete;
  const list = document.paths['/sites/{code}/surveys'].get;
  assert.ok(post && patch && remove && list);
  for (const [operation, statuses] of [
    [list, ['200', '400', '404']],
    [post, ['201', '400', '404', '422']],
    [patch, ['200', '400', '404', '422']],
    [remove, ['204', '404']],
  ] as const) {
    for (const code of statuses) assert.ok(operation.responses?.[code], `Missing documented response ${code}`);
  }
  const resolveSchema = (schema?: Schema) => schema?.$ref
    ? document.components?.schemas?.[schema.$ref.split('/').at(-1)!]
    : schema;
  const requestSchema = (operation: Operation) => resolveSchema(operation.requestBody?.content?.['application/json']?.schema);
  const responseSchema = (operation: Operation, code: string) =>
    resolveSchema(operation.responses?.[code]?.content?.['application/json']?.schema);
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
  assert.deepEqual(Object.keys(listedSurvey?.properties ?? {}).sort(), ['cover_percent', 'id', 'lat', 'lon', 'note', 'species', 'surveyed_on']);
});

integration('GET /sites/:code/surveys paginates deterministic list shapes and rejects invalid queries', async () => {
  await resetSurveys();
  const older = await create(await validSurvey({ surveyed_on: '2025-01-01', cover_percent: 10 }));
  const firstTie = await create(await validSurvey({ surveyed_on: '2025-02-01', cover_percent: 20 }));
  const secondTie = await create(await validSurvey({ surveyed_on: '2025-02-01', cover_percent: 30 }));
  assert.equal(older.body.siteStatus, 'poor');
  assert.equal(firstTie.body.siteStatus, 'poor');
  assert.equal(secondTie.body.siteStatus, 'fair');
  const page = await request(`/sites/${siteCode}/surveys`);
  assert.equal(page.response.status, 200);
  assert.deepEqual(Object.keys(page.body).sort(), ['items', 'page', 'total']);
  assert.equal(page.body.page, 1);
  assert.equal(page.body.total, 3);
  const items = page.body.items as Array<Record<string, unknown>>;
  assert.deepEqual(items.map(({ id }) => id), [secondTie.body.id, firstTie.body.id, older.body.id]);
  assert.deepEqual(Object.keys(items[0]).sort(), ['cover_percent', 'id', 'lat', 'lon', 'note', 'species', 'surveyed_on']);
  assert.equal(items[0].siteStatus, undefined);
  assert.deepEqual(items[0].species, [speciesCodes[0]]);
  const secondPage = await request(`/sites/${siteCode}/surveys?page=2&pageSize=2`);
  assert.deepEqual((secondPage.body.items as Array<Record<string, unknown>>).map(({ id }) => id), [older.body.id]);
  const emptyPage = await request(`/sites/${siteCode}/surveys?page=4&pageSize=1`);
  assert.deepEqual(emptyPage.body.items, []);
  const maxPage = await request(`/sites/${siteCode}/surveys?pageSize=100`);
  assert.equal((maxPage.body.items as unknown[]).length, 3);
  for (const query of ['page=0', 'page=1.2', 'pageSize=0', 'pageSize=101', 'pageSize=abc', 'other=x']) {
    const invalid = await request(`/sites/${siteCode}/surveys?${query}`);
    assert.equal(invalid.response.status, 400);
    assert.equal(((invalid.body.error as Record<string, unknown>).code), 'VALIDATION_ERROR');
    assert.deepEqual(Object.keys(invalid.body.error as object).sort(), ['code', 'details', 'message']);
  }
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
    headers: { 'content-type': 'application/json' },
    body: `{"lon":1e400,"lat":10.15,"surveyed_on":"${dates.today}","cover_percent":40,"species":[]}`,
  });
  assert.equal(nonFinite.status, 400);
  assert.equal(((await nonFinite.json() as Record<string, unknown>).error as Record<string, unknown>).code, 'VALIDATION_ERROR');
  const roundedLiteral = await requestText(
    `/sites/${siteCode}/surveys`, 'POST',
    `{"lon":100.150025,"lat":10.150025,"surveyed_on":"${dates.today}","cover_percent":40.001,"species":["${speciesCodes[0]}"]}`,
  );
  assert.equal(roundedLiteral.response.status, 400);
  assert.equal((roundedLiteral.body.error as Record<string, unknown>).code, 'VALIDATION_ERROR');
  const nulNote = await requestText(`/sites/${siteCode}/surveys`, 'POST', JSON.stringify({ ...base, note: 'bad\0note' }));
  assert.equal(nulNote.response.status, 400);
  assert.equal((nulNote.body.error as Record<string, unknown>).code, 'VALIDATION_ERROR');
  assert.equal((await pool!.query('SELECT count(*)::int AS count FROM surveys WHERE site_id = $1', [siteId])).rows[0].count, 0);
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
  const at50Point = await pool!.query<{ lon: number; lat: number }>(
    `SELECT ST_X(p)::float8 AS lon, ST_Y(p)::float8 AS lat FROM (
       SELECT ST_Project(ST_SetSRID(ST_MakePoint(100.15005,10.150025),4326)::geography,50::double precision,pi()/2)::geometry AS p
     ) q`,
  );
  const at50 = await create(await validSurvey(at50Point.rows[0]));
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
  const rejectedPatch = await request(`/surveys/${original.body.id}`, 'PATCH', point.rows[0]);
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
  const updated = await request(`/surveys/${firstLatest.body.id}`, 'PATCH', { cover_percent: 40 });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.body.siteStatus, 'good');
  const removed = await request(`/surveys/${secondLatest.body.id}`, 'DELETE');
  assert.equal(removed.response.status, 204);
  assert.equal(await removed.response.text(), '');
  const afterDelete = await request(`/surveys/${firstLatest.body.id}`, 'PATCH', { note: 'recomputed' });
  assert.equal(afterDelete.body.siteStatus, 'fair');
  const remaining = await request(`/surveys/${firstLatest.body.id}`, 'PATCH', { surveyed_on: yesterday });
  assert.equal(remaining.response.status, 200);
  assert.equal(remaining.body.siteStatus, 'good');
  const deleteLatest = await request(`/surveys/${older.body.id}`, 'DELETE');
  assert.equal(deleteLatest.response.status, 204);
  assert.equal((await status()).total, 1);
  const deleteLast = await request(`/surveys/${firstLatest.body.id}`, 'DELETE');
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
  for (const id of ['0', '-1', '01', '1.0', 'abc']) {
    const invalid = await request(`/surveys/${id}`, 'PATCH', { note: 'x' });
    assert.equal(invalid.response.status, 400);
    assert.equal((invalid.body.error as Record<string, unknown>).code, 'VALIDATION_ERROR');
  }
  for (const id of ['0', '-1', '01', '1.0', 'abc']) {
    const invalid = await request(`/surveys/${id}`, 'DELETE');
    assert.equal(invalid.response.status, 400);
    assert.equal((invalid.body.error as Record<string, unknown>).code, 'VALIDATION_ERROR');
  }
  const unknown = await request('/surveys/999999999999999999', 'PATCH', { note: 'x' });
  assert.equal(unknown.response.status, 404);
  assert.equal((unknown.body.error as Record<string, unknown>).code, 'SURVEY_NOT_FOUND');
  for (const body of [{}, { lon: 100.15 }, { lat: 10.15 }, { site_id: '2' }, { species: [`UNKNOWN-${siteCode}`] }]) {
    const invalid = await request(`/surveys/${initial.body.id}`, 'PATCH', body);
    assert.equal(invalid.response.status, 400);
    assert.equal((invalid.body.error as Record<string, unknown>).code, 'VALIDATION_ERROR');
  }
  const unchanged = await request(`/surveys/${initial.body.id}`, 'PATCH', { cover_percent: 41 });
  assert.equal(unchanged.response.status, 200);
  assert.equal(unchanged.body.note, 'keep me');
  assert.deepEqual((unchanged.body.species as string[]).sort(), [...speciesCodes].sort());
  const replaced = await request(`/surveys/${initial.body.id}`, 'PATCH', { species: [speciesCodes[1], speciesCodes[1]] });
  assert.deepEqual(replaced.body.species, [speciesCodes[1]]);
  const savedSpecies = await pool!.query<{ species_code: string }>(
    'SELECT species_code FROM survey_species WHERE survey_id = $1 ORDER BY species_code', [initial.body.id],
  );
  assert.deepEqual(savedSpecies.rows.map(({ species_code }) => species_code), [speciesCodes[1]]);
  const cleared = await request(`/surveys/${initial.body.id}`, 'PATCH', { note: null });
  assert.equal(cleared.body.note, null);
  const savedNote = await pool!.query<{ note: string | null }>('SELECT note FROM surveys WHERE id = $1', [initial.body.id]);
  assert.equal(savedNote.rows[0].note, null);
  const newPosition = await pool!.query<{ lon: number; lat: number }>(
    `SELECT ST_X(p)::float8 AS lon, ST_Y(p)::float8 AS lat FROM (
       SELECT ST_Project(ST_SetSRID(ST_MakePoint(100.15005,10.150025),4326)::geography,20::double precision,pi()/2)::geometry AS p
     ) q`,
  );
  const loneCoordinate = await request(`/surveys/${initial.body.id}`, 'PATCH', { lon: newPosition.rows[0].lon });
  assert.equal(loneCoordinate.response.status, 400);
  const moved = await request(`/surveys/${initial.body.id}`, 'PATCH', newPosition.rows[0]);
  assert.equal(moved.response.status, 200);
  assert.equal(moved.body.lon, newPosition.rows[0].lon);
  assert.equal(moved.body.lat, newPosition.rows[0].lat);
});

integration('DELETE hard-deletes Survey and species links; unknown IDs use shared envelope', async () => {
  await resetSurveys();
  const created = await create(await validSurvey({ species: [...speciesCodes] }));
  const id = created.body.id as string;
  const deleted = await request(`/surveys/${id}`, 'DELETE');
  assert.equal(deleted.response.status, 204);
  assert.equal(await deleted.response.text(), '');
  assert.equal((await pool!.query('SELECT 1 FROM surveys WHERE id = $1', [id])).rowCount, 0);
  assert.equal((await pool!.query('SELECT 1 FROM survey_species WHERE survey_id = $1', [id])).rowCount, 0);
  const unknown = await request(`/surveys/${id}`, 'DELETE');
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
    });
    await coordinator.query('COMMIT');
    committed = true;
    const [edited, result] = await Promise.all([edit, write]);
    assert.equal(edited.response.status, 409);
    assert.equal(result.response.status, 201);
    const invariant = await pool!.query<{ distance: number }>(
      `SELECT ST_Distance(s.geom::geography,v.geom::geography) AS distance
         FROM surveys v JOIN sites s ON s.id = v.site_id WHERE v.id = $1`, [result.body.id],
    );
    assert.ok(invariant.rows[0].distance <= 50);
  } finally {
    if (!committed) await coordinator.query('ROLLBACK');
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
    const deletion = request(`/sites/${siteCode}`, 'DELETE');
    await coordinator.query('COMMIT');
    committed = true;
    const [deleted, result] = await Promise.all([deletion, write]);
    assert.equal(result.response.status, 201);
    assert.equal(deleted.response.status, 409);
    assert.equal((deleted.body.error as Record<string, unknown>).code, 'SITE_HAS_SURVEYS');
    assert.equal((await pool!.query('SELECT deleted_at FROM sites WHERE id = $1', [siteId])).rows[0].deleted_at, null);
    const invariant = await pool!.query<{ distance: number }>(
      `SELECT ST_Distance(s.geom::geography,v.geom::geography) AS distance
         FROM surveys v JOIN sites s ON s.id = v.site_id WHERE v.id = $1`, [result.body.id],
    );
    assert.ok(invariant.rows[0].distance <= 50);
  } finally {
    if (!committed) await coordinator.query('ROLLBACK');
    coordinator.release();
  }
});
