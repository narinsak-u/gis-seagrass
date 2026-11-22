import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { Pool, type PoolClient } from 'pg';
import { runMigrations } from '../database/migrate';
import { importSiteFeatures, parseSiteFeature } from './sites';

test('Site parser requires nonempty identity and finite in-range lon/lat polygon coordinates', () => {
  const feature = (coordinates: unknown) => ({
    type: 'Feature',
    properties: { code: 'SITE-1', name: 'Site 1' },
    geometry: { type: 'Polygon', coordinates },
  });
  assert.throws(() => parseSiteFeature({ type: 'Feature', properties: { code: 'SITE-1', name: 'Site 1' }, geometry: { type: 'LineString', coordinates: [[100, 10], [101, 11]] } }), /INVALID_GEOMETRY/);
  assert.throws(() => parseSiteFeature(feature([[[181, 10], [182, 10], [182, 11], [181, 10]]])), /INVALID_COORDINATES/);
  assert.throws(() => parseSiteFeature({ ...feature([[[100, 10], [101, 10], [101, 11], [100, 10]]]), properties: { code: '', name: 'Site' } }), /INVALID_PROPERTIES/);
});

const testDatabaseUrl = process.env.IMPORT_TEST_DATABASE_URL;
const integration = testDatabaseUrl ? test : test.skip;
let pool: Pool | undefined;
let provinceCodes: string[] = [];
let siteCodes: string[] = [];
let client: PoolClient | undefined;

const polygon = (west: number, south: number, east: number, north: number) => ({
  type: 'Polygon',
  coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
});
const site = (code: string, geometry: unknown, name = `Site ${code}`) => ({
  type: 'Feature', properties: { code, name }, geometry,
});

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
  do {
    const token = randomUUID().replaceAll('-', '').toUpperCase();
    provinceCodes = [token.slice(0, 2), token.slice(2, 4)].sort();
    siteCodes = ['LARGE', 'TIE', 'TOUCH', 'INVALID', 'DUP', 'SOFT'].map((prefix) => `${prefix}-${token.slice(4, 12)}`);
    const existing = await pool.query(
      'SELECT 1 FROM provinces WHERE code = ANY($1::varchar[]) UNION ALL SELECT 1 FROM sites WHERE code = ANY($2::text[])',
      [provinceCodes, siteCodes],
    );
    if (!existing.rowCount) break;
  } while (true);
  await pool.query(
    `INSERT INTO provinces (code, name_th, geom) VALUES
      ($1, 'West', ST_Multi(ST_GeomFromText('POLYGON((100 10,101 10,101 11,100 11,100 10))',4326))),
      ($2, 'East', ST_Multi(ST_GeomFromText('POLYGON((101 10,102 10,102 11,101 11,101 10))',4326)))`,
    provinceCodes,
  );
  await pool.query(
    `INSERT INTO sites (code,name,province_code,geom,area_rai,deleted_at)
     VALUES ($1,'Historical',$2,ST_Multi(ST_GeomFromText('POLYGON((100.1 10.1,100.2 10.1,100.2 10.2,100.1 10.2,100.1 10.1))',4326)),1,now())`,
    [siteCodes[5], provinceCodes[0]],
  );
  client = await pool.connect();
});

after(async () => {
  client?.release();
  if (pool) {
    await pool.query('DELETE FROM sites WHERE code = ANY($1::text[])', [siteCodes]);
    await pool.query('DELETE FROM provinces WHERE code = ANY($1::varchar[])', [provinceCodes]);
    await pool.end();
  }
});

integration('Site import validates PostGIS shapes, assigns largest positive geographic overlap, reserves codes, and is idempotent', async () => {
  const features = [
    site(siteCodes[0], polygon(100.25, 10.25, 101.6, 10.75)),
    site(siteCodes[1], { type: 'MultiPolygon', coordinates: [polygon(100.5, 10.25, 101.5, 10.75).coordinates] }),
    site(siteCodes[2], polygon(102, 10.2, 103, 10.8)),
    site(siteCodes[3], polygon(100.2, 10.2, 100.8, 10.8), 'Invalid bowtie'),
    site(siteCodes[4], polygon(100.2, 10.2, 100.8, 10.8)),
    site(siteCodes[4], polygon(100.4, 10.2, 100.9, 10.8), 'Later duplicate'),
    site(siteCodes[5], polygon(102.2, 10.2, 102.8, 10.8), 'Must not restore'),
  ];
  features[3] = site(siteCodes[3], {
    type: 'Polygon',
    coordinates: [[[100.2, 10.2], [100.8, 10.8], [100.2, 10.8], [100.8, 10.2], [100.2, 10.2]]],
  }, 'Invalid bowtie');
  const first = await importSiteFeatures(client!, features);
  assert.deepEqual(first.summary, { inserted: 3, skipped_existing: 1, rejected: 3 });
  assert.deepEqual(first.rejections.map(({ row, reason }) => [row, reason]), [
    [3, 'OUTSIDE_COVERAGE'], [4, 'INVALID_GEOMETRY'], [6, 'DUPLICATE_CODE'],
  ]);
  const inserted = await pool!.query<{
    code: string; name: string; province_code: string; geometrytype: string; srid: number;
    version: number; created_by: string | null; updated_by: string | null; deleted_at: Date | null;
    area_rai: string; expected_area: string;
  }>(
    `SELECT code,name,province_code,ST_GeometryType(geom) AS geometrytype,ST_SRID(geom) AS srid,
            version,created_by,updated_by,deleted_at,area_rai::text,
            ROUND((ST_Area(geom::geography)/1600)::numeric,2)::text AS expected_area
       FROM sites WHERE code = ANY($1::text[]) ORDER BY code`,
    [siteCodes],
  );
  assert.equal(inserted.rows.length, 4);
  const large = inserted.rows.find((row) => row.code === siteCodes[0])!;
  assert.equal(large.name, `Site ${siteCodes[0]}`);
  assert.equal(large.province_code, provinceCodes[0]);
  assert.equal(large.geometrytype, 'ST_MultiPolygon');
  assert.equal(large.srid, 4326);
  assert.equal(large.version, 1);
  assert.equal(large.created_by, null);
  assert.equal(large.updated_by, null);
  assert.equal(large.area_rai, large.expected_area);
  const tie = inserted.rows.find((row) => row.code === siteCodes[1])!;
  assert.equal(tie.province_code, provinceCodes[0]);
  assert.equal(inserted.rows.find((row) => row.code === siteCodes[4])?.name, `Site ${siteCodes[4]}`);
  assert.equal(inserted.rows.find((row) => row.code === siteCodes[5])?.name, 'Historical');
  assert.ok(inserted.rows.find((row) => row.code === siteCodes[5])?.deleted_at);

  const beforeRerun = await pool!.query(
    'SELECT code,name,province_code,area_rai,version,created_at,updated_at,deleted_at FROM sites WHERE code = ANY($1::text[]) ORDER BY code',
    [siteCodes],
  );
  const second = await importSiteFeatures(client!, features);
  assert.deepEqual(second.summary, { inserted: 0, skipped_existing: 4, rejected: 3 });
  const afterRerun = await pool!.query(
    'SELECT code,name,province_code,area_rai,version,created_at,updated_at,deleted_at FROM sites WHERE code = ANY($1::text[]) ORDER BY code', [siteCodes],
  );
  assert.deepEqual(afterRerun.rows, beforeRerun.rows);
});
