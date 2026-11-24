import { describe, expect, it } from "vitest";
import { ApiClientError } from "@/src/lib/api";
import type { SiteDetailFeature } from "../types";
import { createSiteDetailController, type SiteDetailState } from "../detail";

function makeDetail(
  code: string,
  latestSurvey: SiteDetailFeature["properties"]["latest_survey"],
): SiteDetailFeature {
  return {
    type: "Feature",
    geometry: {
      type: "MultiPolygon",
      coordinates: [[[[99.1, 7.2], [99.2, 7.2], [99.2, 7.3], [99.1, 7.2]]]],
    },
    properties: {
      code,
      name: `Site ${code}`,
      province_code: "92",
      area_rai: 215.4,
      version: 2,
      siteStatus: latestSurvey ? "good" : "no_data",
      latest_survey: latestSurvey,
    },
  };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createSiteDetailController", () => {
  it("fetches Site detail including latest_survey or explicit null", async () => {
    const states: SiteDetailState[] = [];
    const req = deferred<SiteDetailFeature>();

    const controller = createSiteDetailController({
      fetchSiteDetail: () => req.promise,
      onStateChange: (state) => states.push(state),
    });

    controller.select("TRG-01");
    expect(states.at(-1)?.status).toBe("loading");
    expect(states.at(-1)?.selectedCode).toBe("TRG-01");

    const detail = makeDetail("TRG-01", null);
    req.resolve(detail);
    await Promise.resolve();
    await Promise.resolve();

    expect(states.at(-1)?.status).toBe("ready");
    expect(states.at(-1)?.data).toEqual(detail);
    expect(states.at(-1)?.data?.properties.latest_survey).toBe(null);
  });

  it("aborts previous request and ignores stale late responses when switching Sites", async () => {
    const states: SiteDetailState[] = [];
    const signals: AbortSignal[] = [];
    const pending: Array<Deferred<SiteDetailFeature>> = [];

    const controller = createSiteDetailController({
      fetchSiteDetail: ({ signal }) => {
        signals.push(signal);
        const d = deferred<SiteDetailFeature>();
        pending.push(d);
        return d.promise;
      },
      onStateChange: (state) => states.push(state),
    });

    controller.select("SITE-A");
    controller.select("SITE-B");

    expect(signals.length).toBe(2);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);

    // SITE-B resolves first
    const detailB = makeDetail("SITE-B", {
      survey_ref: "REF-B",
      surveyed_on: "2025-03-01",
      cover_percent: 64,
    });
    pending[1].resolve(detailB);
    await Promise.resolve();
    await Promise.resolve();
    expect(states.at(-1)?.status).toBe("ready");
    expect(states.at(-1)?.data?.properties.code).toBe("SITE-B");

    // Stale SITE-A resolves late — must be ignored
    pending[0].resolve(makeDetail("SITE-A", null));
    await Promise.resolve();
    await Promise.resolve();

    expect(states.at(-1)?.status).toBe("ready");
    expect(states.at(-1)?.data?.properties.code).toBe("SITE-B");
  });

  it("ignores stale errors after a newer selection succeeds and supports retry", async () => {
    const states: SiteDetailState[] = [];
    const pending: Array<Deferred<SiteDetailFeature>> = [];

    const controller = createSiteDetailController({
      fetchSiteDetail: () => {
        const d = deferred<SiteDetailFeature>();
        pending.push(d);
        return d.promise;
      },
      onStateChange: (state) => states.push(state),
    });

    controller.select("SITE-A");
    controller.select("SITE-B");

    pending[1].resolve(makeDetail("SITE-B", null));
    await Promise.resolve();
    await Promise.resolve();
    expect(states.at(-1)?.status).toBe("ready");

    // Stale error from SITE-A must not overwrite SITE-B
    pending[0].reject(new ApiClientError(500, "INTERNAL_ERROR", "Upstream failed"));
    await Promise.resolve();
    await Promise.resolve();
    expect(states.at(-1)?.status).toBe("ready");
    expect(states.at(-1)?.data?.properties.code).toBe("SITE-B");

    // Now select SITE-C which fails, then retry and succeed
    controller.select("SITE-C");
    pending[2].reject(new ApiClientError(404, "SITE_NOT_FOUND", "Site not found"));
    await Promise.resolve();
    await Promise.resolve();
    expect(states.at(-1)?.status).toBe("error");
    expect(states.at(-1)?.error?.code).toBe("SITE_NOT_FOUND");

    controller.retry();
    expect(states.at(-1)?.status).toBe("loading");
    pending[3].resolve(makeDetail("SITE-C", null));
    await Promise.resolve();
    await Promise.resolve();
    expect(states.at(-1)?.status).toBe("ready");
    expect(states.at(-1)?.data?.properties.code).toBe("SITE-C");
  });

  it("aborts in-flight fetch and clears state on clear()", async () => {
    const states: SiteDetailState[] = [];
    const signals: AbortSignal[] = [];
    const req = deferred<SiteDetailFeature>();

    const controller = createSiteDetailController({
      fetchSiteDetail: ({ signal }) => {
        signals.push(signal);
        return req.promise;
      },
      onStateChange: (state) => states.push(state),
    });

    controller.select("TRG-01");
    controller.clear();

    expect(signals[0].aborted).toBe(true);
    expect(states.at(-1)?.status).toBe("idle");
    expect(states.at(-1)?.selectedCode).toBe(null);
    expect(states.at(-1)?.data).toBe(null);

    // Late resolution after clear must be ignored
    req.resolve(makeDetail("TRG-01", null));
    await Promise.resolve();
    await Promise.resolve();
    expect(states.at(-1)?.status).toBe("idle");
    expect(states.at(-1)?.data).toBe(null);
  });
});
