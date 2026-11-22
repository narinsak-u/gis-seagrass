import { parse } from 'csv-parse/sync';
import type { PoolClient } from 'pg';

const columns = ['survey_ref', 'site_code', 'lon', 'lat', 'surveyed_on', 'cover_percent', 'species'] as const;

type SurveyRow = Record<(typeof columns)[number], string>;
export interface ParsedSurvey { row: number; values: SurveyRow }
export interface SurveyImportResult {
  summary: { inserted: number; skipped_existing: number; rejected: number };
  rejections: Array<{ row: number; reason: string }>;
}

export function parseSurveysCsv(source: string): ParsedSurvey[] {
  let records: Array<{ record: string[]; info: { lines: number } }>;
  try {
    records = parse(source, { bom: true, info: true, skip_empty_lines: true, trim: false });
  } catch {
    throw new Error('Invalid CSV in surveys.csv');
  }
  const headers = records.shift()?.record;
  if (!headers || columns.some((column) => !headers.includes(column)) || new Set(headers).size !== headers.length
    || records.some(({ record }) => record.length !== headers.length)) {
    throw new Error('surveys.csv is missing required headers or has malformed records');
  }
  return records.map(({ record, info }) => ({
    row: info.lines,
    values: Object.fromEntries(columns.map((column) => [column, record[headers.indexOf(column)] ?? ''])) as SurveyRow,
  }));
}

export async function importSurveys(client: PoolClient, records: ParsedSurvey[]): Promise<SurveyImportResult> {
  const result: SurveyImportResult = { summary: { inserted: 0, skipped_existing: 0, rejected: 0 }, rejections: [] };
  const seen = new Set<string>();
  const reject = (row: number, reason: string) => {
    result.summary.rejected++;
    result.rejections.push({ row, reason });
  };

  for (const { row, values } of records) {
    const ref = values.survey_ref;
    if (!ref.trim() || ref.includes('\0')) { reject(row, 'INVALID_SURVEY_REF'); continue; }
    if (seen.has(ref)) { reject(row, 'DUPLICATE_SURVEY_REF'); continue; }
    seen.add(ref);
    const existing = await client.query('SELECT 1 FROM surveys WHERE survey_ref = $1', [ref]);
    if (existing.rowCount) { result.summary.skipped_existing++; continue; }
    const siteCode = values.site_code;
    const lon = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(values.lon.trim()) ? Number(values.lon) : NaN;
    const lat = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(values.lat.trim()) ? Number(values.lat) : NaN;
    if (!siteCode.trim() || siteCode.includes('\0') || !Number.isFinite(lon) || !Number.isFinite(lat) || lon < -180 || lon > 180 || lat < -90 || lat > 90) {
      reject(row, 'INVALID_COORDINATES'); continue;
    }
    const cover = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(values.cover_percent.trim()) ? Number(values.cover_percent) : NaN;
    if (!Number.isFinite(cover) || cover < 0 || cover > 100) { reject(row, 'INVALID_COVER'); continue; }
    const date = values.surveyed_on;
    const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && !date.startsWith('0000') ? new Date(`${date}T00:00:00.000Z`) : null;
    if (!parsedDate || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) { reject(row, 'INVALID_DATE'); continue; }

    const speciesCodes = values.species.split('|');
    if (speciesCodes.some((code) => !code.trim() || code.includes('\0'))) { reject(row, 'UNKNOWN_SPECIES'); continue; }
    const foundSpecies = await client.query<{ code: string }>('SELECT code FROM species WHERE code = ANY($1::text[])', [speciesCodes]);
    if (foundSpecies.rowCount !== new Set(speciesCodes).size) { reject(row, 'UNKNOWN_SPECIES'); continue; }

    const site = await client.query<{ id: string; within: boolean }>(
      `SELECT id,
              ST_DWithin(ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, geom::geography, 50) AS within
         FROM sites WHERE code = $1 AND deleted_at IS NULL`,
      [siteCode, lon, lat],
    );
    if (!site.rowCount) { reject(row, 'SITE_NOT_FOUND'); continue; }
    if (!site.rows[0].within) { reject(row, 'OUTSIDE_SITE'); continue; }
    const today = await client.query<{ today: string }>("SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok')::date::text AS today");
    if (date > today.rows[0].today) { reject(row, 'FUTURE_DATE'); continue; }

    await client.query('BEGIN');
    try {
      const survey = await client.query<{ id: string }>(
        `INSERT INTO surveys (site_id, survey_ref, geom, surveyed_on, cover_percent)
         VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), $5, $6)
         ON CONFLICT (survey_ref) WHERE survey_ref IS NOT NULL DO NOTHING RETURNING id`,
        [site.rows[0].id, ref, lon, lat, date, cover],
      );
      if (!survey.rowCount) {
        await client.query('ROLLBACK');
        result.summary.skipped_existing++;
        continue;
      }
      for (const code of new Set(speciesCodes)) {
        await client.query('INSERT INTO survey_species (survey_id, species_code) VALUES ($1, $2)', [survey.rows[0].id, code]);
      }
      await client.query('COMMIT');
      result.summary.inserted++;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
  return result;
}
