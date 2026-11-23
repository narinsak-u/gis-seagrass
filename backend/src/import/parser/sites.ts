import { isRecord } from '../../shared';
export function parseSiteCollection(source: string): unknown[] {
  let collection: unknown;
  try {
    collection = JSON.parse(source);
  } catch {
    throw new Error('Invalid JSON in seagrass_sites.geojson');
  }
  if (!isRecord(collection) || collection.type !== 'FeatureCollection' || !Array.isArray(collection.features)) {
    throw new Error('seagrass_sites.geojson must be a GeoJSON FeatureCollection with a features array');
  }
  return collection.features;
}




