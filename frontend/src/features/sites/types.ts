import type { SiteStatus } from "./status";

export interface SiteProperties {
  code: string;
  name: string;
  province_code: string;
  area_rai: number;
  version: number;
  siteStatus: SiteStatus;
}

export interface LatestSurveySummary {
  survey_ref: string | null;
  surveyed_on: string;
  cover_percent: number;
}

export interface SiteDetailProperties extends SiteProperties {
  latest_survey: LatestSurveySummary | null;
}

export interface SiteGeometry {
  type: "Polygon" | "MultiPolygon";
  coordinates: number[][][] | number[][][][];
}

export interface SiteFeature {
  type: "Feature";
  geometry: SiteGeometry;
  properties: SiteProperties;
}

export interface SiteDetailFeature {
  type: "Feature";
  geometry: SiteGeometry;
  properties: SiteDetailProperties;
}

export interface SiteFeatureCollection {
  type: "FeatureCollection";
  features: SiteFeature[];
}

export interface BboxBounds {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}
