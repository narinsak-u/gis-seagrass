import { z } from "zod";

const positionSchema = z.tuple([z.number().finite(), z.number().finite()]);
const ringSchema = z.array(positionSchema).min(1);
const polygonSchema = z.array(ringSchema).min(1);

export const geometrySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("Polygon"), coordinates: polygonSchema }),
  z.object({ type: z.literal("MultiPolygon"), coordinates: z.array(polygonSchema).min(1) }),
]);
