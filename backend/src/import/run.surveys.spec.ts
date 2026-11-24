import { expect, afterAll, beforeAll, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Pool } from 'pg';
import { runMigrations } from '../platform/database';

const header = 'survey_ref,site_code,lon,lat,surveyed_on,cover_percent,species';

const testDatabaseUrl = process.env.IMPORT_TEST_DATABASE_URL;
const integration = testDatabaseUrl ? test : test.skip;
let pool: Pool | undefined;
let directory = '';
let reportPath = '';
let provinceCode = '';
let activeCode = '';
let deletedCode = '';
let speciesCode = '';
let duplicateSpeciesCode = '';
let refs: string[] = [];

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
  const token = randomUUID();
  activeCode = `survey-site-${token}`;
  deletedCode = `deleted-site-${token}`;
  speciesCode = `survey-species-${token}`;
  duplicateSpeciesCode = `survey-species-2-${token}`;
  refs = ['valid-30', 'valid-50', 'existing', 'duplicate', 'outside-200', 'missing', 'deleted', 'cover-low', 'cover-high', 'cover-bad', 'future', 'unknown', 'atomic', 'yesterday', 'empty-species', 'invalid-coordinates', 'invalid-date', 'existing-valid'].map((ref) => `${ref}-${token}`);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (let i = 0; i < alphabet.length ** 2; i++) {
    const candidate = alphabet[Math.floor(Math.random() * alphabet.length)] + alphabet[Math.floor(Math.random() * alphabet.length)];
    const occupied = await pool.query('SELECT 1 FROM provinces WHERE code = $1', [candidate]);
    if (!occupied.rowCount) { provinceCode = candidate; break; }
  }
  expect(provinceCode, 'test needs an unused province code').toBeTruthy();
  await pool.query(`INSERT INTO provinces (code, name_th, geom) VALUES ($1, 'Survey test', ST_Multi(ST_GeomFromText('POLYGON((99.9 9.9,100.1 9.9,100.1 10.1,99.9 10.1,99.9 9.9))',4326)))`, [provinceCode]);
  await pool.query('INSERT INTO species (code,name_th,name_sci) VALUES ($1,$1,$1),($2,$2,$2)', [speciesCode, duplicateSpeciesCode]);
  const active = await pool.query<{ id: string }>(
    `INSERT INTO sites (code,name,province_code,geom,area_rai) VALUES ($1,'Active',$2,
       ST_Multi(ST_GeomFromText('POLYGON((99.99 9.99,100.01 9.99,100.01 10,99.99 10,99.99 9.99))',4326)),0) RETURNING id`,
    [activeCode, provinceCode],
  );
  await pool.query(
    `INSERT INTO sites (code,name,province_code,geom,area_rai,deleted_at) VALUES ($1,'Deleted',$2,
       ST_Multi(ST_GeomFromText('POLYGON((99.99 9.99,100.01 9.99,100.01 10,99.99 10,99.99 9.99))',4326)),0,NOW())`,
    [deletedCode, provinceCode],
  );
  const points = await pool.query<{ thirty_lon: string; thirty_lat: string; fifty_lon: string; fifty_lat: string; two_hundred_lon: string; two_hundred_lat: string; today: string; tomorrow: string; yesterday: string }>(
    `SELECT ST_X(ST_Project(center::geography,30,0)::geometry)::text AS thirty_lon,
            ST_Y(ST_Project(center::geography,30,0)::geometry)::text AS thirty_lat,
            ST_X(ST_Project(center::geography,50,0)::geometry)::text AS fifty_lon,
            ST_Y(ST_Project(center::geography,50,0)::geometry)::text AS fifty_lat,
            ST_X(ST_Project(center::geography,200,0)::geometry)::text AS two_hundred_lon,
            ST_Y(ST_Project(center::geography,200,0)::geometry)::text AS two_hundred_lat,
            (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok')::date::text AS today,
            ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok')::date + 1)::text AS tomorrow,
            ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok')::date - 1)::text AS yesterday
       FROM (SELECT ST_SetSRID(ST_MakePoint(100,10),4326) AS center) AS point`,
  );
  const { thirty_lon, thirty_lat, fifty_lon, fifty_lat, two_hundred_lon, two_hundred_lat, today, tomorrow, yesterday } = points.rows[0];
  const siteId = active.rows[0].id;
  await pool.query('INSERT INTO surveys (site_id,survey_ref,geom,surveyed_on,cover_percent) VALUES ($1,$2,ST_SetSRID(ST_MakePoint(100,10),4326),$3,44),($1,$4,ST_SetSRID(ST_MakePoint(100,10),4326),$3,33)', [siteId, refs[2], today, refs[17]]);
  directory = await mkdtemp(join(tmpdir(), 'survey-import-'));
  reportPath = join(directory, 'import_report.csv');
  await writeFile(join(directory, 'provinces.geojson'), JSON.stringify({ type: 'FeatureCollection', features: [] }));
  await writeFile(join(directory, 'species.json'), '[]');
  await writeFile(join(directory, 'seagrass_sites.geojson'), JSON.stringify({ type: 'FeatureCollection', features: [] }));
  const row = (ref: string, code = activeCode, lon = '100', lat = '10', cover = '50', date = today, species = speciesCode) => `${ref},${code},${lon},${lat},${date},${cover},${species}`;
  await writeFile(join(directory, 'surveys.csv'), [
    header,
    row(refs[0], activeCode, thirty_lon, thirty_lat, '50', today, `${speciesCode}|${duplicateSpeciesCode}`),
    row(refs[1], activeCode, fifty_lon, fifty_lat, '100'),
    row(refs[2], activeCode, '100', '10', '50', today, 'unknown-species'),
    row(refs[3]),
    row(refs[3]),
    row(refs[4], activeCode, two_hundred_lon, two_hundred_lat),
    row(refs[5], 'missing-site'),
    row(refs[6], deletedCode),
    row(refs[7], activeCode, '100', '10', '-1'),
    row(refs[8], activeCode, '100', '10', '0'),
    row(refs[9], activeCode, '100', '10', '101'),
    row(refs[10], activeCode, '100', '10', '50', tomorrow),
    row(refs[11], activeCode, '100', '10', '50', today, 'unknown-species'),
    row(refs[12], activeCode, '100', '10', '50', today, `${speciesCode}|unknown-species`),
    row(refs[13], activeCode, '100', '10', '50', yesterday),
    row(refs[14], activeCode, '100', '10', '50', today, ''),
    row(refs[15], activeCode, '181'),
    row(refs[16], activeCode, '100', '10', '50', '2026-02-30'),
    row(refs[17]),
  ].join('\n'));
});
afterAll(async () => {
  if (pool) {
    await pool.query('DELETE FROM survey_species WHERE survey_id IN (SELECT id FROM surveys WHERE survey_ref = ANY($1::text[]))', [refs]);
    if (refs.length) await pool.query('DELETE FROM surveys WHERE survey_ref = ANY($1::text[])', [refs]);
    if (activeCode) await pool.query('DELETE FROM sites WHERE code = ANY($1::text[])', [[activeCode, deletedCode]]);
    if (speciesCode) await pool.query('DELETE FROM species WHERE code = ANY($1::text[])', [[speciesCode, duplicateSpeciesCode]]);
    if (provinceCode) await pool.query('DELETE FROM provinces WHERE code = $1', [provinceCode]);
    await pool.end();
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});

integration('public import preserves existing surveys when source revisions are invalid', async () => {
  const run = () => {
    const result = spawnSync('npm', ['run', 'import'], {
      cwd: process.cwd(), encoding: 'utf8',
      env: { ...process.env, SEED_DATA_DIR: directory, IMPORT_REPORT_PATH: reportPath },
    });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    return result.stdout;
  };
  expect(run()).toMatch(/"surveys":\{"inserted":5,"skipped_existing":2,"rejected":12\}/);
  const saved = await pool!.query<{ survey_ref: string }>('SELECT survey_ref FROM surveys WHERE survey_ref = ANY($1::text[]) ORDER BY survey_ref', [refs]);
  expect(saved.rows.map(({ survey_ref }) => survey_ref).sort()).toStrictEqual([refs[0], refs[1], refs[2], refs[3], refs[8], refs[13], refs[17]].sort());
  const links = await pool!.query<{ count: string }>(
    'SELECT count(*) FROM survey_species ss JOIN surveys s ON s.id = ss.survey_id WHERE s.survey_ref = ANY($1::text[])', [refs],
  );
  expect(links.rows[0].count).toBe('6');
  const report = await readFile(reportPath, 'utf8');
  for (const reason of ['DUPLICATE_SURVEY_REF', 'OUTSIDE_SITE', 'SITE_NOT_FOUND', 'INVALID_COVER', 'INVALID_COORDINATES', 'INVALID_DATE', 'FUTURE_DATE', 'UNKNOWN_SPECIES']) expect(report.includes(reason)).toBeTruthy();
  expect(!report.includes('surveys.csv,4,UNKNOWN_SPECIES')).toBeTruthy();
  expect(report.includes('surveys.csv,6,DUPLICATE_SURVEY_REF')).toBeTruthy();
  expect(report.includes('surveys.csv,7,OUTSIDE_SITE')).toBeTruthy();
  expect(run()).toMatch(/"surveys":\{"inserted":0,"skipped_existing":7,"rejected":12\}/);
  const existing = await pool!.query<{ cover_percent: string }>(
    'SELECT cover_percent::text AS cover_percent FROM surveys WHERE survey_ref = $1', [refs[2]],
  );
  expect(existing.rows[0].cover_percent).toBe('44.00');
  const validExisting = await pool!.query<{ cover_percent: string }>(
    'SELECT cover_percent::text AS cover_percent FROM surveys WHERE survey_ref = $1', [refs[17]],
  );
  expect(validExisting.rows[0].cover_percent).toBe('33.00');
  expect(await readFile(reportPath, 'utf8')).toBe(report);
});
