import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { proxyApiRequest } from "./api-proxy";

describe("proxyApiRequest", () => {
  it("forwards GET path, query string, and Authorization header to API_INTERNAL_URL", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fakeFetch: typeof fetch = async (input, init = {}) => {
      calls.push({ url: String(input), init });
      return new Response(
        JSON.stringify({ type: "FeatureCollection", features: [] }),
        {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8" },
        },
      );
    };

    const request = new Request(
      "http://localhost:3001/api/sites.geojson?bbox=98,7,99.5,9&status=active",
      {
        method: "GET",
        headers: {
          authorization: "Bearer secret-token",
          accept: "application/json",
        },
      },
    );

    const response = await proxyApiRequest(request, ["sites.geojson"], {
      apiInternalUrl: "http://api:3000/",
      fetchImpl: fakeFetch,
    });

    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      "http://api:3000/sites.geojson?bbox=98,7,99.5,9&status=active",
    );
    assert.equal(calls[0].init.method, "GET");
    const forwardedHeaders = new Headers(calls[0].init.headers);
    assert.equal(forwardedHeaders.get("authorization"), "Bearer secret-token");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      type: "FeatureCollection",
      features: [],
    });
  });

  it("forwards POST JSON body, Content-Type, and preserves upstream error status and envelope", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const errorEnvelope = {
      error: {
        code: "UNAUTHORIZED",
        message: "Invalid credentials",
        details: {},
      },
    };
    const fakeFetch: typeof fetch = async (input, init = {}) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify(errorEnvelope), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    };

    const request = new Request("http://localhost:3001/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "viewer@example.com", password: "wrong" }),
    });

    const response = await proxyApiRequest(request, ["auth", "login"], {
      apiInternalUrl: "http://127.0.0.1:3000",
      fetchImpl: fakeFetch,
    });

    assert.equal(calls[0].url, "http://127.0.0.1:3000/auth/login");
    assert.equal(calls[0].init.method, "POST");
    const forwardedHeaders = new Headers(calls[0].init.headers);
    assert.equal(forwardedHeaders.get("content-type"), "application/json");
    assert.equal(
      calls[0].init.body,
      JSON.stringify({ email: "viewer@example.com", password: "wrong" }),
    );
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), errorEnvelope);
  });

  it("returns 502 with shared error envelope when upstream request fails", async () => {
    const fakeFetch: typeof fetch = async () => {
      throw new TypeError("fetch failed");
    };

    const request = new Request(
      "http://localhost:3001/api/sites.geojson?bbox=98,7,99,9&status=active",
    );

    const response = await proxyApiRequest(request, ["sites.geojson"], {
      apiInternalUrl: "http://127.0.0.1:3000",
      fetchImpl: fakeFetch,
    });

    assert.equal(response.status, 502);
    const body = await response.json();
    assert.equal(body.error.code, "UPSTREAM_UNAVAILABLE");
    assert.equal(typeof body.error.message, "string");
    assert.deepEqual(body.error.details, {});
  });
});
