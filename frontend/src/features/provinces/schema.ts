import { z } from "zod";
import { geometrySchema } from "../shared/geometry-schema";

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
