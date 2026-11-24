import { QueryClient } from "@tanstack/react-query";
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
    const fetchImpl: typeof fetch = async (input) => {
      calls += 1;
      requestedUrl = String(input);
      return new Response(JSON.stringify(site), {
        headers: { "content-type": "application/json" },
      });
    };
    const client = new QueryClient();
    const options = siteDetailQueryOptions("TRG-001", fetchImpl);

    const first = await client.fetchQuery(options);
    const second = await client.fetchQuery(options);

    expect(first).toEqual(site);
    expect(second).toBe(first);
    expect(requestedUrl).toBe("/api/sites/TRG-001");
    expect(calls).toBe(1);
    client.clear();
  });
});
