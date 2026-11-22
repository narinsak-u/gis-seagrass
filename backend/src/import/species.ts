import type { PoolClient } from 'pg';

export interface SpeciesRecord {
  code: string;
  nameTh: string;
  nameSci: string;
}

export interface SpeciesRejection {
  row: number;
  reason: string;
}

export interface SpeciesImportResult {
  inserted: number;
  skipped_existing: number;
  rejected: number;
  rejections: SpeciesRejection[];
}

export class SpeciesValidationError extends Error {}

export function parseSpeciesArray(source: string): unknown[] {
  let records: unknown;
  try {
    records = JSON.parse(source);
  } catch {
    throw new Error('Invalid JSON in species.json');
  }
  if (!Array.isArray(records)) throw new Error('species.json must contain an array');
  return records;
}

export function parseSpeciesRecord(value: unknown): SpeciesRecord {
  if (!isRecord(value)) throw new SpeciesValidationError('INVALID_PROPERTIES');
  const { code, name_th: nameTh, name_sci: nameSci } = value;
  if (typeof code !== 'string' || !code.trim() || code.includes('\0')
    || typeof nameTh !== 'string' || !nameTh.trim() || nameTh.includes('\0')
    || typeof nameSci !== 'string' || !nameSci.trim() || nameSci.includes('\0')) {
    throw new SpeciesValidationError('INVALID_PROPERTIES');
  }
  return { code, nameTh, nameSci };
}

export async function importSpecies(client: PoolClient, records: unknown[]): Promise<SpeciesImportResult> {
  const result: SpeciesImportResult = { inserted: 0, skipped_existing: 0, rejected: 0, rejections: [] };
  const seen = new Set<string>();
  for (const [index, value] of records.entries()) {
    let species: SpeciesRecord;
    try {
      species = parseSpeciesRecord(value);
    } catch (error) {
      result.rejections.push({ row: index + 1, reason: error instanceof SpeciesValidationError ? error.message : 'INVALID_PROPERTIES' });
      result.rejected++;
      continue;
    }
    if (seen.has(species.code)) {
      result.rejections.push({ row: index + 1, reason: 'DUPLICATE_CODE' });
      result.rejected++;
      continue;
    }
    seen.add(species.code);
    const inserted = await client.query(
      'INSERT INTO species (code, name_th, name_sci) VALUES ($1, $2, $3) ON CONFLICT (code) DO NOTHING',
      [species.code, species.nameTh, species.nameSci],
    );
    if (inserted.rowCount) result.inserted++;
    else result.skipped_existing++;
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
