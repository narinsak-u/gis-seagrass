import { expect, afterAll, beforeAll, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { Pool } from 'pg';
import { runMigrations } from '../../src/platform/database';



const testDatabaseUrl = process.env.IMPORT_TEST_DATABASE_URL;
const integration = testDatabaseUrl ? test : test.skip;
let pool: Pool | undefined;
let directory: string;
let reportPath: string;
let codes: string[] = [];

beforeAll(async () => {
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
    occupied = new Set(codes).size !== codes.length || result.rowCount !== 0;
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
      feature(codes[2], [[106, 10], [107, 10], [107, 11], [106, 11], [106, 10]]),
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
afterAll(async () => {
  if (pool) {
    await pool.query('DELETE FROM provinces WHERE code = ANY($1::varchar[])', [codes]);
    await pool.end();
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});
integration('public import command persists valid MultiPolygon, skips existing codes, and reports source errors again', async () => {
  const run = () => {
    const result = spawnSync('npm', ['run', 'import'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, SEED_DATA_DIR: directory, IMPORT_REPORT_PATH: reportPath },
    });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    return result.stdout;
  };
  expect(run()).toMatch(/"inserted":2,"skipped_existing":1,"rejected":2/);

  const first = await pool!.query<{ code: string; name_th: string; geometrytype: string }>(
    "SELECT code, name_th, ST_GeometryType(geom) AS geometrytype FROM provinces WHERE code = ANY($1::varchar[]) ORDER BY code",
    [codes],
  );
  expect(first.rows.length).toBe(3);
  expect(first.rows.some((row) => row.code === codes[0] && row.name_th === `ชื่อ ${codes[0]}` && row.geometrytype === 'ST_MultiPolygon')).toBeTruthy();
  expect(first.rows.some((row) => row.code === codes[1] && row.name_th === 'Existing' && row.geometrytype === 'ST_MultiPolygon')).toBeTruthy();
  expect(first.rows.some((row) => row.code === codes[2] && row.name_th === `ชื่อ ${codes[2]}` && row.geometrytype === 'ST_MultiPolygon')).toBeTruthy();
  const report = await readFile(reportPath, 'utf8');
  expect(report).toMatch(/^file,row,reason\r?\n/);
  expect(report).toMatch(/provinces\.geojson,2,DUPLICATE_CODE/);
  expect(report).toMatch(/provinces\.geojson,4,INVALID_GEOMETRY/);
  expect(run()).toMatch(/"inserted":0,"skipped_existing":3,"rejected":2/);
  const secondReport = await readFile(reportPath, 'utf8');
  expect(secondReport).toMatch(/provinces\.geojson,2,DUPLICATE_CODE/);
  expect(secondReport).toMatch(/provinces\.geojson,4,INVALID_GEOMETRY/);
});
integration('concurrent public imports serialize, preserve identities, and produce the same rejection report', async () => {
  const codes = ['', ''];
  let occupied = true;
  while (occupied || codes[0] === codes[1]) {
    const token = randomUUID().replaceAll('-', '').toUpperCase();
    codes[0] = token.slice(0, 2);
    codes[1] = token.slice(2, 4);
    const result = await pool!.query('SELECT 1 FROM provinces WHERE code = ANY($1::varchar[])', [codes]);
    occupied = result.rowCount !== 0;
  }
  const directory = await mkdtemp(join(tmpdir(), 'province-import-concurrent-'));
  const reportPath = join(directory, 'import_report.csv');
  const feature = (code: string, coordinates: number[][]) => ({
    type: 'Feature',
    properties: { code, name_th: `ชื่อ ${code}` },
    geometry: { type: 'Polygon', coordinates: [coordinates] },
  });
  try {
    await writeFile(join(directory, 'provinces.geojson'), JSON.stringify({
      type: 'FeatureCollection',
      features: [
        feature(codes[0], [[100, 10], [101, 10], [101, 11], [100, 11], [100, 10]]),
        feature(codes[0], [[102, 10], [103, 10], [103, 11], [102, 11], [102, 10]]),
        feature(codes[1], [[106, 10], [108, 12], [106, 12], [108, 10], [106, 10]]),
      ],
    }));
    await writeFile(join(directory, 'species.json'), JSON.stringify([]));
    await writeFile(join(directory, 'seagrass_sites.geojson'), JSON.stringify({ type: 'FeatureCollection', features: [] }));
    await writeFile(join(directory, 'surveys.csv'), 'survey_ref,site_code,lon,lat,surveyed_on,cover_percent,species\n');
    const run = () => new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn('npm', ['run', 'import'], {
        cwd: process.cwd(),
        env: { ...process.env, SEED_DATA_DIR: directory, IMPORT_REPORT_PATH: reportPath },
      });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
      child.once('error', reject);
      child.once('close', (status) => status === 0 ? resolve({ stdout, stderr }) : reject(new Error(stderr || stdout)));
    });
    const [first, second] = await Promise.all([run(), run()]);
    const summaries = [first.stdout, second.stdout].map((stdout) => {
      const match = stdout.match(/"provinces":\{"inserted":(\d+),"skipped_existing":(\d+),"rejected":(\d+)\}/)!;
      expect(match, stdout).toBeTruthy();
      return match.slice(1).map(Number);
    });
    expect(summaries.sort((a, b) => a[0] - b[0])).toStrictEqual([[0, 1, 2], [1, 0, 2]]);
    const rows = await pool!.query<{ code: string; name_th: string; geometrytype: string }>(
      `SELECT code, name_th, ST_GeometryType(geom) AS geometrytype
         FROM provinces WHERE code = ANY($1::varchar[]) ORDER BY code`,
      [codes],
    );
    expect(rows.rows).toStrictEqual([{
      code: codes[0],
      name_th: `ชื่อ ${codes[0]}`,
      geometrytype: 'ST_MultiPolygon',
    }]);
    const report = await readFile(reportPath, 'utf8');
    expect(report).toMatch(/^file,row,reason\r?\n/);
    expect(report).toMatch(/provinces\.geojson,2,DUPLICATE_CODE/);
    expect(report).toMatch(/provinces\.geojson,3,INVALID_GEOMETRY/);
    const afterRerun = await run();
    expect(afterRerun.stdout).toMatch(/"provinces":\{"inserted":0,"skipped_existing":1,"rejected":2\}/);
    expect(await readFile(reportPath, 'utf8')).toBe(report);
    const persisted = await pool!.query('SELECT 1 FROM provinces WHERE code = ANY($1::varchar[])', [codes]);
    expect(persisted.rowCount).toBe(1);
  } finally {
    await pool!.query('DELETE FROM provinces WHERE code = ANY($1::varchar[])', [codes]);
    await rm(directory, { recursive: true, force: true });
  }
});
integration('public import fails visibly when PostgreSQL is unavailable', () => {
  const result = spawnSync('npm', ['run', 'import'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, SEED_DATA_DIR: directory, IMPORT_REPORT_PATH: reportPath, PGHOST: '127.0.0.1', PGPORT: '1' },
  });
  expect(result.status, result.stdout).not.toBe(0);
  expect(result.stderr).toMatch(/ECONNREFUSED/);
});
