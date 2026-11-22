import { BadRequestException } from '@nestjs/common';

const editableKeys = ['lon', 'lat', 'surveyed_on', 'cover_percent', 'species', 'note'];
const ID_MAX = 9223372036854775807n;

export interface SurveyInput {
  lon?: number;
  lat?: number;
  surveyed_on?: string;
  cover_percent?: number;
  species?: string[];
  note?: string | null;
}

function invalid(): never {
  throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Invalid request', details: {} });
}

export function parseSurveyInput(body: unknown, create: boolean): SurveyInput {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) invalid();
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some((key) => !editableKeys.includes(key)) || (!create && Object.keys(record).length === 0)) invalid();
  const input: SurveyInput = {};
  if (create ? typeof record.lon !== 'number' : record.lon !== undefined) {
    if (typeof record.lon !== 'number' || !Number.isFinite(record.lon) || record.lon < -180 || record.lon > 180) invalid();
    input.lon = record.lon;
  }
  if (create ? typeof record.lat !== 'number' : record.lat !== undefined) {
    if (typeof record.lat !== 'number' || !Number.isFinite(record.lat) || record.lat < -90 || record.lat > 90) invalid();
    input.lat = record.lat;
  }
  if ((input.lon === undefined) !== (input.lat === undefined)) invalid();
  if (create || record.surveyed_on !== undefined) {
    if (typeof record.surveyed_on !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(record.surveyed_on) || record.surveyed_on.startsWith('0000')) invalid();
    const date = new Date(`${record.surveyed_on}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== record.surveyed_on) invalid();
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
    input.note = record.note as string | null;
  } else if (create) input.note = null;
  return input;
}

export function parseSurveyId(value: string): string {
  if (!/^[1-9]\d*$/.test(value) || value.length > 19 || BigInt(value) > ID_MAX) invalid();
  return value;
}

export function parseSurveyPage(value: unknown, fallback: number, maximum = Number.MAX_SAFE_INTEGER): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) invalid();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) invalid();
  return parsed;
}

export function validateSurveyDateAgainstToday(date: string, today: string): void {
  if (date > today) invalid();
}
