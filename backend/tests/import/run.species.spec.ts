import { expect, afterAll, beforeAll, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
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
    const token = randomUUID();
    codes = [`species-${token}-new`, `species-${token}-existing`];
    const result = await pool.query('SELECT 1 FROM species WHERE code = ANY($1::text[])', [codes]);
    occupied = result.rowCount !== 0;
  } while (occupied);
  directory = await mkdtemp(join(tmpdir(), 'species-import-'));
  reportPath = join(directory, 'import_report.csv');
  await writeFile(join(directory, 'provinces.geojson'), JSON.stringify({ type: 'FeatureCollection', features: [] }));
  await writeFile(join(directory, 'seagrass_sites.geojson'), JSON.stringify({ type: 'FeatureCollection', features: [] }));
  await writeFile(join(directory, 'surveys.csv'), 'survey_ref,site_code,lon,lat,surveyed_on,cover_percent,species\n');
  await writeFile(join(directory, 'species.json'), JSON.stringify([
    { code: codes[0], name_th: 'ชื่อแรก', name_sci: 'First species' },
    { code: codes[0], name_th: 'ชื่อซ้ำ', name_sci: 'Duplicate species' },
    { code: '', name_th: 'ไม่มีรหัส', name_sci: 'Invalid species' },
    { code: codes[1], name_th: 'ชื่อจากไฟล์', name_sci: 'File species' },
  ]));
  await pool.query('INSERT INTO species (code, name_th, name_sci) VALUES ($1, $2, $3)', [codes[1], 'ชื่อเดิม', 'Existing species']);
});

afterAll(async () => {
  if (pool) {
    await pool.query('DELETE FROM species WHERE code = ANY($1::text[])', [codes]);
    await pool.end();
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});

integration('public import command keeps first species, skips existing values, and reports source rows on rerun', async () => {
  const run = () => {
    const result = spawnSync('npm', ['run', 'import'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, SEED_DATA_DIR: directory, IMPORT_REPORT_PATH: reportPath },
    });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    return result.stdout;
  };
  expect(run()).toMatch(/"species":\{"inserted":1,"skipped_existing":1,"rejected":2\}/);
  const rows = await pool!.query<{ code: string; name_th: string; name_sci: string }>(
    'SELECT code, name_th, name_sci FROM species WHERE code = ANY($1::text[]) ORDER BY code', [codes],
  );
  expect(rows.rows.length).toBe(2);
  expect(rows.rows.some((row) => row.code === codes[0] && row.name_th === 'ชื่อแรก' && row.name_sci === 'First species')).toBeTruthy();
  expect(rows.rows.some((row) => row.code === codes[1] && row.name_th === 'ชื่อเดิม' && row.name_sci === 'Existing species')).toBeTruthy();
  const report = await readFile(reportPath, 'utf8');
  expect(report).toMatch(/species\.json,2,DUPLICATE_CODE/);
  expect(report).toMatch(/species\.json,3,INVALID_PROPERTIES/);
  expect(run()).toMatch(/"species":\{"inserted":0,"skipped_existing":2,"rejected":2\}/);
  expect(await readFile(reportPath, 'utf8')).toBe(report);
  await writeFile(join(directory, 'species.json'), '{');
  const malformed = spawnSync('npm', ['run', 'import'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, SEED_DATA_DIR: directory, IMPORT_REPORT_PATH: reportPath },
  });
  expect(malformed.status).not.toBe(0);
  expect(malformed.stderr).toMatch(/Invalid JSON in species\.json/);
});
