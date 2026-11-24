import { z } from "zod";

const positionSchema = z.tuple([z.number().finite(), z.number().finite()]);
const ringSchema = z.array(positionSchema).min(1);
const polygonSchema = z.array(ringSchema).min(1);
const geometrySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("Polygon"), coordinates: polygonSchema }),
  z.object({ type: z.literal("MultiPolygon"), coordinates: z.array(polygonSchema).min(1) }),
]);

export const provinceFeatureSchema = z.object({
  type: z.literal("Feature"),
  geometry: geometrySchema,
  properties: z.object({
    code: z.string().min(1),
    name_th: z.string().min(1),
  }),
});

export const provinceFeatureCollectionSchema = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(provinceFeatureSchema),
});
