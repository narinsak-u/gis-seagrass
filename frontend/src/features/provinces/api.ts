import { apiFetch } from "@/src/lib/api";
import type { ProvinceFeatureCollection } from "./types";

export interface FetchProvincesParams {
  bbox: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

export async function fetchProvincesGeoJson({
  bbox,
  signal,
  fetchImpl,
}: FetchProvincesParams): Promise<ProvinceFeatureCollection> {
  const params = new URLSearchParams();
  params.set("bbox", bbox);
  return apiFetch<ProvinceFeatureCollection>(
    `/provinces.geojson?${params.toString()}`,
    {
      signal,
      fetchImpl,
    },
  );
}
