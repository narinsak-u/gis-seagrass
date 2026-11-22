import { isRecord } from './guards';
import { validCoordinates } from './geometry';

export interface ProvinceRecord {
  code: string;
  nameTh: string;
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown };
}

export class ProvinceValidationError extends Error {}

export function parseProvinceCollection(source: string): unknown[] {
  let collection: unknown;
  try {
    collection = JSON.parse(source);
  } catch {
    throw new Error('Invalid JSON in provinces.geojson');
  }
  if (!isRecord(collection) || collection.type !== 'FeatureCollection' || !Array.isArray(collection.features)) {
    throw new Error('provinces.geojson must be a GeoJSON FeatureCollection with a features array');
  }
  return collection.features;
}

export function parseProvinceFeature(feature: unknown): ProvinceRecord {
  if (!isRecord(feature) || feature.type !== 'Feature' || !isRecord(feature.properties)) {
    throw new ProvinceValidationError('INVALID_FEATURE');
  }
  const { code, name_th: nameTh } = feature.properties;
  if (typeof code !== 'string' || !code.trim() || code.length > 2 || code.includes('\0')
    || typeof nameTh !== 'string' || !nameTh.trim() || nameTh.includes('\0')) {
    throw new ProvinceValidationError('INVALID_PROPERTIES');
  }
  const geometry = feature.geometry;
  if (!isRecord(geometry) || (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')) {
    throw new ProvinceValidationError('INVALID_GEOMETRY');
  }
  if (!validCoordinates(geometry.type, geometry.coordinates)) {
    throw new ProvinceValidationError('INVALID_COORDINATES');
  }
  return { code, nameTh, geometry: { type: geometry.type, coordinates: geometry.coordinates } };
}

