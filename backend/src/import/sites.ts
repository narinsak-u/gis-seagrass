import { isRecord } from '../domain/guards';
import type { PoolClient } from 'pg';
import { parseSiteFeature, SiteValidationError, type SiteRecord } from '../sites/site-feature';


export interface SiteImportResult {
  summary: { inserted: number; skipped_existing: number; rejected: number };
  rejections: Array<{ row: number; reason: string }>;
}


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



function sourceSiteCode(feature: unknown): string | undefined {
  if (!isRecord(feature) || !isRecord(feature.properties)) return undefined;
  const code = feature.properties.code;
  return typeof code === 'string' && code.trim() && !code.includes('\0') ? code : undefined;
}

export async function importSiteFeatures(client: PoolClient, features: unknown[]): Promise<SiteImportResult> {
  const result: SiteImportResult = {
    summary: { inserted: 0, skipped_existing: 0, rejected: 0 },
    rejections: [],
  };
  const seen = new Set<string>();
  for (const [index, feature] of features.entries()) {
    const code = sourceSiteCode(feature);
    if (code && seen.has(code)) {
      reject(result, index + 1, 'DUPLICATE_CODE');
      continue;
    }
    if (code) {
      const existing = await client.query('SELECT 1 FROM sites WHERE code = $1 LIMIT 1', [code]);
      if (existing.rowCount) {
        seen.add(code);
        result.summary.skipped_existing++;
        continue;
      }
    }

    let site: SiteRecord;
    try {
      site = parseSiteFeature(feature);
    } catch (error) {
      reject(result, index + 1, error instanceof SiteValidationError ? error.message : 'INVALID_FEATURE');
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
    seen.add(site.code);
    const province = await client.query<{ code: string }>(
      `WITH site AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) AS geom),
       province_areas AS (
         SELECT p.code, ST_Area(ST_Intersection(s.geom, p.geom)::geography) AS area
           FROM provinces AS p CROSS JOIN site AS s
          WHERE ST_Intersects(s.geom, p.geom)
       )
       SELECT code FROM province_areas
        WHERE area > 0
        ORDER BY area DESC, code ASC
        LIMIT 1`,
      [geometry],
    );
    if (!province.rowCount) {
      reject(result, index + 1, 'OUTSIDE_COVERAGE');
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

