import type { z } from "zod";
import type {
  siteDetailSchema,
  siteFeatureSchema,
  siteFeatureCollectionSchema,
} from "./schema";

export type SiteProperties = z.infer<typeof siteFeatureSchema>["properties"];
export type SiteFeature = z.infer<typeof siteFeatureSchema>;
export type SiteFeatureCollection = z.infer<typeof siteFeatureCollectionSchema>;
export type SiteDetailFeature = z.infer<typeof siteDetailSchema>;
export type SiteDetailProperties = SiteDetailFeature["properties"];
export type LatestSurveySummary = NonNullable<SiteDetailProperties["latest_survey"]>;
export type SiteGeometry = SiteFeature["geometry"];


export interface BboxBounds {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}
