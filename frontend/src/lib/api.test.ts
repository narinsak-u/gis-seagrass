import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiClientError, apiFetch, fetchActiveSitesGeoJson } from "./api";

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
});
