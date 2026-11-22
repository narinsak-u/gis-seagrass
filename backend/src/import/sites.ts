import type { PoolClient } from 'pg';

export interface SiteRecord {
  code: string;
  name: string;
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown };
}

export interface SiteImportResult {
  summary: { inserted: number; skipped_existing: number; rejected: number };
  rejections: Array<{ row: number; reason: string }>;
}

export class SiteValidationError extends Error {}

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

function validCoordinates(type: 'Polygon' | 'MultiPolygon', coordinates: unknown): boolean {
  const polygons = type === 'Polygon' ? [coordinates] : coordinates;
  if (!Array.isArray(polygons) || polygons.length === 0) return false;
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || polygon.length === 0) return false;
    for (const ring of polygon) {
      if (!Array.isArray(ring) || ring.length < 4) return false;
      for (const position of ring) {
        if (!Array.isArray(position) || position.length !== 2) return false;
        const [longitude, latitude] = position;
        if (typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180
          || typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) return false;
      }
      const first = ring[0] as number[];
      const last = ring[ring.length - 1] as number[];
      if (first[0] !== last[0] || first[1] !== last[1]) return false;
    }
  }
  return true;
}

export async function importSiteFeatures(client: PoolClient, features: unknown[]): Promise<SiteImportResult> {
  const result: SiteImportResult = {
    summary: { inserted: 0, skipped_existing: 0, rejected: 0 },
    rejections: [],
  };
  const seen = new Set<string>();
  for (const [index, feature] of features.entries()) {
    let site: SiteRecord;
    try {
      site = parseSiteFeature(feature);
    } catch (error) {
      reject(result, index + 1, error instanceof SiteValidationError ? error.message : 'INVALID_FEATURE');
      continue;
    }
    if (seen.has(site.code)) {
      reject(result, index + 1, 'DUPLICATE_CODE');
      continue;
    }

    const geometry = JSON.stringify(site.geometry);
    const checked = await client.query<{ valid: boolean; reason: string; empty: boolean }>(
      `SELECT ST_IsValid(g.geom) AS valid, ST_IsValidReason(g.geom) AS reason, ST_IsEmpty(g.geom) AS empty
         FROM (SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) AS geom) AS g`,
      [geometry],
    );
    const validation = checked.rows[0];
    if (!validation?.valid || validation.empty) {
      reject(result, index + 1, 'INVALID_GEOMETRY');
      continue;
    }
    const province = await client.query<{ code: string }>(
      `WITH site AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) AS geom),
       overlaps AS (
         SELECT p.code, ST_Area(ST_Intersection(s.geom, p.geom)::geography) AS area
           FROM provinces AS p CROSS JOIN site AS s
          WHERE ST_Intersects(s.geom, p.geom)
       )
       SELECT code FROM overlaps
        WHERE area > 0
        ORDER BY area DESC, code ASC
        LIMIT 1`,
      [geometry],
    );
    if (!province.rowCount) {
      reject(result, index + 1, 'OUTSIDE_COVERAGE');
      continue;
    }

    seen.add(site.code);
    const existing = await client.query('SELECT 1 FROM sites WHERE code = $1 LIMIT 1', [site.code]);
    if (existing.rowCount) {
      result.summary.skipped_existing++;
      continue;
    }
    const inserted = await client.query(
      `WITH source AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON($4), 4326) AS geom)
       INSERT INTO sites (code, name, province_code, geom, area_rai, version, created_by, updated_by)
       SELECT $1, $2, $3, ST_Multi(source.geom),
              ROUND((ST_Area(source.geom::geography) / 1600)::numeric, 2), 1, NULL, NULL
         FROM source
       ON CONFLICT DO NOTHING`,
      [site.code, site.name, province.rows[0].code, geometry],
    );
    if (inserted.rowCount) result.summary.inserted++;
    else result.summary.skipped_existing++;
  }
  return result;
}

function reject(result: SiteImportResult, row: number, reason: string): void {
  result.rejections.push({ row, reason });
  result.summary.rejected++;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
