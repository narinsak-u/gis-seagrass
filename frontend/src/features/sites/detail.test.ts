import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiClientError } from "@/src/lib/api";
import type { SiteDetailFeature } from "./types";
import { createSiteDetailController, type SiteDetailState } from "./detail";

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
    assert.equal(states.at(-1)?.status, "loading");
    assert.equal(states.at(-1)?.selectedCode, "TRG-01");

    const detail = makeDetail("TRG-01", null);
    req.resolve(detail);
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(states.at(-1)?.status, "ready");
    assert.deepEqual(states.at(-1)?.data, detail);
    assert.equal(states.at(-1)?.data?.properties.latest_survey, null);
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

    assert.equal(signals.length, 2);
    assert.equal(signals[0].aborted, true);
    assert.equal(signals[1].aborted, false);

    // SITE-B resolves first
    const detailB = makeDetail("SITE-B", {
      survey_ref: "REF-B",
      surveyed_on: "2025-03-01",
      cover_percent: 64,
    });
    pending[1].resolve(detailB);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(states.at(-1)?.status, "ready");
    assert.equal(states.at(-1)?.data?.properties.code, "SITE-B");

    // Stale SITE-A resolves late — must be ignored
    pending[0].resolve(makeDetail("SITE-A", null));
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(states.at(-1)?.status, "ready");
    assert.equal(states.at(-1)?.data?.properties.code, "SITE-B");
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
    assert.equal(states.at(-1)?.status, "ready");

    // Stale error from SITE-A must not overwrite SITE-B
    pending[0].reject(new ApiClientError(500, "INTERNAL_ERROR", "Upstream failed"));
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(states.at(-1)?.status, "ready");
    assert.equal(states.at(-1)?.data?.properties.code, "SITE-B");

    // Now select SITE-C which fails, then retry and succeed
    controller.select("SITE-C");
    pending[2].reject(new ApiClientError(404, "SITE_NOT_FOUND", "Site not found"));
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(states.at(-1)?.status, "error");
    assert.equal(states.at(-1)?.error?.code, "SITE_NOT_FOUND");

    controller.retry();
    assert.equal(states.at(-1)?.status, "loading");
    pending[3].resolve(makeDetail("SITE-C", null));
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(states.at(-1)?.status, "ready");
    assert.equal(states.at(-1)?.data?.properties.code, "SITE-C");
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

    assert.equal(signals[0].aborted, true);
    assert.equal(states.at(-1)?.status, "idle");
    assert.equal(states.at(-1)?.selectedCode, null);
    assert.equal(states.at(-1)?.data, null);

    // Late resolution after clear must be ignored
    req.resolve(makeDetail("TRG-01", null));
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(states.at(-1)?.status, "idle");
    assert.equal(states.at(-1)?.data, null);
  });
});
