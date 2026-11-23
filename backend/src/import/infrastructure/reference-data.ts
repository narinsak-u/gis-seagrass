import { sql } from 'drizzle-orm';
import { provinces, species as speciesTable } from '../../platform/database';
import type { DatabaseProvider } from '../../platform/database';
import { ProvinceValidationError, parseProvinceFeature, type ProvinceRecord } from '../domain/province';
import { parseSpeciesRecord, SpeciesValidationError, type SpeciesRecord } from '../domain/species';

export interface ReferenceImportResult {
  summary: { inserted: number; skipped_existing: number; rejected: number };
  rejections: Array<{ row: number; reason: string }>;
}

export async function importProvinces(db: DatabaseProvider['db'], features: unknown[]): Promise<ReferenceImportResult> {
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
    const validation = await db.execute<{ valid: boolean; empty: boolean }>(sql`
      SELECT ST_IsValid(g.geom) AS valid, ST_IsEmpty(g.geom) AS empty
        FROM (SELECT ST_SetSRID(ST_GeomFromGeoJSON(${geometry}), 4326) AS geom) AS g
    `);
    if (!validation.rows[0].valid || validation.rows[0].empty) {
      reject(result, index + 1, 'INVALID_GEOMETRY');
      continue;
    }
    seen.add(province.code);
    const inserted = await db.insert(provinces).values({
      code: province.code,
      nameTh: province.nameTh,
      geom: sql`ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${geometry}), 4326))`,
    }).onConflictDoNothing({ target: provinces.code }).returning({ code: provinces.code });
    if (inserted.length) result.summary.inserted++;
    else result.summary.skipped_existing++;
  }
  return result;
}

export async function importSpecies(db: DatabaseProvider['db'], records: unknown[]): Promise<ReferenceImportResult> {
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
    const inserted = await db.insert(speciesTable).values({
      code: species.code,
      nameTh: species.nameTh,
      nameSci: species.nameSci,
    }).onConflictDoNothing({ target: speciesTable.code }).returning({ code: speciesTable.code });
    if (inserted.length) result.summary.inserted++;
    else result.summary.skipped_existing++;
  }
  return result;
}

function reject(result: ReferenceImportResult, row: number, reason: string): void {
  result.summary.rejected++;
  result.rejections.push({ row, reason });
}
