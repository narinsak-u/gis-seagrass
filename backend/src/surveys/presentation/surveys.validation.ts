import { BadRequestException } from '@nestjs/common';
import { isStrictCalendarDate } from '../domain/calendar-date';
import type { SurveyInput } from '../application/survey-write.repository';

const editableKeys = ['lon', 'lat', 'surveyed_on', 'cover_percent', 'species', 'note'];
const ID_MAX = 9223372036854775807n;


function invalid(): never {
  throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Invalid request', details: {} });
}

export function parseSurveyInput(body: unknown, create: boolean, rawBody?: Buffer): SurveyInput {
  if (rawBody) rejectRoundedCoverLiteral(rawBody);
  if (body === null || typeof body !== 'object' || Array.isArray(body)) invalid();
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some((key) => !editableKeys.includes(key)) || (!create && !editableKeys.some((key) => record[key] !== undefined))) invalid();
  const input: SurveyInput = {};
  if (create || record.lon !== undefined) {
    if (typeof record.lon !== 'number' || !Number.isFinite(record.lon) || record.lon < -180 || record.lon > 180) invalid();
    input.lon = record.lon;
  }
  if (create || record.lat !== undefined) {
    if (typeof record.lat !== 'number' || !Number.isFinite(record.lat) || record.lat < -90 || record.lat > 90) invalid();
    input.lat = record.lat;
  }
  if ((input.lon === undefined) !== (input.lat === undefined)) invalid();
  if (create || record.surveyed_on !== undefined) {
    if (typeof record.surveyed_on !== 'string' || !isStrictCalendarDate(record.surveyed_on)) invalid();
    input.surveyed_on = record.surveyed_on;
  }
  if (create || record.cover_percent !== undefined) {
    const value = record.cover_percent;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100 || Number(value.toFixed(2)) !== value) invalid();
    input.cover_percent = value;
  }
  if (create || record.species !== undefined) {
    if (!Array.isArray(record.species) || record.species.some((code) => typeof code !== 'string' || code.length === 0 || code.includes('\0'))) invalid();
    input.species = [...new Set(record.species as string[])];
  }
  if (record.note !== undefined) {
    if (record.note !== null && typeof record.note !== 'string') invalid();
    if (typeof record.note === 'string' && record.note.includes('\0')) invalid();
    input.note = record.note as string | null;
  } else if (create) input.note = null;
  return input;
}

function rejectRoundedCoverLiteral(rawBody: Buffer): void {
  type Context = { source: string };
  const parse = JSON.parse as (text: string, reviver: (key: string, value: unknown, context: Context) => unknown) => unknown;
  parse(rawBody.toString('utf8'), (key, value, context) => {
    if (key === 'cover_percent' && typeof value === 'number' && needsCoverRounding(context.source)) invalid();
    return value;
  });
}

function needsCoverRounding(source: string): boolean {
  const match = /^-?(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(source);
  if (!match) return false;
  const digits = match[1] + (match[2] ?? '');
  const discarded = (match[2]?.length ?? 0) - Number(match[3] ?? 0) - 2;
  return discarded > 0 && /[1-9]/.test(digits.slice(Math.max(0, digits.length - discarded)));
}

export function parseSurveyId(value: string): string {
  if (!/^[1-9]\d*$/.test(value) || value.length > 19 || BigInt(value) > ID_MAX) invalid();
  return value;
}


