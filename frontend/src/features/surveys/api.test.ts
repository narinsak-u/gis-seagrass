import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiClientError } from "@/src/lib/api";
import { fetchSiteSurveys } from "./api";
import {
  buildSurveyPointCollection,
  isAuthorizedSurveyRole,
  type SurveyListItem,
} from "./types";

describe("surveys types & point builder", () => {
  it("authorizes only viewer, editor, and admin roles", () => {
    assert.equal(isAuthorizedSurveyRole("viewer"), true);
    assert.equal(isAuthorizedSurveyRole("editor"), true);
    assert.equal(isAuthorizedSurveyRole("admin"), true);
    assert.equal(isAuthorizedSurveyRole("guest"), false);
    assert.equal(isAuthorizedSurveyRole(""), false);
    assert.equal(isAuthorizedSurveyRole(null), false);
    assert.equal(isAuthorizedSurveyRole(undefined), false);
  });

  it("builds GeoJSON Point features using real lon/lat coordinates for the selected Site only", () => {
    const items: SurveyListItem[] = [
      {
        id: "101",
        lon: 99.1234,
        lat: 7.4321,
        surveyed_on: "2025-03-14",
        cover_percent: 72.5,
        species: ["ENAC", "THHE"],
        note: "Near northern channel",
        created_by: "a0000000-0000-0000-0000-000000000001",
      },
      {
        id: "102",
        lon: 99.1289,
        lat: 7.4298,
        surveyed_on: "2025-02-01",
        cover_percent: 45,
        species: [],
        note: null,
        created_by: null,
      },
    ];

    const collection = buildSurveyPointCollection("TRG-01", items);
    assert.equal(collection.type, "FeatureCollection");
    assert.equal(collection.features.length, 2);
    assert.deepEqual(collection.features[0], {
      type: "Feature",
      id: "101",
      geometry: {
        type: "Point",
        coordinates: [99.1234, 7.4321],
      },
      properties: {
        id: "101",
        siteCode: "TRG-01",
        surveyed_on: "2025-03-14",
        cover_percent: 72.5,
        species: "ENAC, THHE",
        note: "Near northern channel",
        created_by: "a0000000-0000-0000-0000-000000000001",
        survey_ref: null,
      },
    });
    assert.deepEqual(collection.features[1].geometry.coordinates, [99.1289, 7.4298]);
    assert.equal(collection.features[1].properties.species, "");
    assert.equal(collection.features[1].properties.created_by, null);
  });

  it("returns an empty FeatureCollection when no items or siteCode are present and drops invalid coordinates", () => {
    assert.deepEqual(buildSurveyPointCollection("TRG-01", []), {
      type: "FeatureCollection",
      features: [],
    });

    const invalidItems: SurveyListItem[] = [
      {
        id: "1",
        lon: Number.NaN,
        lat: 7.4,
        surveyed_on: "2025-01-01",
        cover_percent: 20,
        species: [],
        note: null,
        created_by: null,
      },
      {
        id: "2",
        lon: 185,
        lat: 7.4,
        surveyed_on: "2025-01-02",
        cover_percent: 30,
        species: [],
        note: null,
        created_by: null,
      },
    ];
    assert.equal(buildSurveyPointCollection("TRG-01", invalidItems).features.length, 0);
  });
});

describe("fetchSiteSurveys", () => {
  it("requests /api/sites/:code/surveys with page, pageSize, Bearer token, and AbortSignal", async () => {
    const calls: Array<{ url: string; headers: Headers; signal?: AbortSignal | null }> = [];
    const controller = new AbortController();

    const fakeFetch: typeof fetch = async (input, init) => {
      calls.push({
        url: String(input),
        headers: new Headers(init?.headers),
        signal: init?.signal,
      });
      return new Response(
        JSON.stringify({
          items: [
            {
              id: "12",
              lon: 99.15,
              lat: 7.35,
              surveyed_on: "2025-04-01",
              cover_percent: 68,
              species: ["THHE"],
              note: null,
              created_by: null,
            },
          ],
          total: 3,
          page: 2,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const result = await fetchSiteSurveys({
      code: "TRG 01/A",
      page: 2,
      pageSize: 10,
      token: "jwt-secret-token",
      signal: controller.signal,
      fetchImpl: fakeFetch,
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "/api/sites/TRG%2001%2FA/surveys?page=2&pageSize=10");
    assert.equal(calls[0].headers.get("authorization"), "Bearer jwt-secret-token");
    assert.equal(calls[0].signal, controller.signal);
    assert.equal(result.total, 3);
    assert.equal(result.page, 2);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].id, "12");
  });

  it("throws ApiClientError with status and shared envelope on 401 and 403 responses", async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          error: {
            code: "FORBIDDEN",
            message: "Role is not permitted to read survey history",
            details: {},
          },
        }),
        { status: 403, headers: { "content-type": "application/json" } },
      );

    await assert.rejects(
      () =>
        fetchSiteSurveys({
          code: "TRG-01",
          page: 1,
          pageSize: 10,
          token: "some-token",
          fetchImpl: fakeFetch,
        }),
      (err: unknown) => {
        assert.ok(err instanceof ApiClientError);
        assert.equal(err.status, 403);
        assert.equal(err.code, "FORBIDDEN");
        assert.equal(err.message, "Role is not permitted to read survey history");
        return true;
      },
    );
  });
});
