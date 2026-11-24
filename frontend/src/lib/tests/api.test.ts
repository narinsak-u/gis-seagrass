import { AxiosError, type InternalAxiosRequestConfig } from "axios";
import { describe, expect, it } from "vitest";
import {
  apiClient,
  apiRequest,
  fetchActiveSitesGeoJson,
  fetchSiteDetail,
} from "../api";

const detailPayload = {
  type: "Feature" as const,
  geometry: {
    type: "MultiPolygon" as const,
    coordinates: [[[[99.3, 7.4], [99.4, 7.4], [99.4, 7.5], [99.3, 7.4]]]],
  },
  properties: {
    code: "TRG/01",
    name: "Ko Libong",
    province_code: "92",
    area_rai: 450.5,
    version: 3,
    siteStatus: "very_good" as const,
    latest_survey: {
      survey_ref: "SRV-2025-01",
      surveyed_on: "2025-02-14",
      cover_percent: 82.5,
    },
  },
};

describe("Axios API client", () => {

  it("requests active Site GeoJSON with bounded params and forwards cancellation", async () => {
    const controller = new AbortController();
    let capturedConfig: InternalAxiosRequestConfig | undefined;
    const previousAdapter = apiClient.defaults.adapter;
    apiClient.defaults.adapter = async (config) => {
      capturedConfig = config;
      return {
        data: { type: "FeatureCollection", features: [] },
        status: 200,
        statusText: "OK",
        headers: {},
        config,
      };
    };
    try {
      await fetchActiveSitesGeoJson({
        bbox: "98.1,7.2,99.4,8.9",
        province: "92",
        signal: controller.signal,
      });
      expect(capturedConfig?.url).toBe("/sites.geojson");
      expect(capturedConfig?.params).toEqual({
        bbox: "98.1,7.2,99.4,8.9",
        province: "92",
        status: "active",
      });
      controller.abort();
      expect(capturedConfig?.signal?.aborted).toBe(true);
    } finally {
      apiClient.defaults.adapter = previousAdapter;
    }
  });

  it("rejects malformed Site FeatureCollections", async () => {
    const previousAdapter = apiClient.defaults.adapter;
    apiClient.defaults.adapter = async (config) => ({
      data: { type: "FeatureCollection", features: [{ type: "Feature" }] },
      status: 200,
      statusText: "OK",
      headers: {},
      config,
    });
    try {
      await expect(fetchActiveSitesGeoJson({ bbox: "98,7,99,8" }))
        .rejects.toMatchObject({ code: "INVALID_API_RESPONSE" });
    } finally {
      apiClient.defaults.adapter = previousAdapter;
    }
  });
});

describe("Axios Site detail client", () => {
  it("requests public detail through the shared /api client with Accept and signal", async () => {
    const controller = new AbortController();
    let capturedConfig: InternalAxiosRequestConfig | undefined;
    const previousAdapter = apiClient.defaults.adapter;
    apiClient.defaults.adapter = async (config) => {
      capturedConfig = config;
      return {
        data: detailPayload,
        status: 200,
        statusText: "OK",
        headers: {},
        config,
      };
    };

    try {
      const result = await fetchSiteDetail({ code: "TRG/01", signal: controller.signal });

      expect(capturedConfig?.timeout).toBe(10_000);
      expect(capturedConfig?.url).toBe("/sites/TRG%2F01");
      expect(capturedConfig?.headers.get("Accept")).toBe("application/json");
      expect(capturedConfig?.headers.get("Authorization")).toBeUndefined();
      expect(capturedConfig?.signal).toBe(controller.signal);
      expect(result).toEqual(detailPayload);
    } finally {
      apiClient.defaults.adapter = previousAdapter;
    }
  });

  it("normalizes backend errors, network failures, and bodyless 204 responses", async () => {
    const previousAdapter = apiClient.defaults.adapter;
    apiClient.defaults.adapter = async (config) => {
      throw new AxiosError("Request failed with status code 404", "ERR_BAD_REQUEST", config, undefined, {
        data: {
          error: {
            code: "SITE_NOT_FOUND",
            message: "Site not found",
            details: { code: "missing" },
          },
        },
        status: 404,
        statusText: "Not Found",
        headers: {},
        config,
      });
    };
    try {
      await expect(fetchSiteDetail({ code: "missing" })).rejects.toMatchObject({
        status: 404,
        code: "SITE_NOT_FOUND",
        message: "Site not found",
        details: { code: "missing" },
      });

      apiClient.defaults.adapter = async (config) => ({
        data: "",
        status: 204,
        statusText: "No Content",
        headers: {},
        config,
      });
      await expect(apiRequest<void>("/empty")).resolves.toBeUndefined();

      apiClient.defaults.adapter = async () => {
        throw new Error("offline");
      };
      await expect(fetchSiteDetail({ code: "offline" })).rejects.toMatchObject({
        status: 0,
        code: "NETWORK_ERROR",
      });
    } finally {
      apiClient.defaults.adapter = previousAdapter;
    }
  });

  it("supports params and adds authorization only for an explicit token", async () => {
    const controller = new AbortController();
    let capturedConfig: InternalAxiosRequestConfig | undefined;
    const previousAdapter = apiClient.defaults.adapter;
    apiClient.defaults.adapter = async (config) => {
      capturedConfig = config;
      return {
        data: { ok: true },
        status: 200,
        statusText: "OK",
        headers: {},
        config,
      };
    };
    try {
      await apiRequest("/public", {
        params: { status: "active" },
        signal: controller.signal,
      });
      expect(capturedConfig?.params).toEqual({ status: "active" });
      expect(capturedConfig?.headers.get("Authorization")).toBeUndefined();
      expect(capturedConfig?.signal).toBe(controller.signal);

      await apiRequest("/protected", { token: "explicit-token" });
      expect(capturedConfig?.headers.get("Authorization")).toBe("Bearer explicit-token");
    } finally {
      apiClient.defaults.adapter = previousAdapter;
    }
  });

  it("rejects malformed detail and normalizes cancellation separately", async () => {
    const previousAdapter = apiClient.defaults.adapter;
    apiClient.defaults.adapter = async (config) => ({
      data: {
        ...detailPayload,
        geometry: {
          ...detailPayload.geometry,
          coordinates: [[[[Number.POSITIVE_INFINITY, 7.4]]]],
        },
      },
      status: 200,
      statusText: "OK",
      headers: {},
      config,
    });
    try {
      await expect(fetchSiteDetail({ code: "TRG/01" })).rejects.toMatchObject({
        status: 0,
        code: "INVALID_API_RESPONSE",
      });

      apiClient.defaults.adapter = async (config) => ({
        data: {
          ...detailPayload,
          properties: { ...detailPayload.properties, siteStatus: "unknown" },
        },
        status: 200,
        statusText: "OK",
        headers: {},
        config,
      });
      await expect(fetchSiteDetail({ code: "TRG/01" })).rejects.toMatchObject({
        status: 0,
        code: "INVALID_API_RESPONSE",
      });
      const controller = new AbortController();
      controller.abort();
      await expect(fetchSiteDetail({ code: "TRG/01", signal: controller.signal }))
        .rejects.toMatchObject({ name: "AbortError" });
    } finally {
      apiClient.defaults.adapter = previousAdapter;
    }
  });
});
