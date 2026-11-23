import { parse } from 'csv-parse/sync';
import { isStrictCalendarDate } from '../domain/guards';
import { SurveyWriter } from '../surveys/survey-writer';
import type { SurveyInput } from '../surveys/survey-write.port';
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

export async function importSurveys(writer: SurveyWriter, records: ParsedSurvey[]): Promise<SurveyImportResult> {
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
    if (await writer.hasReference(ref)) { result.summary.skipped_existing++; continue; }
    const siteCode = values.site_code;
    const lon = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(values.lon.trim()) ? Number(values.lon) : NaN;
    const lat = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(values.lat.trim()) ? Number(values.lat) : NaN;
    if (!siteCode.trim() || siteCode.includes('\0') || !Number.isFinite(lon) || !Number.isFinite(lat) || lon < -180 || lon > 180 || lat < -90 || lat > 90) {
      reject(row, 'INVALID_COORDINATES'); continue;
    }
    const cover = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(values.cover_percent.trim()) ? Number(values.cover_percent) : NaN;
    if (!Number.isFinite(cover) || cover < 0 || cover > 100) { reject(row, 'INVALID_COVER'); continue; }
    const date = values.surveyed_on;
    if (!isStrictCalendarDate(date)) { reject(row, 'INVALID_DATE'); continue; }
    const species = values.species.split('|');
    if (species.some((code) => !code.trim() || code.includes('\0'))) { reject(row, 'UNKNOWN_SPECIES'); continue; }
    const input: SurveyInput = { lon, lat, surveyed_on: date, cover_percent: cover, species: [...new Set(species)] };
    const outcome = await writer.import(siteCode, ref, input);
    if (outcome === 'SKIPPED') result.summary.skipped_existing++;
    else if (outcome === 'INSERTED') result.summary.inserted++;
    else reject(row, outcome);
  }
  return result;
}
