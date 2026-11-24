import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ApiClientError,
  apiFetch,
  fetchActiveSitesGeoJson,
  fetchSiteDetail,
} from "./api";

describe("apiFetch", () => {
  it("calls the same-origin /api proxy with Bearer token and AbortSignal", async () => {
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

    assert.equal(capturedUrl, "/api/auth/me");
    const headers = new Headers(capturedInit?.headers);
    assert.equal(headers.get("authorization"), "Bearer tok-123");
    assert.equal(capturedInit?.signal, controller.signal);
    assert.deepEqual(result, { email: "viewer@example.com", role: "viewer" });
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

    await assert.rejects(
      () => apiFetch("/sites.geojson?bbox=bad", { fetchImpl: fakeFetch }),
      (error: unknown) => {
        assert.ok(error instanceof ApiClientError);
        assert.equal(error.status, 400);
        assert.equal(error.code, "INVALID_BBOX");
        assert.equal(error.message, "Invalid bbox");
        assert.deepEqual(error.details, { bbox: "bad" });
        return true;
      },
    );
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

    const parsed = new URL(capturedUrl, "http://localhost:3001");
    assert.equal(parsed.pathname, "/api/sites.geojson");
    assert.equal(parsed.searchParams.get("bbox"), "98.1,7.2,99.4,8.9");
    assert.equal(parsed.searchParams.get("status"), "active");
    assert.equal(parsed.searchParams.get("province"), "92");
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

    assert.equal(capturedUrl, "/api/sites/TRG%2F01");
    assert.equal(capturedSignal, controller.signal);
    assert.deepEqual(result, detailPayload);
  });
});
