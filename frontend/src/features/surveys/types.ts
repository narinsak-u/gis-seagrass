import type { ActorRole } from "@/src/features/auth/auth-session";

export const AUTHORIZED_SURVEY_ROLES = [
  "viewer",
  "editor",
  "admin",
] as const satisfies readonly ActorRole[];

export const DEFAULT_SURVEY_PAGE_SIZE = 10;

export interface SurveyListItem {
  id: string;
  lon: number;
  lat: number;
  surveyed_on: string;
  cover_percent: number;
  species: string[];
  note: string | null;
  created_by: string | null;
  survey_ref?: string | null;
}

export interface SurveyPageResponse {
  items: SurveyListItem[];
  total: number;
  page: number;
}
export type SurveyHistoryStatus =
  | "idle"
  | "unauthenticated"
  | "unauthorized_role"
  | "loading"
  | "loading_more"
  | "ready"
  | "empty"
  | "forbidden"
  | "error";

export interface SurveyHistoryError {
  code: string;
  message: string;
  status?: number;
}

export interface SurveyHistoryState {
  status: SurveyHistoryStatus;
  siteCode: string | null;
  items: SurveyListItem[];
  points: SurveyPointFeatureCollection;
  total: number;
  loadedPages: number;
  pageSize: number;
  hasMore: boolean;
  isPartialCoverage: boolean;
  error: SurveyHistoryError | null;
}

export interface SurveyPointProperties {
  id: string;
  siteCode: string;
  surveyed_on: string;
  cover_percent: number;
  species: string;
  note: string | null;
  created_by: string | null;
  survey_ref: string | null;
}

export interface SurveyPointFeature {
  type: "Feature";
  id: string;
  geometry: {
    type: "Point";
    coordinates: [number, number];
  };
  properties: SurveyPointProperties;
}

export interface SurveyPointFeatureCollection {
  type: "FeatureCollection";
  features: SurveyPointFeature[];
}

export const EMPTY_SURVEY_POINT_COLLECTION: SurveyPointFeatureCollection = {
  type: "FeatureCollection",
  features: [],
};
export const INITIAL_SURVEY_HISTORY_STATE: SurveyHistoryState = {
  status: "idle",
  siteCode: null,
  items: [],
  points: EMPTY_SURVEY_POINT_COLLECTION,
  total: 0,
  loadedPages: 0,
  pageSize: DEFAULT_SURVEY_PAGE_SIZE,
  hasMore: false,
  isPartialCoverage: false,
  error: null,
};

export function isAuthorizedSurveyRole(role: unknown): role is ActorRole {
  return (
    typeof role === "string" &&
    (AUTHORIZED_SURVEY_ROLES as readonly string[]).includes(role)
  );
}

function isValidCoordinate(lon: number, lat: number): boolean {
  return (
    Number.isFinite(lon) &&
    Number.isFinite(lat) &&
    lon >= -180 &&
    lon <= 180 &&
    lat >= -90 &&
    lat <= 90
  );
}

export function buildSurveyPointCollection(
  siteCode: string | null,
  items: readonly SurveyListItem[],
): SurveyPointFeatureCollection {
  if (!siteCode || items.length === 0) {
    return EMPTY_SURVEY_POINT_COLLECTION;
  }

  const features: SurveyPointFeature[] = [];
  for (const item of items) {
    if (!isValidCoordinate(item.lon, item.lat)) {
      continue;
    }
    features.push({
      type: "Feature",
      id: item.id,
      geometry: {
        type: "Point",
        coordinates: [item.lon, item.lat],
      },
      properties: {
        id: item.id,
        siteCode,
        surveyed_on: item.surveyed_on,
        cover_percent: item.cover_percent,
        species: Array.isArray(item.species) ? item.species.join(", ") : "",
        note: item.note ?? null,
        created_by: item.created_by ?? null,
        survey_ref: item.survey_ref ?? null,
      },
    });
  }

  return {
    type: "FeatureCollection",
    features,
  };
}
export function mergeSurveyHistoryItems(
  pages: readonly (readonly SurveyListItem[])[],
): SurveyListItem[] {
  const seen = new Set<string>();
  const items: SurveyListItem[] = [];
  for (const page of pages) {
    for (const item of page) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
    }
  }
  return items;
}
