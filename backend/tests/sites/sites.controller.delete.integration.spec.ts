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
        await waitForBlockedQuery('ST_AsGeoJSON(');
      } else {
        deletePromise = deleteSite(code);
        await waitForBlockedQuery('ST_AsGeoJSON(');
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

