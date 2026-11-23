import { isRecord } from '../domain/guards';

export interface SpeciesRecord {
  code: string;
  nameTh: string;
  nameSci: string;
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


