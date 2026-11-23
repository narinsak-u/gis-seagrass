import { isRecord } from '../domain/guards';
import { SiteSurveyCoordinator } from '../site-survey/site-survey.coordinator';
import { parseSiteFeature, SiteValidationError } from '../sites/site-feature';

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

export async function importSiteFeatures(coordinator: SiteSurveyCoordinator, features: unknown[]): Promise<SiteImportResult> {
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
    if (code && await coordinator.hasSiteCode(code)) {
      seen.add(code);
      result.summary.skipped_existing++;
      continue;
    }
    let site;
    try {
      site = parseSiteFeature(feature);
    } catch (error) {
      reject(result, index + 1, error instanceof SiteValidationError ? error.message : 'INVALID_FEATURE');
      continue;
    }
    if (code) seen.add(code);
    const outcome = await coordinator.importSite(site);
    if (outcome === 'INSERTED') result.summary.inserted++;
    else if (outcome === 'SKIPPED') result.summary.skipped_existing++;
    else {
      reject(result, index + 1, outcome);
    }
  }
  return result;
}

function reject(result: SiteImportResult, row: number, reason: string): void {
  result.rejections.push({ row, reason });
  result.summary.rejected++;
}

