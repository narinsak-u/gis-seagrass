import { expect, afterAll, beforeAll, test } from 'vitest';
import { Pool } from 'pg';
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

integration('GET /sites treats %, _, and \\ in q as literal substring characters rather than LIKE wildcards', async () => {
  const nameSiteCode = `WILD-NAME-${siteToken}`;
  const codeSiteCode = `WILD%_${siteToken}\\1`;
  const literalName = 'Meadow 50% bay_2 east\\wing';
  try {
    await pool!.query(
      `INSERT INTO sites (code, name, province_code, geom, area_rai, deleted_at) VALUES
        ($1, $2, $4, ST_Multi(ST_GeomFromText('POLYGON((100.2 10.2,100.3 10.2,100.3 10.3,100.2 10.3,100.2 10.2))',4326)), 1, NULL),
        ($3, 'Plain reef', $4, ST_Multi(ST_GeomFromText('POLYGON((100.4 10.2,100.5 10.2,100.5 10.3,100.4 10.3,100.4 10.2))',4326)), 1, NULL)`,
      [nameSiteCode, literalName, codeSiteCode, provinceCodes[0]],
    );

    const searchCodes = async (province: string, q: string) => {
      const query = new URLSearchParams({ province, q });
      const { response, body } = await json(`/sites?${query}`);
      expect(response.status).toBe(200);
      const codes = (body.items as Array<Record<string, unknown>>).map((item) => item.code);
      expect(body.total).toBe(codes.length);
      return codes;
    };

    // Positive matches on name and code (including case-insensitive matches) without matching ordinary Sites in the same province
    expect(await searchCodes(provinceCodes[0], '50%')).toStrictEqual([nameSiteCode]);
    expect(await searchCodes(provinceCodes[0], 'BAY_2')).toStrictEqual([nameSiteCode]);
    expect(await searchCodes(provinceCodes[0], 'east\\wing')).toStrictEqual([nameSiteCode]);
    expect(await searchCodes(provinceCodes[0], `wild%_${siteToken.toLowerCase()}\\1`)).toStrictEqual([codeSiteCode]);
    const bothWildCodes = [codeSiteCode, nameSiteCode].sort();
    expect(await searchCodes(provinceCodes[0], '%')).toStrictEqual(bothWildCodes);
    expect(await searchCodes(provinceCodes[0], '_')).toStrictEqual(bothWildCodes);
    expect(await searchCodes(provinceCodes[0], '\\')).toStrictEqual(bothWildCodes);

    // Negative non-matches against a province whose active Site ("Another zone") has none of %, _, or \
    for (const nonMatching of ['%', '_', '\\', 'Another_zone', 'Another%zone']) {
      expect(await searchCodes(provinceCodes[1], nonMatching)).toStrictEqual([]);
    }
  } finally {
    await pool!.query('DELETE FROM sites WHERE code = ANY($1::text[])', [[nameSiteCode, codeSiteCode]]);
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

