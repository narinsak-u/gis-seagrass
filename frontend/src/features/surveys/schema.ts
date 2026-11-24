import { z } from "zod";

const surveyItemSchema = z.object({
  id: z.string().min(1),
  lon: z.number().finite().min(-180).max(180),
  lat: z.number().finite().min(-90).max(90),
  surveyed_on: z.string().min(1),
  cover_percent: z.number().finite().min(0).max(100),
  species: z.array(z.string()),
  note: z.string().nullable(),
  created_by: z.string().nullable(),
  survey_ref: z.string().nullable().optional(),
});

export const surveyPageSchema = z.object({
  items: z.array(surveyItemSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
