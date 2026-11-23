import { isRecord, validCoordinates } from '../../shared';

export interface SiteRecord {
  code: string;
  name: string;
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown };
}

export class SiteValidationError extends Error {}

export function parseSiteFeature(feature: unknown): SiteRecord {
  if (!isRecord(feature) || feature.type !== 'Feature' || !isRecord(feature.properties)) {
    throw new SiteValidationError('INVALID_FEATURE');
  }
  const { code, name } = feature.properties;
  if (typeof code !== 'string' || !code.trim() || code.includes('\0')
    || typeof name !== 'string' || !name.trim() || name.includes('\0')) {
    throw new SiteValidationError('INVALID_PROPERTIES');
  }
  const geometry = feature.geometry;
  if (!isRecord(geometry) || (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')) {
    throw new SiteValidationError('INVALID_GEOMETRY');
  }
  if (!validCoordinates(geometry.type, geometry.coordinates)) {
    throw new SiteValidationError('INVALID_COORDINATES');
  }
  return { code, name, geometry: { type: geometry.type, coordinates: geometry.coordinates } };
}
