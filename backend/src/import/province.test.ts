import assert from 'node:assert/strict';

import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { after, before, test } from 'node:test';
import { Pool } from 'pg';
import { runMigrations } from '../database/migrate';
import { parseProvinceCollection, parseProvinceFeature } from './province';

test('province parser rejects malformed collections and invalid WGS84 coordinates', () => {
  assert.throws(() => parseProvinceCollection('{'), /JSON/);
  assert.throws(() => parseProvinceCollection('{"type":"FeatureCollection"}'), /features/i);
  assert.throws(() => parseProvinceFeature({ type: 'Feature', properties: { code: 'AA' }, geometry: {
    type: 'Polygon', coordinates: [[[100, 10], [101, 10], [101, 11], [100, 10]]],
  } }), /INVALID_PROPERTIES/);
  assert.throws(() => parseProvinceFeature({ type: 'Feature', properties: { code: 'AA', name_th: 'จังหวัด' }, geometry: {
    type: 'Polygon', coordinates: [[[181, 10], [182, 10], [182, 11], [181, 10]]],
  } }), /INVALID_COORDINATES/);
});

const testDatabaseUrl = process.env.IMPORT_TEST_DATABASE_URL;
const integration = testDatabaseUrl ? test : test.skip;
let pool: Pool | undefined;
let directory: string;
let reportPath: string;
let codes: string[] = [];

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
  let occupied: boolean;
  do {
    const token = randomUUID().replaceAll('-', '').toUpperCase();
    codes = [token.slice(0, 2), token.slice(2, 4), token.slice(4, 6)];
    const result = await pool.query('SELECT 1 FROM provinces WHERE code = ANY($1::varchar[])', [codes]);
    occupied = result.rowCount !== 0;
  } while (occupied);
  directory = await mkdtemp(join(tmpdir(), 'province-import-'));
  reportPath = join(directory, 'import_report.csv');
  const feature = (code: string, coords: number[][]) => ({ type: 'Feature', properties: { code, name_th: `ชื่อ ${code}` }, geometry: { type: 'Polygon', coordinates: [coords] } });
  await writeFile(join(directory, 'provinces.geojson'), JSON.stringify({
    type: 'FeatureCollection',
    features: [
      feature(codes[0], [[100, 10], [101, 10], [101, 11], [100, 11], [100, 10]]),
      feature(codes[0], [[102, 10], [103, 10], [103, 11], [102, 11], [102, 10]]),
      feature(codes[1], [[104, 10], [105, 10], [105, 11], [104, 11], [104, 10]]),
      feature(codes[2], [[106, 10], [108, 12], [106, 12], [108, 10], [106, 10]]),
    ],
  }));
  await writeFile(join(directory, 'species.json'), JSON.stringify([]));
  await writeFile(join(directory, 'seagrass_sites.geojson'), JSON.stringify({ type: 'FeatureCollection', features: [] }));
  await writeFile(join(directory, 'surveys.csv'), 'survey_ref,site_code,lon,lat,surveyed_on,cover_percent,species\n');
  await pool.query(
    'INSERT INTO provinces (code, name_th, geom) VALUES ($1, $2, ST_GeomFromText($3,4326))',
    [codes[1], 'Existing', 'MULTIPOLYGON(((100 10,101 10,101 11,100 11,100 10)))'],
  );
});

after(async () => {
  if (pool) {
    await pool.query('DELETE FROM provinces WHERE code = ANY($1::varchar[])', [codes]);
    await pool.end();
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});

integration('public import command persists valid MultiPolygon, skips existing codes, and reports source errors again', async () => {
  const run = () => {
    const result = spawnSync('npm', ['run', 'import'], {
      cwd: join(__dirname, '../..'),
      encoding: 'utf8',
      env: { ...process.env, SEED_DATA_DIR: directory, IMPORT_REPORT_PATH: reportPath },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return result.stdout;
  };
  assert.match(run(), /"inserted":1,"skipped_existing":1,"rejected":2/);

  const first = await pool!.query<{ code: string; name_th: string; geometrytype: string }>(
    "SELECT code, name_th, ST_GeometryType(geom) AS geometrytype FROM provinces WHERE code = ANY($1::varchar[]) ORDER BY code",
    [codes],
  );
  assert.equal(first.rows.length, 2);
  assert.ok(first.rows.some((row) => row.code === codes[0] && row.name_th === `ชื่อ ${codes[0]}` && row.geometrytype === 'ST_MultiPolygon'));
  assert.ok(first.rows.some((row) => row.code === codes[1] && row.name_th === 'Existing' && row.geometrytype === 'ST_MultiPolygon'));
  const report = await readFile(reportPath, 'utf8');
  assert.match(report, /^file,row,reason\r?\n/);
  assert.match(report, /provinces\.geojson,2,DUPLICATE_CODE/);
  assert.match(report, /provinces\.geojson,4,INVALID_GEOMETRY/);
  assert.match(run(), /"inserted":0,"skipped_existing":2,"rejected":2/);
  const secondReport = await readFile(reportPath, 'utf8');
  assert.match(secondReport, /provinces\.geojson,2,DUPLICATE_CODE/);
  assert.match(secondReport, /provinces\.geojson,4,INVALID_GEOMETRY/);
});
