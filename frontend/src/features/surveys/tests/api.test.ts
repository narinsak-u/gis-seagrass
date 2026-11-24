import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "@/src/lib/api";
import { fetchSiteSurveys } from "../api";
import {
  buildSurveyPointCollection,
  isAuthorizedSurveyRole,
  type SurveyListItem,
} from "../types";
import { surveyPageSchema } from "../schema";

afterEach(() => vi.restoreAllMocks());

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
        id: "101", lon: 99.1234, lat: 7.4567, surveyed_on: "2025-04-01",
        cover_percent: 68, species: ["THHE"], note: null, created_by: null,
      },
      {
        id: "102", lon: 99.1289, lat: 7.4298, surveyed_on: "2025-03-01",
        cover_percent: 0, species: [], note: null, created_by: "someone",
      },
    ];
    const collection = buildSurveyPointCollection("TRG-01", items);
    expect(collection.type).toBe("FeatureCollection");
    expect(collection.features.length).toBe(2);
    expect(collection.features[0].geometry.coordinates).toEqual([99.1234, 7.4567]);
    expect(collection.features[1].geometry.coordinates).toEqual([99.1289, 7.4298]);
    expect(collection.features[1].properties.species).toBe("");
    expect(collection.features[1].properties.created_by).toBe("someone");
  });

  it("returns empty points with no items and drops invalid coordinates", () => {
    expect(buildSurveyPointCollection("TRG-01", [])).toEqual({
      type: "FeatureCollection",
      features: [],
    });
    expect(buildSurveyPointCollection("TRG-01", [{
      id: "1", lon: Number.NaN, lat: 7, surveyed_on: "2025-04-01",
      cover_percent: 0, species: [], note: null, created_by: null,
    }]).features).toHaveLength(0);
  });
});

const validPage = {
  items: [{
    id: "12", lon: 99.15, lat: 7.35, surveyed_on: "2025-04-01",
    cover_percent: 68, species: ["THHE"], note: null, created_by: null,
  }],
  total: 3,
  page: 2,
};

describe("Survey page validation", () => {
  it("accepts required fields and valid coordinates", () => {
    expect(surveyPageSchema.parse(validPage)).toEqual(validPage);
  });

  it.each([
    [{ ...validPage, total: undefined }],
    [{ ...validPage, total: -1 }],
    [{ ...validPage, page: 0 }],
    [{ ...validPage, items: [{ ...validPage.items[0], lon: Number.NaN }] }],
    [{ ...validPage, items: [{ ...validPage.items[0], lat: Number.POSITIVE_INFINITY }] }],
    [{ ...validPage, items: [{ ...validPage.items[0], id: undefined }] }],
    [{ ...validPage, items: [{ ...validPage.items[0], lon: 181 }] }],
    [{ ...validPage, items: [{ ...validPage.items[0], lat: -91 }] }],
    [{ ...validPage, items: [{ ...validPage.items[0], cover_percent: 101 }] }],
  ])("rejects malformed page %#", (page) => {
    expect(surveyPageSchema.safeParse(page).success).toBe(false);
  });
});

describe("fetchSiteSurveys", () => {
  it("sends path, pagination, explicit bearer token, and signal through Axios", async () => {
    const controller = new AbortController();
    const request = vi.spyOn(apiClient, "request").mockResolvedValue({
      status: 200,
      data: validPage,
    } as never);

    const result = await fetchSiteSurveys({
      code: "TRG 01/A", page: 2, pageSize: 10,
      token: "jwt-secret-token", signal: controller.signal,
    });

    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      url: "/sites/TRG%2001%2FA/surveys",
      params: { page: 2, pageSize: 10 },
      signal: controller.signal,
      headers: { Authorization: "Bearer jwt-secret-token" },
    }));
    expect(result).toEqual(validPage);
  });

  it("rejects a successful response missing its page", async () => {
    vi.spyOn(apiClient, "request").mockResolvedValue({
      status: 200,
      data: { items: [], total: 1 },
    } as never);

    await expect(fetchSiteSurveys({
      code: "TRG-01", token: "some-token",
    })).rejects.toMatchObject({ code: "INVALID_API_RESPONSE" });
  });

  it("rejects a successful response for a different requested page", async () => {
    vi.spyOn(apiClient, "request").mockResolvedValue({
      status: 200,
      data: validPage,
    } as never);

    await expect(fetchSiteSurveys({
      code: "TRG-01", page: 3, token: "some-token",
    })).rejects.toMatchObject({ code: "INVALID_API_RESPONSE" });
  });

  it("preserves normalized 403 errors", async () => {
    vi.spyOn(apiClient, "request").mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 403,
        data: { error: {
          code: "FORBIDDEN",
          message: "Role is not permitted to read survey history",
        } },
      },
    });
    await expect(fetchSiteSurveys({
      code: "TRG-01", token: "some-token",
    })).rejects.toMatchObject({
      status: 403,
      code: "FORBIDDEN",
      message: "Role is not permitted to read survey history",
    });
  });
});
