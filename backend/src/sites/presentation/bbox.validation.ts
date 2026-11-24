import { BadRequestException } from '@nestjs/common';

export type BboxTuple = [number, number, number, number];

export function parseBbox(value: unknown): BboxTuple | undefined {
  if (typeof value !== 'string') return undefined;
  const parts = value.split(',');
  if (parts.length !== 4 || parts.some((part) => part.trim() === '')) return undefined;
  const bounds = parts.map(Number);
  const [minLon, minLat, maxLon, maxLat] = bounds;
  if (!bounds.every(Number.isFinite)
    || minLon < -180 || maxLon > 180 || minLat < -90 || maxLat > 90
    || minLon >= maxLon || minLat >= maxLat) return undefined;
  return [minLon, minLat, maxLon, maxLat];
}

export function requireValidBbox(value: unknown): BboxTuple {
  const bbox = parseBbox(value);
  if (!bbox) {
    throw new BadRequestException({ code: 'INVALID_BBOX', message: 'Invalid bbox', details: {} });
  }
  return bbox;
}
