import { z } from "zod";
import { SITE_STATUS_VALUES } from "./status";

const positionSchema = z.tuple([z.number().finite(), z.number().finite()]);
const ringSchema = z.array(positionSchema).min(1);
const polygonSchema = z.array(ringSchema).min(1);
const geometrySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("Polygon"), coordinates: polygonSchema }),
  z.object({ type: z.literal("MultiPolygon"), coordinates: z.array(polygonSchema).min(1) }),
]);

export const siteFeatureSchema = z.object({
  type: z.literal("Feature"),
  geometry: geometrySchema,
  properties: z.object({
    code: z.string().min(1),
    name: z.string().min(1),
    province_code: z.string().min(1),
    area_rai: z.number().finite(),
    version: z.number().int().finite(),
    siteStatus: z.enum(SITE_STATUS_VALUES),
  }),
});

export const siteFeatureCollectionSchema = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(siteFeatureSchema),
});

export const siteDetailSchema = z.object({
  type: z.literal("Feature"),
  geometry: geometrySchema,
  properties: z.object({
    code: z.string().min(1),
    name: z.string().min(1),
    province_code: z.string().min(1),
    area_rai: z.number().finite(),
    version: z.number().int().finite(),
    siteStatus: z.enum(SITE_STATUS_VALUES),
    latest_survey: z.object({
      survey_ref: z.string().nullable(),
      surveyed_on: z.string().min(1),
      cover_percent: z.number().finite(),
    }).nullable(),
  }),
});
