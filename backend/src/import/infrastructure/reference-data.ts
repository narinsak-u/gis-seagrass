import type { PoolClient } from 'pg';
import { ProvinceValidationError, parseProvinceFeature, type ProvinceRecord } from '../province';
import { parseSpeciesRecord, SpeciesValidationError, type SpeciesRecord } from '../species';

export interface ReferenceImportResult {
  summary: { inserted: number; skipped_existing: number; rejected: number };
  rejections: Array<{ row: number; reason: string }>;
}

export async function importProvinces(client: PoolClient, features: unknown[]): Promise<ReferenceImportResult> {
  const result: ReferenceImportResult = {
    summary: { inserted: 0, skipped_existing: 0, rejected: 0 },
    rejections: [],
  };
  const seen = new Set<string>();

  for (const [index, feature] of features.entries()) {
    let province: ProvinceRecord;
    try {
      province = parseProvinceFeature(feature);
    } catch (error) {
      reject(result, index + 1, error instanceof ProvinceValidationError ? error.message : 'INVALID_FEATURE');
      continue;
    }
    if (seen.has(province.code)) {
      reject(result, index + 1, 'DUPLICATE_CODE');
      continue;
    }
    const geometry = JSON.stringify(province.geometry);
    const validation = await client.query<{ valid: boolean; empty: boolean }>(
      `SELECT ST_IsValid(g.geom) AS valid, ST_IsEmpty(g.geom) AS empty
         FROM (SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) AS geom) AS g`,
      [geometry],
    );
    if (!validation.rows[0].valid || validation.rows[0].empty) {
      reject(result, index + 1, 'INVALID_GEOMETRY');
      continue;
    }
    seen.add(province.code);
    const inserted = await client.query(
      `INSERT INTO provinces (code, name_th, geom)
       VALUES ($1, $2, ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($3), 4326)))
       ON CONFLICT (code) DO NOTHING`,
      [province.code, province.nameTh, geometry],
    );
    if (inserted.rowCount) result.summary.inserted++;
    else result.summary.skipped_existing++;
  }
  return result;
}

export async function importSpecies(client: PoolClient, records: unknown[]): Promise<ReferenceImportResult> {
  const result: ReferenceImportResult = {
    summary: { inserted: 0, skipped_existing: 0, rejected: 0 },
    rejections: [],
  };
  const seen = new Set<string>();

  for (const [index, value] of records.entries()) {
    let species: SpeciesRecord;
    try {
      species = parseSpeciesRecord(value);
    } catch (error) {
      reject(result, index + 1, error instanceof SpeciesValidationError ? error.message : 'INVALID_PROPERTIES');
      continue;
    }
    if (seen.has(species.code)) {
      reject(result, index + 1, 'DUPLICATE_CODE');
      continue;
    }
    seen.add(species.code);
    const inserted = await client.query(
      'INSERT INTO species (code, name_th, name_sci) VALUES ($1, $2, $3) ON CONFLICT (code) DO NOTHING',
      [species.code, species.nameTh, species.nameSci],
    );
    if (inserted.rowCount) result.summary.inserted++;
    else result.summary.skipped_existing++;
  }
  return result;
}

function reject(result: ReferenceImportResult, row: number, reason: string): void {
  result.summary.rejected++;
  result.rejections.push({ row, reason });
}
