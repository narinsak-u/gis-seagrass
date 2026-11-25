import { QueryClient } from "@tanstack/react-query";
import { apiClient } from "@/src/lib/api";
import { describe, expect, it } from "vitest";
import { siteDetailQueryOptions } from "../hooks/site-detail-query";

const site = {
  type: "Feature" as const,
  geometry: {
    type: "MultiPolygon" as const,
    coordinates: [[[[99, 7], [100, 7], [100, 8], [99, 8], [99, 7]]]],
  },
  properties: {
    code: "TRG-001",
    name: "Trang meadow",
    province_code: "92",
    area_rai: 120,
    version: 1,
    siteStatus: "good" as const,
    latest_survey: null,
  },
};

describe("site detail query", () => {
  it("loads a Site through the shared API client and caches by Site code", async () => {
    let calls = 0;
    let requestedUrl = "";
    const previousAdapter = apiClient.defaults.adapter;
    apiClient.defaults.adapter = async (config) => {
      calls += 1;
      requestedUrl = String(config.url);
      return { data: site, status: 200, statusText: "OK", headers: {}, config };
    };
    const client = new QueryClient();
    const options = siteDetailQueryOptions("TRG-001");

    try {
      const first = await client.fetchQuery(options);
      const second = await client.fetchQuery(options);

      expect(first).toEqual(site);
      expect(second).toBe(first);
      expect(requestedUrl).toBe("/sites/TRG-001");
      expect(calls).toBe(1);
    } finally {
      apiClient.defaults.adapter = previousAdapter;
      client.clear();
    }
  });
});
