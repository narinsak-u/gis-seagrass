import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { PoolClient } from 'pg';
import { createPool } from '../database/pool';
import { importSpecies, parseSpeciesArray } from './species';

export interface ImportSummary {
  provinces: { inserted: number; skipped_existing: number; rejected: number };
  species: { inserted: number; skipped_existing: number; rejected: number };
}

export interface ProvinceRecord {
  code: string;
  nameTh: string;
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown };
}

export class ProvinceValidationError extends Error {}

export function parseProvinceCollection(source: string): unknown[] {
  let collection: unknown;
  try {
    collection = JSON.parse(source);
  } catch {
    throw new Error('Invalid JSON in provinces.geojson');
  }
  if (!isRecord(collection) || collection.type !== 'FeatureCollection' || !Array.isArray(collection.features)) {
    throw new Error('provinces.geojson must be a GeoJSON FeatureCollection with a features array');
  }
  return collection.features;
}

export function parseProvinceFeature(feature: unknown): ProvinceRecord {
  if (!isRecord(feature) || feature.type !== 'Feature' || !isRecord(feature.properties)) {
    throw new ProvinceValidationError('INVALID_FEATURE');
  }
  const { code, name_th: nameTh } = feature.properties;
  if (typeof code !== 'string' || !code.trim() || code.length > 2 || code.includes('\0')
    || typeof nameTh !== 'string' || !nameTh.trim() || nameTh.includes('\0')) {
    throw new ProvinceValidationError('INVALID_PROPERTIES');
  }
  const geometry = feature.geometry;
  if (!isRecord(geometry) || (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')) {
    throw new ProvinceValidationError('INVALID_GEOMETRY');
  }
  if (!validCoordinates(geometry.type, geometry.coordinates)) {
    throw new ProvinceValidationError('INVALID_COORDINATES');
  }
  return { code, nameTh, geometry: { type: geometry.type, coordinates: geometry.coordinates } };
}

function validCoordinates(type: 'Polygon' | 'MultiPolygon', coordinates: unknown): boolean {
  const polygons = type === 'Polygon' ? [coordinates] : coordinates;
  if (!Array.isArray(polygons) || polygons.length === 0) return false;
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || polygon.length === 0) return false;
    for (const ring of polygon) {
      if (!Array.isArray(ring) || ring.length < 4) return false;
      for (const position of ring) {
        if (!Array.isArray(position) || position.length !== 2) return false;
        const [longitude, latitude] = position;
        if (typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180
          || typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) return false;
      }
      const first = ring[0] as number[];
      const last = ring[ring.length - 1] as number[];
      if (first[0] !== last[0] || first[1] !== last[1]) return false;
    }
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function csv(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

async function replaceReport(path: string, rows: Array<[string, number, string]>): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true });
  const temporaryPath = resolve(directory, `.import_report.csv.tmp-${randomUUID()}`);
  const contents = [['file', 'row', 'reason'], ...rows].map((row) => row.map(csv).join(',')).join('\r\n') + '\r\n';
  try {
    await writeFile(temporaryPath, contents, { encoding: 'utf8', flag: 'wx' });
    await rename(temporaryPath, path);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

export async function runImport(): Promise<ImportSummary> {
  const inputPath = resolve(process.env.SEED_DATA_DIR ?? 'seed-data', 'provinces.geojson');
  const reportPath = resolve(process.env.IMPORT_REPORT_PATH ?? '../reports/import_report.csv');
  const features = parseProvinceCollection(await readFile(inputPath, 'utf8'));
  const pool = createPool();
  const summary: ImportSummary = {
    provinces: { inserted: 0, skipped_existing: 0, rejected: 0 },
    species: { inserted: 0, skipped_existing: 0, rejected: 0 },
  };
  const report: Array<[string, number, string]> = [];
  const seen = new Set<string>();
  let client: PoolClient | undefined;
  let locked = false;
  try {
    client = await pool.connect();
    await client.query('SELECT pg_advisory_lock($1)', [192837465]);
    locked = true;
    for (const [index, feature] of features.entries()) {
      let province: ProvinceRecord;
      try {
        province = parseProvinceFeature(feature);
      } catch (error) {
        const reason = error instanceof ProvinceValidationError ? error.message : 'INVALID_FEATURE';
        report.push(['provinces.geojson', index + 1, reason]);
        summary.provinces.rejected++;
        continue;
      }
      if (seen.has(province.code)) {
        report.push(['provinces.geojson', index + 1, 'DUPLICATE_CODE']);
        summary.provinces.rejected++;
        continue;
      }
      seen.add(province.code);
      const geometry = JSON.stringify(province.geometry);
      const validation = await client.query<{ valid: boolean; empty: boolean }>(
        `SELECT ST_IsValid(g.geom) AS valid, ST_IsEmpty(g.geom) AS empty
           FROM (SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) AS geom) AS g`,
        [geometry],
      );
      if (!validation.rows[0].valid || validation.rows[0].empty) {
        report.push(['provinces.geojson', index + 1, 'INVALID_GEOMETRY']);
        summary.provinces.rejected++;
        continue;
      }
      const result = await client.query(
        `INSERT INTO provinces (code, name_th, geom)
         VALUES ($1, $2, ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($3), 4326)))
         ON CONFLICT (code) DO NOTHING`,
        [province.code, province.nameTh, geometry],
      );
      if (result.rowCount) summary.provinces.inserted++;
      else summary.provinces.skipped_existing++;
    }
    const speciesPath = resolve(process.env.SEED_DATA_DIR ?? 'seed-data', 'species.json');
    const species = await importSpecies(client, parseSpeciesArray(await readFile(speciesPath, 'utf8')));
    summary.species = {
      inserted: species.inserted,
      skipped_existing: species.skipped_existing,
      rejected: species.rejected,
    };
    report.push(...species.rejections.map(({ row, reason }) => ['species.json', row, reason] as [string, number, string]));
    await replaceReport(reportPath, report);
    console.info('Import summary:', JSON.stringify(summary));
    return summary;
  } finally {
    if (client) {
      if (locked) await client.query('SELECT pg_advisory_unlock($1)', [192837465]).catch(() => undefined);
      client.release();
    }
    await pool.end();
  }
}

if (require.main === module) {
  void runImport().catch((error: unknown) => {
    console.error('Seed import failed:', error);
    process.exitCode = 1;
  });
}
