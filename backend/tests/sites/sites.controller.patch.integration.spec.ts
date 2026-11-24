import { expect, afterAll, beforeAll, test } from 'vitest';
import { Pool, type PoolClient } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../src/platform/database';
import { createSiteSurveyImportOperations } from '../../src/import/infrastructure/site-survey-operations';
import { importSurveys, type SurveyImportResult } from '../../src/import/application/import-surveys';
import type { ParsedSurvey } from '../../src/import/parser/surveys';
import { signAccessToken } from '../../src/auth/application/auth-token';
import { createSiteFixture, type SiteFixture } from './site-fixture';
const integration = process.env.IMPORT_TEST_DATABASE_URL ? test : test.skip;
let fixture: SiteFixture | undefined;
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
  fixture = await createSiteFixture();
  if (!fixture) return;
  ({ pool, origin, siteCodes, provinceCodes, createdSiteCodes, surveyRefs, siteToken, importSpeciesCode, postToken, users } = fixture);
});

afterAll(async () => {
  await fixture?.cleanup();
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

integration('PATCH /sites requires admin before validation or Site lookup', async () => {
  for (const [code, body, token, status, error] of [
    [siteCodes[0], {}, null, 401, 'UNAUTHORIZED'],
    [siteCodes[0], {}, 'not-a-token', 401, 'UNAUTHORIZED'],
    [siteCodes[0], {}, accessToken('viewer'), 403, 'FORBIDDEN'],
    [siteCodes[0], { version: 1, geometry: polygon(100.1, 10.1, 100.2, 10.2) }, accessToken('editor'), 403, 'FORBIDDEN'],
    [`missing-${siteToken}`, {}, accessToken('editor'), 403, 'FORBIDDEN'],
  ] as const) {
    const result = await patchSite(code, body, token);
    expect(result.response.status).toBe(status);
    expect((result.body.error as Record<string, unknown>).code).toBe(error);
  }
});

integration('PATCH /sites serializes same-version edits and records admin audit fields', async () => {
  const code = `PATCH-RACE-${postToken}`;
  const created = await createSite(siteFeature(code, polygon(100.15, 10.15, 100.25, 10.25)));
  expect(created.response.status).toBe(201);
  const ref = `patch-race-survey-${siteToken}`;
  surveyRefs.push(ref);
  const site = await pool!.query<{ id: string }>('SELECT id FROM sites WHERE code = $1', [code]);
  await pool!.query(
    `INSERT INTO surveys (site_id,survey_ref,geom,surveyed_on,cover_percent)
     VALUES ($1,$2,ST_SetSRID(ST_MakePoint(100.2,10.2),4326),CURRENT_DATE,40)`,
    [site.rows[0].id, ref],
  );
  const before = await pool!.query<{ created_by: string | null; updated_by: string | null }>(
    'SELECT created_by, updated_by FROM sites WHERE code = $1', [code],
  );
  const [first, second] = await Promise.all([
    patchSite(code, { version: 1, name: 'First edit' }),
    patchSite(code, { version: 1, name: 'Second edit' }),
  ]);
  expect([first.response.status, second.response.status].sort()).toStrictEqual([200, 409]);
  const success = first.response.status === 200 ? first : second;
  const conflict = first.response.status === 409 ? first : second;
  expect((conflict.body.error as Record<string, unknown>).code).toBe('VERSION_CONFLICT');
  const current = (conflict.body.error as { details: { current: unknown } }).details.current;
  const currentFeature = current as { properties: Record<string, unknown> };
  expect(current).toStrictEqual(success.body);
  expect('siteStatus' in currentFeature.properties).toBe(false);
  expect(success.response.status).toBe(200);
  const stored = await pool!.query<{ version: number; name: string; created_by: string | null; updated_by: string | null; updated_at: Date }>(
    'SELECT version, name, created_by, updated_by, updated_at FROM sites WHERE code = $1', [code],
  );
  expect(stored.rows[0].version).toBe(2);
  const successProperties = success.body.properties as Record<string, unknown>;
  expect(stored.rows[0].name).toBe(successProperties.name);
  expect(stored.rows[0].created_by).toBe(before.rows[0].created_by);
  expect(stored.rows[0].updated_by).toBe(users.admin);
  expect(stored.rows[0].updated_at).toBeTruthy();
  const combinedEdit = await patchSite(code, { version: 2, name: 'Combined edit', geometry: polygon(100.16, 10.16, 100.26, 10.26) });
  expect(combinedEdit.response.status).toBe(200);
  const spatialInvariant = await pool!.query<{ within: boolean }>(
    'SELECT ST_DWithin(s.geom::geography, v.geom::geography, 50) AS within FROM sites s JOIN surveys v ON v.site_id = s.id WHERE s.code = $1 AND v.survey_ref = $2',
    [code, ref],
  );
  expect(spatialInvariant.rows[0].within).toBe(true);
  const forged = await patchSite(code, { version: 3, created_by: users.viewer, updated_by: users.viewer });
  expect(forged.response.status).toBe(400);
  expect((forged.body.error as Record<string, unknown>).code).toBe('VALIDATION_ERROR');
  const combined = await pool!.query<{ version: number; updated_by: string | null }>(
    'SELECT version, updated_by FROM sites WHERE code = $1', [code],
  );
  expect(combined.rows[0].version).toBe(3);
  expect(combined.rows[0].updated_by).toBe(users.admin);
});

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

integration('PATCH /sites enforces version and fields, then preserves spatial values for name-only edits', async () => {
  const code = `PATCH-${postToken}`;
  const { response: created, body: createdBody } = await createSite(siteFeature(code, polygon(100.15, 10.15, 100.25, 10.25)));
  expect(created.status).toBe(201);
  const original = createdBody.properties as Record<string, unknown>;
  for (const body of [
    { name: 'Bad' },
    { version: 1 },
    { version: 1, code: 'MUTATED' },
    { version: 1, province_code: 'AA' },
    { version: 1, name: 'Bad', unknown: true },
  ]) {
    const invalid = await patchSite(code, body);
    expect(invalid.response.status).toBe(400);
    expect((invalid.body.error as Record<string, unknown>).code).toBe('VALIDATION_ERROR');
  }
  const missing = await patchSite(`missing-${postToken}`, { version: 1, name: 'No site' });
  expect(missing.response.status).toBe(404);
  expect((missing.body.error as Record<string, unknown>).code).toBe('SITE_NOT_FOUND');
  const deleted = await patchSite(siteCodes[3], { version: 1, name: 'Retired edit' });
  expect(deleted.response.status).toBe(404);
  expect((deleted.body.error as Record<string, unknown>).code).toBe('SITE_NOT_FOUND');
  const stale = await patchSite(code, { version: 2, name: 'Stale' });
  expect(stale.response.status).toBe(409);
  expect((stale.body.error as Record<string, unknown>).code).toBe('VERSION_CONFLICT');

  const changed = await patchSite(code, { version: 1, name: 'Renamed' });
  expect(changed.response.status).toBe(200);
  expect(Object.keys(changed.body).sort()).toStrictEqual(['geometry', 'properties', 'type']);
  const updated = changed.body.properties as Record<string, unknown>;
  expect(updated.name).toBe('Renamed');
  expect(updated.version).toBe(2);
  expect('latest_survey' in updated).toBe(false);
  expect(updated.province_code).toBe(original.province_code);
  expect(updated.area_rai).toBe(original.area_rai);
  expect(changed.body.geometry).toStrictEqual(createdBody.geometry);
});

integration('PATCH /sites recomputes geometry and rejects invalid coverage or stranded Surveys atomically', async () => {
  const code = `PATCH-GEO-${postToken}`;
  const { response: created, body: createdBody } = await createSite(siteFeature(code, polygon(100.15, 10.15, 100.25, 10.25)));
  expect(created.status).toBe(201);
  const originalProps = createdBody.properties as Record<string, unknown>;
  const site = await pool!.query<{ id: string }>('SELECT id FROM sites WHERE code = $1', [code]);
  const ref = `patch-survey-${siteToken}`;
  surveyRefs.push(ref);
  await pool!.query(
    `INSERT INTO surveys (site_id,survey_ref,geom,surveyed_on,cover_percent)
     VALUES ($1,$2,ST_SetSRID(ST_MakePoint(100.2,10.2),4326),CURRENT_DATE,40)`,
    [site.rows[0].id, ref],
  );
  const near = await patchSite(code, { version: 1, geometry: polygon(100.199, 10.199, 100.201, 10.201) });
  expect(near.response.status).toBe(200);
  const nearProps = near.body.properties as Record<string, unknown>;
  expect(nearProps.area_rai).not.toBe(originalProps.area_rai);
  expect(nearProps.province_code).toBe(originalProps.province_code);
  const before = await pool!.query<{ version: number; area_rai: string }>('SELECT version, area_rai::text FROM sites WHERE code = $1', [code]);
  const outside = await patchSite(code, { version: 2, geometry: polygon(100.5, 10.5, 100.6, 10.6) });
  expect(outside.response.status).toBe(409);
  expect((outside.body.error as Record<string, unknown>).code).toBe('SURVEYS_OUTSIDE');
  const saved = await pool!.query<{ version: number; area_rai: string }>('SELECT version, area_rai::text FROM sites WHERE code = $1', [code]);
  expect(saved.rows[0]).toStrictEqual(before.rows[0]);
  const invalid = await patchSite(code, { version: 2, geometry: polygon(102.5, 10.5, 102.6, 10.6) });
  expect(invalid.response.status).toBe(422);
  expect((invalid.body.error as Record<string, unknown>).code).toBe('OUTSIDE_COVERAGE');
  const invalidGeometry = await patchSite(code, { version: 2, geometry: { type: 'Polygon', coordinates: [] } });
  expect(invalidGeometry.response.status).toBe(400);
  expect((invalidGeometry.body.error as Record<string, unknown>).code).toBe('INVALID_GEOMETRY');
});

integration('PATCH accepts a linked Survey exactly 50 meters from the edited geometry', async () => {
  const code = `PATCH-50-${postToken}`;
  const ref = `patch-50-${siteToken}`;
  surveyRefs.push(ref);
  const created = await createSite(siteFeature(code, polygon(100.15, 10.15, 100.25, 10.25)));
  expect(created.response.status).toBe(201);
  const site = await pool!.query<{ id: string }>('SELECT id FROM sites WHERE code = $1', [code]);
  await pool!.query(
    `INSERT INTO surveys (site_id,survey_ref,geom,surveyed_on,cover_percent)
     VALUES ($1,$2,ST_Project(ST_SetSRID(ST_MakePoint(100.2,10.2),4326)::geography,50,pi()/2)::geometry,CURRENT_DATE,40)`,
    [site.rows[0].id, ref],
  );
  const result = await patchSite(code, { version: 1, geometry: polygon(100.19, 10.19, 100.2, 10.21) });
  expect(result.response.status).toBe(200);
});

integration('PATCH and Survey import serialize both lock orders without stranding accepted Surveys', async () => {
  for (const importFirst of [true, false]) {
    const suffix = importFirst ? 'IMPORT-FIRST' : 'EDIT-FIRST';
    const code = `PATCH-RACE-${suffix}-${siteToken}`;
    const ref = `patch-race-${suffix}-${siteToken}`;
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
          survey_ref: ref,
          site_code: code,
          lon: '100.15',
          lat: '10.15',
          surveyed_on: date.rows[0].today,
          cover_percent: '40',
          species: importSpeciesCode,
        },
      };
      let importPromise: Promise<SurveyImportResult>;
      let patchPromise: Promise<{ response: Response; body: Record<string, unknown> }>;
      if (importFirst) {
        importPromise = importSurveyRecords(importer, [record]);
        await waitForBlockedQuery('ST_DWithin(ST_SetSRID');
        patchPromise = patchSite(code, { version: 1, geometry: polygon(100.3, 10.3, 100.4, 10.4) });
        await waitForBlockedQuery('SELECT id::text, version, name, province_code, area_rai::text,');
      } else {
        patchPromise = patchSite(code, { version: 1, geometry: polygon(100.3, 10.3, 100.4, 10.4) });
        await waitForBlockedQuery('SELECT id::text, version, name, province_code, area_rai::text,');
        importPromise = importSurveyRecords(importer, [record]);
        await waitForBlockedQuery('ST_DWithin(ST_SetSRID');
      }
      await coordinator.query('COMMIT');
      committed = true;
      const [edited, imported] = await Promise.all([patchPromise, importPromise]);
      if (imported.summary.inserted) {
        expect(edited.response.status).toBe(409);
        expect((edited.body.error as Record<string, unknown>).code).toBe('SURVEYS_OUTSIDE');
        const distance = await pool!.query<{ within: boolean }>(
          `SELECT ST_DWithin(s.geom::geography, v.geom::geography, 50) AS within
             FROM sites s JOIN surveys v ON v.site_id = s.id WHERE s.code = $1 AND v.survey_ref = $2`,
          [code, ref],
        );
        expect(distance.rows[0].within).toBe(true);
      } else {
        expect(edited.response.status).toBe(200);
        expect(imported.rejections.map(({ reason }) => reason)).toStrictEqual(['OUTSIDE_SITE']);
      }
    } finally {
      if (!committed) await coordinator.query('ROLLBACK');
      importer.release();
      coordinator.release();
    }
  }
});

