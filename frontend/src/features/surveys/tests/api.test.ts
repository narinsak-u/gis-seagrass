import { describe, expect, it } from "vitest";
import { ApiClientError } from "@/src/lib/api";
import { fetchSiteSurveys } from "../api";
import {
  buildSurveyPointCollection,
  isAuthorizedSurveyRole,
  type SurveyListItem,
} from "../types";

describe("surveys types & point builder", () => {
  it("authorizes only viewer, editor, and admin roles", () => {
    expect(isAuthorizedSurveyRole("viewer")).toBe(true);
    expect(isAuthorizedSurveyRole("editor")).toBe(true);
    expect(isAuthorizedSurveyRole("admin")).toBe(true);
    expect(isAuthorizedSurveyRole("guest")).toBe(false);
    expect(isAuthorizedSurveyRole("")).toBe(false);
    expect(isAuthorizedSurveyRole(null)).toBe(false);
    expect(isAuthorizedSurveyRole(undefined)).toBe(false);
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
    expect(collection.type).toBe("FeatureCollection");
    expect(collection.features.length).toBe(2);
    expect(collection.features[0]).toEqual({
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
    expect(collection.features[1].geometry.coordinates).toEqual([99.1289, 7.4298]);
    expect(collection.features[1].properties.species).toBe("");
    expect(collection.features[1].properties.created_by).toBe(null);
  });

  it("returns an empty FeatureCollection when no items or siteCode are present and drops invalid coordinates", () => {
    expect(buildSurveyPointCollection("TRG-01", [])).toEqual({
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
    expect(buildSurveyPointCollection("TRG-01", invalidItems).features.length).toBe(0);
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

    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe("/api/sites/TRG%2001%2FA/surveys?page=2&pageSize=10");
    expect(calls[0].headers.get("authorization")).toBe("Bearer jwt-secret-token");
    expect(calls[0].signal).toBe(controller.signal);
    expect(result.total).toBe(3);
    expect(result.page).toBe(2);
    expect(result.items.length).toBe(1);
    expect(result.items[0].id).toBe("12");
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

    const request = fetchSiteSurveys({
      code: "TRG-01",
      page: 1,
      pageSize: 10,
      token: "some-token",
      fetchImpl: fakeFetch,
    });

    await expect(request).rejects.toBeInstanceOf(ApiClientError);
    await expect(request).rejects.toMatchObject({
      status: 403,
      code: "FORBIDDEN",
      message: "Role is not permitted to read survey history",
    });
  });
});
