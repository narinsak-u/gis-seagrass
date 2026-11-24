import { apiRequest, ApiClientError } from "@/src/lib/api";
import { provinceFeatureCollectionSchema } from "./schema";
import type { ProvinceFeatureCollection } from "./types";

export interface FetchProvincesParams {
  bbox: string;
  signal?: AbortSignal;
}

export async function fetchProvincesGeoJson({
  bbox,
  signal,
}: FetchProvincesParams): Promise<ProvinceFeatureCollection> {
  const payload = await apiRequest<unknown>("/provinces.geojson", {
    params: { bbox },
    signal,
  });
  const result = provinceFeatureCollectionSchema.safeParse(payload);
  if (!result.success) {
    throw new ApiClientError(
      0,
      "INVALID_API_RESPONSE",
      "The API returned an invalid Province GeoJSON response",
    );
  }
  return result.data;
}
