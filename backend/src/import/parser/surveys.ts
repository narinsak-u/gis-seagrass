import { parse } from 'csv-parse/sync';
import { isStrictCalendarDate } from '../../surveys';
const columns = ['survey_ref', 'site_code', 'lon', 'lat', 'surveyed_on', 'cover_percent', 'species'] as const;

type SurveyRow = Record<(typeof columns)[number], string>;
export interface ParsedSurvey { row: number; values: SurveyRow }

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

