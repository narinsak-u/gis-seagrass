import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { after, before, test } from 'node:test';
import { Pool } from 'pg';
import { runMigrations } from '../database/migrate';
import { parseSpeciesArray, parseSpeciesRecord } from './species';

test('species parser requires array and nonempty required fields', () => {
  assert.throws(() => parseSpeciesArray('{'), /JSON/);
  assert.throws(() => parseSpeciesArray('{"code":"AA"}'), /array/i);
  assert.throws(() => parseSpeciesRecord({ code: ' ', name_th: 'ชื่อ', name_sci: 'Species' }), /INVALID_PROPERTIES/);
  assert.throws(() => parseSpeciesRecord({ code: 'AA', name_th: '', name_sci: 'Species' }), /INVALID_PROPERTIES/);
  assert.throws(() => parseSpeciesRecord({ code: 'AA', name_th: 'ชื่อ', name_sci: '  ' }), /INVALID_PROPERTIES/);
  assert.deepEqual(parseSpeciesRecord({ code: 'AA', name_th: 'ชื่อ', name_sci: 'Species alba' }), {
    code: 'AA', nameTh: 'ชื่อ', nameSci: 'Species alba',
  });
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
    const token = randomUUID();
    codes = [`species-${token}-new`, `species-${token}-existing`];
    const result = await pool.query('SELECT 1 FROM species WHERE code = ANY($1::text[])', [codes]);
    occupied = result.rowCount !== 0;
  } while (occupied);
  directory = await mkdtemp(join(tmpdir(), 'species-import-'));
  reportPath = join(directory, 'import_report.csv');
  await writeFile(join(directory, 'provinces.geojson'), JSON.stringify({ type: 'FeatureCollection', features: [] }));
  await writeFile(join(directory, 'seagrass_sites.geojson'), JSON.stringify({ type: 'FeatureCollection', features: [] }));
  await writeFile(join(directory, 'species.json'), JSON.stringify([
    { code: codes[0], name_th: 'ชื่อแรก', name_sci: 'First species' },
    { code: codes[0], name_th: 'ชื่อซ้ำ', name_sci: 'Duplicate species' },
    { code: '', name_th: 'ไม่มีรหัส', name_sci: 'Invalid species' },
    { code: codes[1], name_th: 'ชื่อจากไฟล์', name_sci: 'File species' },
  ]));
  await pool.query('INSERT INTO species (code, name_th, name_sci) VALUES ($1, $2, $3)', [codes[1], 'ชื่อเดิม', 'Existing species']);
});

after(async () => {
  if (pool) {
    await pool.query('DELETE FROM species WHERE code = ANY($1::text[])', [codes]);
    await pool.end();
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});

integration('public import command keeps first species, skips existing values, and reports source rows on rerun', async () => {
  const run = () => {
    const result = spawnSync('npm', ['run', 'import'], {
      cwd: join(__dirname, '../..'),
      encoding: 'utf8',
      env: { ...process.env, SEED_DATA_DIR: directory, IMPORT_REPORT_PATH: reportPath },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return result.stdout;
  };
  assert.match(run(), /"species":\{"inserted":1,"skipped_existing":1,"rejected":2\}/);
  const rows = await pool!.query<{ code: string; name_th: string; name_sci: string }>(
    'SELECT code, name_th, name_sci FROM species WHERE code = ANY($1::text[]) ORDER BY code', [codes],
  );
  assert.equal(rows.rows.length, 2);
  assert.ok(rows.rows.some((row) => row.code === codes[0] && row.name_th === 'ชื่อแรก' && row.name_sci === 'First species'));
  assert.ok(rows.rows.some((row) => row.code === codes[1] && row.name_th === 'ชื่อเดิม' && row.name_sci === 'Existing species'));
  const report = await readFile(reportPath, 'utf8');
  assert.match(report, /species\.json,2,DUPLICATE_CODE/);
  assert.match(report, /species\.json,3,INVALID_PROPERTIES/);
  assert.match(run(), /"species":\{"inserted":0,"skipped_existing":2,"rejected":2\}/);
  assert.equal(await readFile(reportPath, 'utf8'), report);
  await writeFile(join(directory, 'species.json'), '{');
  const malformed = spawnSync('npm', ['run', 'import'], {
    cwd: join(__dirname, '../..'),
    encoding: 'utf8',
    env: { ...process.env, SEED_DATA_DIR: directory, IMPORT_REPORT_PATH: reportPath },
  });
  assert.notEqual(malformed.status, 0);
  assert.match(malformed.stderr, /Invalid JSON in species\.json/);
});
