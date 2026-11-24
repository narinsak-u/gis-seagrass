import type { SiteStatus } from "./status";

export interface SiteProperties {
  code: string;
  name: string;
  province_code: string;
  area_rai: number;
  version: number;
  siteStatus: SiteStatus;
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
