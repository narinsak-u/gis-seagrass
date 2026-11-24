import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SiteFeature, SiteFeatureCollection } from "./types";
import {
  computeSiteBounds,
  deriveProvinceOptions,
  EMPTY_SITE_FILTERS,
  filterSiteCollection,
  findPageForSiteCode,
  mergeKnownProvinceCodes,
  paginateItems,
} from "./filtering";

function makeSite(
  code: string,
  name: string,
  province_code: string,
  siteStatus: SiteFeature["properties"]["siteStatus"],
  geometry?: SiteFeature["geometry"],
): SiteFeature {
  return {
    type: "Feature",
    geometry: geometry ?? {
      type: "MultiPolygon",
      coordinates: [[[[99.1, 7.2], [99.2, 7.2], [99.2, 7.3], [99.1, 7.3], [99.1, 7.2]]]],
    },
    properties: {
      code,
      name,
      province_code,
      area_rai: 100,
      version: 1,
      siteStatus,
    },
  };
}

describe("filterSiteCollection", () => {
  const sites: SiteFeatureCollection = {
    type: "FeatureCollection",
    features: [
      makeSite("TRG-001", "Ko Libong South", "92", "very_good"),
      makeSite("TRG-002", "Had Chao Mai", "92", "poor"),
      makeSite("KBI-010", "Ko Lanta Bay", "81", "fair"),
      makeSite("PHK-004", "Ao Tang Khen", "83", "no_data"),
      makeSite("STN-009", "Ko Sarai", "91", "good"),
    ],
  };

  it("returns null when source collection is null", () => {
    assert.equal(filterSiteCollection(null, EMPTY_SITE_FILTERS), null);
  });

  it("returns all viewport features when no filters are active", () => {
    const result = filterSiteCollection(sites, EMPTY_SITE_FILTERS);
    assert.equal(result?.features.length, 5);
  });

  it("filters by province code", () => {
    const result = filterSiteCollection(sites, {
      ...EMPTY_SITE_FILTERS,
      province: "92",
    });
    assert.deepEqual(
      result?.features.map((f) => f.properties.code),
      ["TRG-001", "TRG-002"],
    );
  });

  it("filters by exact siteStatus including no_data without confusing status=active", () => {
    const noData = filterSiteCollection(sites, {
      ...EMPTY_SITE_FILTERS,
      siteStatus: "no_data",
    });
    assert.deepEqual(
      noData?.features.map((f) => f.properties.code),
      ["PHK-004"],
    );

    const poor = filterSiteCollection(sites, {
      ...EMPTY_SITE_FILTERS,
      siteStatus: "poor",
    });
    assert.deepEqual(
      poor?.features.map((f) => f.properties.code),
      ["TRG-002"],
    );
  });

  it("applies case-insensitive substring search across Site code and name", () => {
    const byCode = filterSiteCollection(sites, {
      ...EMPTY_SITE_FILTERS,
      search: "  trg-00  ",
    });
    assert.deepEqual(
      byCode?.features.map((f) => f.properties.code),
      ["TRG-001", "TRG-002"],
    );

    const byName = filterSiteCollection(sites, {
      ...EMPTY_SITE_FILTERS,
      search: "LANTA",
    });
    assert.deepEqual(
      byName?.features.map((f) => f.properties.code),
      ["KBI-010"],
    );
  });

  it("combines province, siteStatus, and search consistently", () => {
    const combined = filterSiteCollection(sites, {
      province: "92",
      siteStatus: "very_good",
      search: "libong",
    });
    assert.deepEqual(
      combined?.features.map((f) => f.properties.code),
      ["TRG-001"],
    );
  });
});

describe("paginateItems and findPageForSiteCode", () => {
  const features = Array.from({ length: 11 }, (_, idx) =>
    makeSite(`S-${String(idx + 1).padStart(2, "0")}`, `Site ${idx + 1}`, "92", "good"),
  );

  it("paginates filtered viewport features locally and clamps out-of-range pages", () => {
    const page1 = paginateItems(features, 1, 5);
    assert.equal(page1.page, 1);
    assert.equal(page1.totalPages, 3);
    assert.equal(page1.totalItems, 11);
    assert.equal(page1.startIndex, 1);
    assert.equal(page1.endIndex, 5);
    assert.deepEqual(
      page1.items.map((f) => f.properties.code),
      ["S-01", "S-02", "S-03", "S-04", "S-05"],
    );

    const clampedHigh = paginateItems(features, 99, 5);
    assert.equal(clampedHigh.page, 3);
    assert.equal(clampedHigh.startIndex, 11);
    assert.equal(clampedHigh.endIndex, 11);
    assert.deepEqual(
      clampedHigh.items.map((f) => f.properties.code),
      ["S-11"],
    );

    const empty = paginateItems([], 2, 5);
    assert.equal(empty.page, 1);
    assert.equal(empty.totalPages, 1);
    assert.equal(empty.startIndex, 0);
    assert.equal(empty.endIndex, 0);
    assert.deepEqual(empty.items, []);
  });

  it("locates the 1-based page containing a polygon-selected Site code", () => {
    assert.equal(findPageForSiteCode(features, "S-01", 5), 1);
    assert.equal(findPageForSiteCode(features, "S-06", 5), 2);
    assert.equal(findPageForSiteCode(features, "S-11", 5), 3);
    assert.equal(findPageForSiteCode(features, "MISSING", 5), null);
  });
});

describe("province option derivation", () => {
  it("tracks unfiltered viewport provinces and retains known options plus active code while filtered", () => {
    const unfilteredViewport = [
      makeSite("TRG-01", "Libong", "92", "very_good"),
      makeSite("KBI-01", "Lanta", "81", "good"),
      makeSite("TRG-02", "Muk", "92", "fair"),
    ];

    const knownAfterUnfiltered = mergeKnownProvinceCodes([], unfilteredViewport, false);
    assert.deepEqual(knownAfterUnfiltered, ["81", "92"]);

    // While filtered to province 92, API only returns province 92 (or even 0 sites after panning)
    const knownWhileFiltered = mergeKnownProvinceCodes(knownAfterUnfiltered, [], true);
    assert.deepEqual(knownWhileFiltered, ["81", "92"]);

    // Even if activeProvince was set to a code absent from current results, it is still retained
    const options = deriveProvinceOptions({
      knownCodes: knownWhileFiltered,
      viewportFeatures: [],
      activeProvince: "83",
      provinceNames: { "81": "กระบี่", "92": "ตรัง" },
    });

    assert.deepEqual(options, [
      { code: "81", label: "กระบี่ (81)" },
      { code: "83", label: "Province 83" },
      { code: "92", label: "ตรัง (92)" },
    ]);
  });

  it("accepts a Map for optional provinceNames enrichment", () => {
    const options = deriveProvinceOptions({
      knownCodes: ["92"],
      viewportFeatures: [],
      activeProvince: "",
      provinceNames: new Map([["92", "ตรัง"]]),
    });

    assert.deepEqual(options, [{ code: "92", label: "ตรัง (92)" }]);
  });
});

describe("computeSiteBounds", () => {
  it("computes bounding box for a Polygon", () => {
    const bounds = computeSiteBounds({
      type: "Polygon",
      coordinates: [
        [
          [99.1, 7.25],
          [99.45, 7.2],
          [99.4, 7.6],
          [99.1, 7.25],
        ],
      ],
    });
    assert.deepEqual(bounds, {
      minLon: 99.1,
      minLat: 7.2,
      maxLon: 99.45,
      maxLat: 7.6,
    });
  });

  it("computes combined bounding box across all polygons in a MultiPolygon", () => {
    const bounds = computeSiteBounds({
      type: "MultiPolygon",
      coordinates: [
        [[[98.2, 8.1], [98.4, 8.1], [98.4, 8.3], [98.2, 8.1]]],
        [[[99.0, 7.4], [99.3, 7.4], [99.3, 7.7], [99.0, 7.4]]],
      ],
    });
    assert.deepEqual(bounds, {
      minLon: 98.2,
      minLat: 7.4,
      maxLon: 99.3,
      maxLat: 8.3,
    });
  });

  it("returns null for empty coordinates", () => {
    const bounds = computeSiteBounds({
      type: "MultiPolygon",
      coordinates: [],
    });
    assert.equal(bounds, null);
  });
});
