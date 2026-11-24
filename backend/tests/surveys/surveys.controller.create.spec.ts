import { expect, test } from 'vitest';
import { AppModule } from '../../src/app.module';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createDatabaseProvider, type DatabaseProvider } from '../../src/platform/database';
import {
  accessToken, create, deletedSiteCode, expiredToken, origin, pool, request, requestText,
  resetSurveys, siteCode, siteId, speciesCodes, todayAndDates, users, validSurvey,
} from './surveys.spec-helper';

const integration = process.env.IMPORT_TEST_DATABASE_URL ? test : test.skip;
integration('POST /sites/:code/surveys authenticates admins before validation and Site lookup', async () => {
  await resetSurveys();
  const malformed = { invalid: true };
  for (const token of [null, 'not-a-token', expiredToken()]) {
    for (const code of [siteCode, `MISSING-${siteCode}`, deletedSiteCode]) {
      const denied = await create(malformed, code, token);
      expect(denied.response.status).toBe(401);
      expect(denied.body.error).toStrictEqual({ code: 'UNAUTHORIZED', message: 'Authentication required', details: {} });
    }
  }
  for (const role of ['viewer', 'editor'] as const) {
    for (const code of [siteCode, `MISSING-${siteCode}`, deletedSiteCode]) {
      const denied = await create(malformed, code, accessToken(role));
      expect(denied.response.status).toBe(403);
      expect(denied.body.error).toStrictEqual({ code: 'FORBIDDEN', message: 'Insufficient permissions', details: {} });
    }
  }
  expect((await pool!.query('SELECT count(*)::int AS count FROM surveys WHERE site_id = $1', [siteId])).rows[0].count).toBe(0);
});

integration('POST records authenticated Survey actors and exposes creator to protected reads', async () => {
  await resetSurveys();
  const body = await validSurvey();
  for (const key of ['created_by', 'updated_by', 'updated_at']) {
    const forged = await create({ ...body, [key]: users.viewer });
    expect(forged.response.status).toBe(400);
    expect((forged.body.error as Record<string, unknown>).code).toBe('VALIDATION_ERROR');
  }
  const created = await create(body);
  expect(created.response.status).toBe(201);
  expect(Object.keys(created.body).sort()).toStrictEqual(['cover_percent', 'id', 'lat', 'lon', 'note', 'siteStatus', 'species', 'surveyed_on']);
  const stored = await pool!.query<{ created_by: string; updated_by: string; updated_at: Date }>(
    'SELECT created_by::text, updated_by::text, updated_at FROM surveys WHERE id = $1', [created.body.id],
  );
  expect(stored.rows[0].created_by).toBe(users.admin);
  expect(stored.rows[0].updated_by).toBe(users.admin);
  expect(stored.rows[0].updated_at instanceof Date).toBeTruthy();
  const listed = await request(`/sites/${siteCode}/surveys`, 'GET', undefined, accessToken('viewer'));
  const item = (listed.body.items as Array<Record<string, unknown>>).find(({ id }) => id === created.body.id);
  expect(item?.created_by).toBe(users.admin);
});


integration('POST /sites/:code/surveys enforces API shapes, site visibility, and malformed JSON envelope', async () => {
  await resetSurveys();
  const created = await create(await validSurvey({ note: 'น้ำขุ่น', species: [speciesCodes[0], speciesCodes[1], speciesCodes[0]] }));
  expect(created.response.status).toBe(201);
  expect(Object.keys(created.body).sort()).toStrictEqual(['cover_percent', 'id', 'lat', 'lon', 'note', 'siteStatus', 'species', 'surveyed_on']);
  expect(created.body.siteStatus).toBe('fair');
  expect((created.body.species as string[]).sort()).toStrictEqual([...speciesCodes].sort());
  expect(created.body.note).toBe('น้ำขุ่น');
  const absentNote = await create(await validSurvey({ species: [] }));
  expect(absentNote.body.note).toBe(null);
  expect(absentNote.body.species).toStrictEqual([]);
  for (const code of [`MISSING-${siteCode}`, deletedSiteCode]) {
    const missing = await create(await validSurvey(), code);
    expect(missing.response.status).toBe(404);
    expect((missing.body.error as Record<string, unknown>).code).toBe('SITE_NOT_FOUND');
  }
  const malformed = await fetch(`${origin}/sites/${siteCode}/surveys`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{',
  });
  expect(malformed.status).toBe(400);
  expect((await malformed.json() as Record<string, unknown>).error).toStrictEqual({
    code: 'VALIDATION_ERROR', message: 'Validation failed', details: {},
  });
  const badBody = await create({ ...(await validSurvey()), id: '1', site_id: '1' });
  expect(badBody.response.status).toBe(400);
  expect((badBody.body.error as Record<string, unknown>).code).toBe('VALIDATION_ERROR');
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
    expect(invalid.response.status, JSON.stringify(body)).toBe(400);
    expect((invalid.body.error as Record<string, unknown>).code).toBe('VALIDATION_ERROR');
  }
  const nonFinite = await fetch(`${origin}/sites/${siteCode}/surveys`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken('admin')}` },
    body: `{"lon":1e400,"lat":10.15,"surveyed_on":"${dates.today}","cover_percent":40,"species":[]}`,
  });
  expect(nonFinite.status).toBe(400);
  expect(((await nonFinite.json() as Record<string, unknown>).error as Record<string, unknown>).code).toBe('VALIDATION_ERROR');
  const roundedLiteral = await fetch(`${origin}/sites/${siteCode}/surveys`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken('admin')}` },
    body: `{"lon":100.15,"lat":10.15,"surveyed_on":"${dates.today}","cover_percent":1.0000000000000001,"species":[]}`,
  });
  expect(roundedLiteral.status).toBe(400);
  expect(((await roundedLiteral.json() as Record<string, unknown>).error as Record<string, unknown>).code).toBe('VALIDATION_ERROR');
  const nulNote = await requestText(`/sites/${siteCode}/surveys`, 'POST', JSON.stringify({ ...base, note: 'bad\0note' }), accessToken('admin'));
  expect(nulNote.response.status).toBe(400);
  expect((nulNote.body.error as Record<string, unknown>).code).toBe('VALIDATION_ERROR');
  expect((await pool!.query('SELECT count(*)::int AS count FROM surveys WHERE site_id = $1', [siteId])).rows[0].count).toBe(0);
});

integration('POST and PATCH use the Bangkok calendar date across midnight', async () => {
  await resetSurveys();
  const previousOptions = process.env.PGOPTIONS;
  let clockDatabase: DatabaseProvider | undefined;
  let clockApp: INestApplication | undefined;
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
    expect(address && typeof address === 'object').toBeTruthy();
    const clockOrigin = `http://127.0.0.1:${address.port}`;
    const send = async (path: string, method: string, body: unknown, token: string | null = accessToken('admin')) => fetch(`${clockOrigin}${path}`, {
      method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body),
    });
    const yesterday = await send(`/sites/${siteCode}/surveys`, 'POST', await validSurvey({ surveyed_on: '2025-01-01' }));
    expect(yesterday.status).toBe(201);
    const id = (await yesterday.json() as { id: string }).id;
    expect((await send(`/sites/${siteCode}/surveys`, 'POST', await validSurvey({ surveyed_on: '2025-01-02' }))).status).toBe(400);
    expect((await send(`/surveys/${id}`, 'PATCH', { surveyed_on: '2025-01-02' })).status).toBe(400);
    await pool!.query("UPDATE survey_test_clock.fixed_time SET instant = '2025-01-01 17:00:00+00'");
    expect((await send(`/surveys/${id}`, 'PATCH', { surveyed_on: '2025-01-02' })).status).toBe(200);
    expect((await send(`/sites/${siteCode}/surveys`, 'POST', await validSurvey({ surveyed_on: '2025-01-02' }))).status).toBe(201);
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
  expect(at30.response.status).toBe(201);
  const at50Point = await pool!.query<{ lon: number; lat: number; within: boolean }>(
    `SELECT ST_X(p)::float8 AS lon, ST_Y(p)::float8 AS lat,
            ST_DWithin(site.geom::geography,p::geography,50) AS within
     FROM sites site CROSS JOIN (
       SELECT ST_Project(ST_SetSRID(ST_MakePoint(100.15005,10.15005),4326)::geography,50::double precision,pi()/4)::geometry AS p
     ) q
     WHERE site.id = $1`,
    [siteId],
  );
  expect(at50Point.rows[0].within).toBe(true);
  const at50 = await create(await validSurvey({ lon: at50Point.rows[0].lon, lat: at50Point.rows[0].lat }));
  expect(at50.response.status).toBe(201);
  const boundary = await create(await validSurvey({ lon: 100.15005, lat: 10.150025 }));
  expect(boundary.response.status).toBe(201);
  const inside = await create(await validSurvey({ lon: 100.150025, lat: 10.150025 }));
  expect(inside.response.status).toBe(201);
});

integration('POST rejects 200-meter points with OUTSIDE_SITE', async () => {
  await resetSurveys();
  const point = await pool!.query<{ lon: number; lat: number }>(
    `SELECT ST_X(p)::float8 AS lon, ST_Y(p)::float8 AS lat FROM (
       SELECT ST_Project(ST_SetSRID(ST_MakePoint(100.15005,10.150025),4326)::geography,200::double precision,pi()/2)::geometry AS p
     ) q`,
  );
  const outside = await create(await validSurvey(point.rows[0]));
  expect(outside.response.status).toBe(422);
  expect((outside.body.error as Record<string, unknown>).code).toBe('OUTSIDE_SITE');
  expect((await pool!.query('SELECT count(*)::int AS count FROM surveys WHERE site_id = $1', [siteId])).rows[0].count).toBe(0);
  const original = await create(await validSurvey());
  expect(original.response.status).toBe(201);
  const rejectedPatch = await request(`/surveys/${original.body.id}`, 'PATCH', point.rows[0], accessToken('admin'));
  expect(rejectedPatch.response.status).toBe(422);
  expect((rejectedPatch.body.error as Record<string, unknown>).code).toBe('OUTSIDE_SITE');
  const stored = await pool!.query<{ lon: number; lat: number }>(
    'SELECT ST_X(geom)::float8 AS lon, ST_Y(geom)::float8 AS lat FROM surveys WHERE id = $1', [original.body.id],
  );
  expect(stored.rows[0]).toStrictEqual({ lon: 100.150025, lat: 10.150025 });
});
