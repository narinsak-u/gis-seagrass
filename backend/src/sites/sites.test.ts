import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';
import { importSurveys, type ParsedSurvey } from '../import/surveys';
import { AppModule } from '../app.module';
import { signAccessToken } from '../auth/auth.controller';
import { runMigrations } from '../database/migrate';

const testDatabaseUrl = process.env.IMPORT_TEST_DATABASE_URL;
const integration = testDatabaseUrl ? test : test.skip;
let app: INestApplication | undefined;
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

before(async () => {
  process.env.JWT_SECRET ??= 'isolated-integration-signing-secret-32-bytes';
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
  app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address();
  assert.ok(address && typeof address === 'object');
  origin = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await app?.close();
  if (pool) {
    if (surveyRefs.length) {
      await pool.query('DELETE FROM survey_species WHERE survey_id IN (SELECT id FROM surveys WHERE survey_ref = ANY($1::text[]))', [surveyRefs]);
      await pool.query('DELETE FROM surveys WHERE survey_ref = ANY($1::text[])', [surveyRefs]);
    }
    await pool.query('DELETE FROM sites WHERE code = ANY($1::text[])', [[...siteCodes, ...createdSiteCodes]]);
    await pool.query('DELETE FROM provinces WHERE code = ANY($1::varchar[])', [provinceCodes]);
    await pool.query('DELETE FROM species WHERE code = $1', [importSpeciesCode]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [Object.values(users)]);
    await pool.end();
  }
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
    assert.equal(result.response.status, status);
    assert.equal((result.body.error as Record<string, unknown>).code, error);
  }
});

integration('PATCH /sites serializes same-version edits and records admin audit fields', async () => {
  const code = `PATCH-RACE-${postToken}`;
  const created = await createSite(siteFeature(code, polygon(100.15, 10.15, 100.25, 10.25)));
  assert.equal(created.response.status, 201);
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
  assert.deepEqual([first.response.status, second.response.status].sort(), [200, 409]);
  const success = first.response.status === 200 ? first : second;
  const conflict = first.response.status === 409 ? first : second;
  assert.equal((conflict.body.error as Record<string, unknown>).code, 'VERSION_CONFLICT');
  const current = (conflict.body.error as { details: { current: unknown } }).details.current;
  const currentFeature = current as { properties: Record<string, unknown> };
  assert.deepEqual(current, success.body);
  assert.equal('siteStatus' in currentFeature.properties, false);
  assert.equal(success.response.status, 200);
  const stored = await pool!.query<{ version: number; name: string; created_by: string | null; updated_by: string | null; updated_at: Date }>(
    'SELECT version, name, created_by, updated_by, updated_at FROM sites WHERE code = $1', [code],
  );
  assert.equal(stored.rows[0].version, 2);
  const successProperties = success.body.properties as Record<string, unknown>;
  assert.equal(stored.rows[0].name, successProperties.name);
  assert.equal(stored.rows[0].created_by, before.rows[0].created_by);
  assert.equal(stored.rows[0].updated_by, users.admin);
  assert.ok(stored.rows[0].updated_at);
  const combinedEdit = await patchSite(code, { version: 2, name: 'Combined edit', geometry: polygon(100.16, 10.16, 100.26, 10.26) });
  assert.equal(combinedEdit.response.status, 200);
  const spatialInvariant = await pool!.query<{ within: boolean }>(
    'SELECT ST_DWithin(s.geom::geography, v.geom::geography, 50) AS within FROM sites s JOIN surveys v ON v.site_id = s.id WHERE s.code = $1 AND v.survey_ref = $2',
    [code, ref],
  );
  assert.equal(spatialInvariant.rows[0].within, true);
  const forged = await patchSite(code, { version: 3, created_by: users.viewer, updated_by: users.viewer });
  assert.equal(forged.response.status, 400);
  assert.equal((forged.body.error as Record<string, unknown>).code, 'VALIDATION_ERROR');
  const combined = await pool!.query<{ version: number; updated_by: string | null }>(
    'SELECT version, updated_by FROM sites WHERE code = $1', [code],
  );
  assert.equal(combined.rows[0].version, 3);
  assert.equal(combined.rows[0].updated_by, users.admin);
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
  assert.fail(`Timed out waiting for blocked query: ${query}`);
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
    assert.equal(response.status, role === null ? 401 : 403);
    assert.equal((body.error as Record<string, unknown>).code, role === null ? 'UNAUTHORIZED' : 'FORBIDDEN');
  }
  const invalidTokenResponse = await fetch(`${origin}/sites`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer invalid' },
    body: JSON.stringify(invalid),
  });
  assert.equal(invalidTokenResponse.status, 401);
  assert.equal(((await invalidTokenResponse.json() as Record<string, any>).error).code, 'UNAUTHORIZED');

  await pool!.query('UPDATE users SET role = $1 WHERE id = $2', ['viewer', users.admin]);
  try {
    const { response, body } = await createSite(invalid, 'admin');
    assert.equal(response.status, 403);
    assert.equal((body.error as Record<string, unknown>).code, 'FORBIDDEN');
  } finally {
    await pool!.query('UPDATE users SET role = $1 WHERE id = $2', ['admin', users.admin]);
  }
});

integration('POST /sites stores the authenticated creator and updater', async () => {
  const feature = siteFeature(`POST-${postToken}`, polygon(100.15, 10.15, 100.25, 10.25));
  const { response, body } = await createSite(feature);
  assert.equal(response.status, 201);
  assert.deepEqual(Object.keys(body).sort(), ['geometry', 'properties', 'type']);
  assert.equal(body.type, 'Feature');
  assert.deepEqual((body.geometry as Record<string, unknown>).type, 'MultiPolygon');
  const properties = body.properties as Record<string, unknown>;
  assert.deepEqual(properties, {
    code: `POST-${postToken}`,
    name: `New POST-${postToken}`,
    province_code: provinceCodes[0],
    area_rai: properties.area_rai,
    version: 1,
  });
  assert.equal(typeof properties.area_rai, 'number');
  const stored = await pool!.query<{ area_rai: string; geometrytype: string; province_code: string; created_by: string; updated_by: string; updated_at: Date }>(
    `SELECT area_rai::text, ST_GeometryType(geom) AS geometrytype, province_code, created_by::text, updated_by::text, updated_at
       FROM sites WHERE code = $1`,
    [`POST-${postToken}`],
  );
  assert.equal(stored.rows[0].geometrytype, 'ST_MultiPolygon');
  assert.equal(stored.rows[0].province_code, provinceCodes[0]);
  assert.equal(properties.area_rai, Number(stored.rows[0].area_rai));
  assert.equal(stored.rows[0].created_by, users.admin);
  assert.equal(stored.rows[0].updated_by, users.admin);
  assert.ok(Math.abs(Date.now() - stored.rows[0].updated_at.getTime()) < 10_000);
});

integration('POST /sites rejects client-supplied audit fields', async () => {
  const feature = siteFeature(`POST-${postToken}-FORGED`, polygon(100.15, 10.15, 100.25, 10.25), {
    created_by: users.viewer, updated_by: users.viewer, updated_at: '2000-01-01T00:00:00.000Z',
  });
  const { response, body } = await createSite(feature);
  assert.equal(response.status, 400);
  assert.equal((body.error as Record<string, unknown>).code, 'VALIDATION_ERROR');
  assert.equal((await pool!.query('SELECT 1 FROM sites WHERE code = $1', [`POST-${postToken}-FORGED`])).rowCount, 0);
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
    assert.equal(checked.rows[0].valid, true);
    assert.ok(checked.rows[0].width > 0);
  };
  const checkStored = async () => {
    const stored = await pool!.query<{ valid: boolean; width: number }>(
      `SELECT ST_IsValid(geom) AS valid, ST_XMax(Box3D(geom)) - ST_XMin(Box3D(geom)) AS width
         FROM sites WHERE code = $1`,
      [code],
    );
    assert.equal(stored.rows[0].valid, true);
    assert.ok(stored.rows[0].width > 0);
  };

  const created = await createSite(siteFeature(code, narrow(100.1234567891)));
  assert.equal(created.response.status, 201);
  await checkGeometry(created.body.geometry);
  await checkStored();

  const patched = await patchSite(code, { version: 1, geometry: narrow(100.1234567895) });
  assert.equal(patched.response.status, 200);
  await checkGeometry(patched.body.geometry);
  await checkStored();

  const detail = await json(`/sites/${code}`);
  await checkGeometry(detail.body.geometry);
  const bbox = await json('/sites.geojson?bbox=100,10,101,11');
  const features = bbox.body.features as Array<Record<string, unknown>>;
  const feature = features.find((item) => (item.properties as Record<string, unknown>).code === code);
  assert.ok(feature);
  await checkGeometry(feature.geometry);
});


integration('POST /sites accepts MultiPolygon, chooses greatest overlap and allows Site overlap', async () => {
  const { response, body } = await createSite(siteFeature(`MULTI-${postToken}`, {
    type: 'MultiPolygon',
    coordinates: [
      polygon(100.3, 10.3, 100.4, 10.4).coordinates,
      polygon(101.1, 10.1, 101.3, 10.3).coordinates,
    ],
  }));
  assert.equal(response.status, 201);
  assert.equal((body.geometry as Record<string, unknown>).type, 'MultiPolygon');
  assert.equal((body.properties as Record<string, unknown>).province_code, provinceCodes[1]);
  assert.equal((await pool!.query('SELECT 1 FROM sites WHERE code = $1', [`MULTI-${postToken}`])).rowCount, 1);
});

integration('POST /sites breaks equal geographic overlap ties by Province code', async () => {
  const { response, body } = await createSite(siteFeature(`TIE-${postToken}`, polygon(100.5, 10.2, 101.5, 10.8)));
  assert.equal(response.status, 201);
  assert.equal((body.properties as Record<string, unknown>).province_code, [provinceCodes[0], provinceCodes[1]].sort()[0]);
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
    assert.equal(response.status, 400);
    assert.equal((body.error as Record<string, unknown>).code, code);
  }
  assert.equal((await pool!.query('SELECT 1 FROM sites WHERE code = $1', [`BAD-${postToken}`])).rowCount, 0);
});

integration('POST /sites rejects Province boundary-only contact and returns coverage error', async () => {
  const { response, body } = await createSite(siteFeature(`TOUCH-${postToken}`, polygon(99.9, 10.2, 100, 10.3)));
  assert.equal(response.status, 422);
  assert.equal((body.error as Record<string, unknown>).code, 'OUTSIDE_COVERAGE');
  assert.equal((await pool!.query('SELECT 1 FROM sites WHERE code = $1', [`TOUCH-${postToken}`])).rowCount, 0);
});

integration('POST /sites reserves active and deleted codes without deleting historical rows', async () => {
  for (const code of [siteCodes[0], siteCodes[3]]) {
    const { response, body } = await createSite(siteFeature(code, polygon(100.2, 10.2, 100.3, 10.3)));
    assert.equal(response.status, 409);
    assert.equal((body.error as Record<string, unknown>).code, 'DUPLICATE_CODE');
  }
  const history = await pool!.query<{ deleted_at: Date | null }>('SELECT deleted_at FROM sites WHERE code = $1', [siteCodes[3]]);
  assert.ok(history.rows[0].deleted_at);
});

integration('GET /sites returns exact numeric summaries without geometry, sorted and paginated', async () => {
  const { response, body } = await json(`/sites?q=${siteToken}`);
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(body).sort(), ['items', 'page', 'total']);
  assert.equal(body.total, 3);
  assert.equal(body.page, 1);
  const items = body.items as Array<Record<string, unknown>>;
  assert.deepEqual(items.map((item) => item.code), [...siteCodes.slice(0, 3)].sort());
  for (const item of items) {
    assert.deepEqual(Object.keys(item).sort(), ['area_rai', 'code', 'name', 'province_code', 'siteStatus', 'version']);
    assert.equal(item.siteStatus, 'no_data');
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
      assert.equal(((list.body.items as Array<Record<string, unknown>>)[0]).siteStatus, expected);
      assert.equal(((detail.body.properties as Record<string, unknown>)).siteStatus, expected);
      const feature = (map.body.features as Array<Record<string, unknown>>)
        .find((item) => (item.properties as Record<string, unknown>).code === siteCodes[0]);
      assert.equal((feature?.properties as Record<string, unknown>).siteStatus, expected);
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

integration('PATCH /sites enforces version and fields, then preserves spatial values for name-only edits', async () => {
  const code = `PATCH-${postToken}`;
  const { response: created, body: createdBody } = await createSite(siteFeature(code, polygon(100.15, 10.15, 100.25, 10.25)));
  assert.equal(created.status, 201);
  const original = createdBody.properties as Record<string, unknown>;
  for (const body of [
    { name: 'Bad' },
    { version: 1 },
    { version: 1, code: 'MUTATED' },
    { version: 1, province_code: 'AA' },
    { version: 1, name: 'Bad', unknown: true },
  ]) {
    const invalid = await patchSite(code, body);
    assert.equal(invalid.response.status, 400);
    assert.equal((invalid.body.error as Record<string, unknown>).code, 'VALIDATION_ERROR');
  }
  const missing = await patchSite(`missing-${postToken}`, { version: 1, name: 'No site' });
  assert.equal(missing.response.status, 404);
  assert.equal((missing.body.error as Record<string, unknown>).code, 'SITE_NOT_FOUND');
  const deleted = await patchSite(siteCodes[3], { version: 1, name: 'Retired edit' });
  assert.equal(deleted.response.status, 404);
  assert.equal((deleted.body.error as Record<string, unknown>).code, 'SITE_NOT_FOUND');
  const stale = await patchSite(code, { version: 2, name: 'Stale' });
  assert.equal(stale.response.status, 409);
  assert.equal((stale.body.error as Record<string, unknown>).code, 'VERSION_CONFLICT');

  const changed = await patchSite(code, { version: 1, name: 'Renamed' });
  assert.equal(changed.response.status, 200);
  assert.deepEqual(Object.keys(changed.body).sort(), ['geometry', 'properties', 'type']);
  const updated = changed.body.properties as Record<string, unknown>;
  assert.equal(updated.name, 'Renamed');
  assert.equal(updated.version, 2);
  assert.equal('latest_survey' in updated, false);
  assert.equal(updated.province_code, original.province_code);
  assert.equal(updated.area_rai, original.area_rai);
  assert.deepEqual(changed.body.geometry, createdBody.geometry);
});

integration('PATCH /sites recomputes geometry and rejects invalid coverage or stranded Surveys atomically', async () => {
  const code = `PATCH-GEO-${postToken}`;
  const { response: created, body: createdBody } = await createSite(siteFeature(code, polygon(100.15, 10.15, 100.25, 10.25)));
  assert.equal(created.status, 201);
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
  assert.equal(near.response.status, 200);
  const nearProps = near.body.properties as Record<string, unknown>;
  assert.notEqual(nearProps.area_rai, originalProps.area_rai);
  assert.equal(nearProps.province_code, originalProps.province_code);
  const before = await pool!.query<{ version: number; area_rai: string }>('SELECT version, area_rai::text FROM sites WHERE code = $1', [code]);
  const outside = await patchSite(code, { version: 2, geometry: polygon(100.5, 10.5, 100.6, 10.6) });
  assert.equal(outside.response.status, 409);
  assert.equal((outside.body.error as Record<string, unknown>).code, 'SURVEYS_OUTSIDE');
  const saved = await pool!.query<{ version: number; area_rai: string }>('SELECT version, area_rai::text FROM sites WHERE code = $1', [code]);
  assert.deepEqual(saved.rows[0], before.rows[0]);
  const invalid = await patchSite(code, { version: 2, geometry: polygon(102.5, 10.5, 102.6, 10.6) });
  assert.equal(invalid.response.status, 422);
  assert.equal((invalid.body.error as Record<string, unknown>).code, 'OUTSIDE_COVERAGE');
  const invalidGeometry = await patchSite(code, { version: 2, geometry: { type: 'Polygon', coordinates: [] } });
  assert.equal(invalidGeometry.response.status, 400);
  assert.equal((invalidGeometry.body.error as Record<string, unknown>).code, 'INVALID_GEOMETRY');
});

integration('PATCH accepts a linked Survey exactly 50 meters from the edited geometry', async () => {
  const code = `PATCH-50-${postToken}`;
  const ref = `patch-50-${siteToken}`;
  surveyRefs.push(ref);
  const created = await createSite(siteFeature(code, polygon(100.15, 10.15, 100.25, 10.25)));
  assert.equal(created.response.status, 201);
  const site = await pool!.query<{ id: string }>('SELECT id FROM sites WHERE code = $1', [code]);
  await pool!.query(
    `INSERT INTO surveys (site_id,survey_ref,geom,surveyed_on,cover_percent)
     VALUES ($1,$2,ST_Project(ST_SetSRID(ST_MakePoint(100.2,10.2),4326)::geography,50,pi()/2)::geometry,CURRENT_DATE,40)`,
    [site.rows[0].id, ref],
  );
  const result = await patchSite(code, { version: 1, geometry: polygon(100.19, 10.19, 100.2, 10.21) });
  assert.equal(result.response.status, 200);
});

integration('PATCH and Survey import serialize both lock orders without stranding accepted Surveys', async () => {
  for (const importFirst of [true, false]) {
    const suffix = importFirst ? 'IMPORT-FIRST' : 'EDIT-FIRST';
    const code = `PATCH-RACE-${suffix}-${siteToken}`;
    const ref = `patch-race-${suffix}-${siteToken}`;
    surveyRefs.push(ref);
    const created = await createSite(siteFeature(code, polygon(100.1, 10.1, 100.2, 10.2)));
    assert.equal(created.response.status, 201);
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
      const importPromise = importSurveys(importer, [record]);
      const patchPromise = importFirst
        ? undefined
        : patchSite(code, { version: 1, geometry: polygon(100.3, 10.3, 100.4, 10.4) });
      if (importFirst) {
        await waitForBlockedQuery('ST_DWithin(ST_SetSRID');
        const patch = patchSite(code, { version: 1, geometry: polygon(100.3, 10.3, 100.4, 10.4) });
        await waitForBlockedQuery('SELECT id, version, name FROM sites');
        await coordinator.query('COMMIT');
        committed = true;
        const [imported, edited] = await Promise.all([importPromise, patch]);
        assert.equal(imported.summary.inserted, 1);
        assert.equal(edited.response.status, 409);
        assert.equal((edited.body.error as Record<string, unknown>).code, 'SURVEYS_OUTSIDE');
      } else {
        await waitForBlockedQuery('SELECT id, version, name FROM sites');
        await waitForBlockedQuery('ST_DWithin(ST_SetSRID');
        await coordinator.query('COMMIT');
        committed = true;
        const [edited, imported] = await Promise.all([patchPromise!, importPromise]);
        assert.equal(edited.response.status, 200);
        assert.equal(imported.summary.inserted, 0);
        assert.deepEqual(imported.rejections.map(({ reason }) => reason), ['OUTSIDE_SITE']);
      }
    } finally {
      if (!committed) await coordinator.query('ROLLBACK');
      importer.release();
      coordinator.release();
    }
  }
});

integration('DELETE /sites requires admin before looking up a Site', async () => {
  for (const [role, status, code] of [
    [null, 401, `MISSING-${siteToken}`],
    ['viewer', 403, `MISSING-${siteToken}`],
    ['editor', 403, siteCodes[0]],
  ] as const) {
    const response = await deleteSite(code, role);
    assert.equal(response.status, status);
    assert.equal(((await response.json() as Record<string, unknown>).error as Record<string, unknown>).code,
      status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN');
  }
});

integration('DELETE /sites soft-deletes only Survey-free Sites and preserves code and audit actors', async () => {
  const code = `DELETE-${siteToken}`;
  const created = await createSite(siteFeature(code, polygon(100.6, 10.1, 100.7, 10.2)));
  assert.equal(created.response.status, 201);
  await pool!.query('UPDATE sites SET created_by = $2, updated_by = $2, updated_at = TIMESTAMPTZ \'2025-01-01\' WHERE code = $1',
    [code, users.viewer]);
  const deleted = await deleteSite(code);
  assert.equal(deleted.status, 204);
  assert.equal(await deleted.text(), '');
  const retained = await pool!.query<{ deleted_at: Date | null; created_by: string; updated_by: string; updated_at: Date }>(
    'SELECT deleted_at, created_by, updated_by, updated_at FROM sites WHERE code = $1', [code],
  );
  assert.ok(retained.rows[0].deleted_at);
  assert.equal(retained.rows[0].created_by, users.viewer);
  assert.equal(retained.rows[0].updated_by, users.admin);
  assert.ok(retained.rows[0].updated_at > new Date('2025-01-01'));
  for (const response of [await deleteSite(code), await deleteSite(`MISSING-${siteToken}`)]) {
    assert.equal(response.status, 404);
    assert.deepEqual((await response.json() as Record<string, unknown>).error, {
      code: 'SITE_NOT_FOUND', message: 'Site not found', details: {},
    });
  }
  const recreation = await createSite(siteFeature(code, polygon(100.6, 10.1, 100.7, 10.2)));
  assert.equal(recreation.response.status, 409);
  assert.equal((recreation.body.error as Record<string, unknown>).code, 'DUPLICATE_CODE');
  assert.equal(((await json(`/sites?q=${code}`)).body.items as unknown[]).length, 0);
  assert.equal((await json(`/sites/${code}`)).response.status, 404);
  const bbox = await json('/sites.geojson?bbox=100,10,101,11');
  assert.equal(bbox.response.status, 200);
  assert.equal((bbox.body.features as Array<Record<string, unknown>>).some(
    (feature) => (feature.properties as Record<string, unknown>).code === code,
  ), false);
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
  assert.equal(response.status, 409);
  assert.deepEqual((await response.json() as Record<string, unknown>).error, {
    code: 'SITE_HAS_SURVEYS', message: 'Site has linked Surveys', details: {},
  });
  assert.equal((await pool!.query('SELECT deleted_at FROM sites WHERE code = $1', [code])).rows[0].deleted_at, null);
});

integration('DELETE /sites and Survey import serialize both lock orders', async () => {
  for (const importFirst of [true, false]) {
    const suffix = importFirst ? 'IMPORT-FIRST' : 'DELETE-FIRST';
    const code = `DELETE-RACE-${suffix}-${siteToken}`;
    const ref = `delete-race-${suffix}-${siteToken}`;
    surveyRefs.push(ref);
    const created = await createSite(siteFeature(code, polygon(100.1, 10.1, 100.2, 10.2)));
    assert.equal(created.response.status, 201);
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
      const importPromise = importSurveys(importer, [record]);
      const deletionPromise = importFirst ? undefined : deleteSite(code);
      await waitForBlockedQuery('FROM sites WHERE code = $1');
      if (importFirst) {
        const deletion = deleteSite(code);
        await waitForBlockedQuery('SELECT id FROM sites WHERE code = $1 AND deleted_at IS NULL FOR UPDATE');
        await coordinator.query('COMMIT');
        committed = true;
        const [imported, deleted] = await Promise.all([importPromise, deletion]);
        assert.equal(imported.summary.inserted, 1);
        assert.equal(deleted.status, 409);
        assert.equal(((await deleted.json() as Record<string, unknown>).error as Record<string, unknown>).code, 'SITE_HAS_SURVEYS');
      } else {
        await waitForBlockedQuery('SELECT id FROM sites WHERE code = $1 AND deleted_at IS NULL FOR UPDATE');
        await coordinator.query('COMMIT');
        committed = true;
        const [deleted, imported] = await Promise.all([deletionPromise!, importPromise]);
        assert.equal(deleted.status, 204);
        assert.equal(imported.summary.inserted, 0);
        assert.deepEqual(imported.rejections.map(({ reason }) => reason), ['SITE_NOT_FOUND']);
      }
    } finally {
      if (!committed) await coordinator.query('ROLLBACK');
      importer.release();
      coordinator.release();
    }
  }
});
