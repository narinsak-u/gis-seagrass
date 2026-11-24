import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { apiClient, ApiClientError } from "@/src/lib/api";
import { provinceViewportQueryOptions } from "../provinces-viewport";
import { fetchProvincesGeoJson } from "../api";

const validCollection = {
  type: "FeatureCollection",
  features: [{
    type: "Feature",
    geometry: {
      type: "MultiPolygon",
      coordinates: [[[[98, 7], [99, 7], [99, 8], [98, 8], [98, 7]]]],
    },
    properties: { code: "81", name_th: "กระบี่" },
  }],
};

describe("Province viewport requests", () => {
  it("requests bounded Province GeoJSON through Query and cancels the old viewport", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const previousAdapter = apiClient.defaults.adapter;
    const requests: Array<{ url: string; params: unknown; signal: { aborted: boolean } | undefined }> = [];
    apiClient.defaults.adapter = async (config) => {
      requests.push({
        url: config.url ?? "",
        params: config.params,
        signal: config.signal ?? undefined,
      });
      return new Promise<never>(() => {});
    };
    const observer = new QueryObserver(client, provinceViewportQueryOptions("98,7,99,8"));
    const unsubscribe = observer.subscribe(() => {});
    try {
      await vi.waitFor(() => expect(requests).toHaveLength(1));
      expect(requests[0]).toMatchObject({
        url: "/provinces.geojson",
        params: { bbox: "98,7,99,8" },
      });
      observer.setOptions(provinceViewportQueryOptions("99,8,100,9"));
      await vi.waitFor(() => expect(requests[0].signal?.aborted).toBe(true));
    } finally {
      unsubscribe();
      client.clear();
      apiClient.defaults.adapter = previousAdapter;
    }
  });

  it("rejects malformed Province GeoJSON visibly", async () => {
    const previousAdapter = apiClient.defaults.adapter;
    apiClient.defaults.adapter = async (config) => ({
      data: {
        ...validCollection,
        features: [{
          ...validCollection.features[0],
          properties: { code: "81", name_th: "กระบี่" },
          geometry: {
            type: "MultiPolygon",
            coordinates: [[[[98, 7], [Number.NaN, 7], [99, 8]]]],
          },
        }],
      },
      status: 200,
      statusText: "OK",
      headers: {},
      config,
    });
    try {
      const request = fetchProvincesGeoJson({ bbox: "98,7,99,8" });
      await expect(request).rejects.toBeInstanceOf(ApiClientError);
      await expect(request).rejects.toMatchObject({ code: "INVALID_API_RESPONSE" });
    } finally {
      apiClient.defaults.adapter = previousAdapter;
    }
  });
});
