import { apiRequest, ApiClientError } from "@/src/lib/api";
import { siteDetailSchema, siteFeatureCollectionSchema } from "./schema";
import type { SiteDetailFeature, SiteFeatureCollection } from "./types";

export interface FetchActiveSitesParams {
  bbox: string;
  province?: string;
  signal?: AbortSignal;
}

export async function fetchActiveSitesGeoJson({
  bbox,
  province,
  signal,
}: FetchActiveSitesParams): Promise<SiteFeatureCollection> {
  const payload = await apiRequest<unknown>("/sites.geojson", {
    params: {
      bbox,
      ...(province?.trim() ? { province: province.trim() } : {}),
      status: "active",
    },
    signal,
  });
  const result = siteFeatureCollectionSchema.safeParse(payload);
  if (!result.success) {
    throw new ApiClientError(
      0,
      "INVALID_API_RESPONSE",
      "The API returned an invalid Site GeoJSON response",
    );
  }
  return result.data;
}

export interface FetchSiteDetailParams {
  code: string;
  signal?: AbortSignal;
}

export async function fetchSiteDetail({
  code,
  signal,
}: FetchSiteDetailParams): Promise<SiteDetailFeature> {
  const payload = await apiRequest<unknown>(`/sites/${encodeURIComponent(code)}`, { signal });
  const result = siteDetailSchema.safeParse(payload);
  if (!result.success) {
    throw new ApiClientError(
      0,
      "INVALID_API_RESPONSE",
      "The API returned an invalid Site detail response",
    );
  }
  return result.data;
}
