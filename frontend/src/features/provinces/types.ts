import type { z } from "zod";
import type { provinceFeatureSchema, provinceFeatureCollectionSchema } from "./schema";

export type ProvinceFeature = z.infer<typeof provinceFeatureSchema>;
export type ProvinceFeatureCollection = z.infer<typeof provinceFeatureCollectionSchema>;
