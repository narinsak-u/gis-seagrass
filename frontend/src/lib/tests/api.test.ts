import { describe, expect, it } from "vitest";
import {
  ApiClientError,
  apiFetch,
  fetchActiveSitesGeoJson,
  fetchSiteDetail,
} from "../api";

describe("apiFetch", () => {
  it("calls the same-origin /api endpoint with Bearer token and AbortSignal", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const controller = new AbortController();

    const fakeFetch: typeof fetch = async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return new Response(JSON.stringify({ email: "viewer@example.com", role: "viewer" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const result = await apiFetch<{ email: string; role: string }>("/auth/me", {
      token: "tok-123",
      signal: controller.signal,
      fetchImpl: fakeFetch,
    });

    expect(capturedUrl).toBe("/api/auth/me");
    const headers = new Headers(capturedInit?.headers);
    expect(headers.get("authorization")).toBe("Bearer tok-123");
    expect(capturedInit?.signal).toBe(controller.signal);
    expect(result).toEqual({ email: "viewer@example.com", role: "viewer" });
  });

  it("throws ApiClientError parsed from the shared API error envelope", async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          error: {
            code: "INVALID_BBOX",
            message: "Invalid bbox",
            details: { bbox: "bad" },
          },
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      );

    const request = apiFetch("/sites.geojson?bbox=bad", { fetchImpl: fakeFetch });

    await expect(request).rejects.toBeInstanceOf(ApiClientError);
    await expect(request).rejects.toMatchObject({
      status: 400,
      code: "INVALID_BBOX",
      message: "Invalid bbox",
      details: { bbox: "bad" },
    });
  });

  it("fetchActiveSitesGeoJson builds /api/sites.geojson with minLon,minLat,maxLon,maxLat and status=active", async () => {
    let capturedUrl = "";
    const fakeFetch: typeof fetch = async (input) => {
      capturedUrl = String(input);
      return new Response(
        JSON.stringify({ type: "FeatureCollection", features: [] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    await fetchActiveSitesGeoJson({
      bbox: "98.1,7.2,99.4,8.9",
      province: "92",
      fetchImpl: fakeFetch,
    });

    const parsed = new URL(capturedUrl, "http://localhost:8080");
    expect(parsed.pathname).toBe("/api/sites.geojson");
    expect(parsed.searchParams.get("bbox")).toBe("98.1,7.2,99.4,8.9");
    expect(parsed.searchParams.get("status")).toBe("active");
    expect(parsed.searchParams.get("province")).toBe("92");
  });

  it("fetchSiteDetail requests /api/sites/:code with URL encoding and AbortSignal", async () => {
    let capturedUrl = "";
    let capturedSignal: AbortSignal | null | undefined;
    const controller = new AbortController();

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

    const fakeFetch: typeof fetch = async (input, init) => {
      capturedUrl = String(input);
      capturedSignal = init?.signal;
      return new Response(JSON.stringify(detailPayload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const result = await fetchSiteDetail({
      code: "TRG/01",
      signal: controller.signal,
      fetchImpl: fakeFetch,
    });

    expect(capturedUrl).toBe("/api/sites/TRG%2F01");
    expect(capturedSignal).toBe(controller.signal);
    expect(result).toEqual(detailPayload);
  });
});
