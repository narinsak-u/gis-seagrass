import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BboxBounds, SiteFeature, SiteFeatureCollection } from "./types";
import { createViewportSitesController, formatBbox, type ViewportSitesState } from "./viewport";

function makeSite(code: string, siteStatus: SiteFeature["properties"]["siteStatus"]): SiteFeature {
  return {
    type: "Feature",
    geometry: {
      type: "MultiPolygon",
      coordinates: [[[[98.5, 7.5], [98.6, 7.5], [98.6, 7.6], [98.5, 7.6], [98.5, 7.5]]]],
    },
    properties: {
      code,
      name: `Site ${code}`,
      province_code: "92",
      area_rai: 120,
      version: 1,
      siteStatus,
    },
  };
}

function makeCollection(...features: SiteFeature[]): SiteFeatureCollection {
  return { type: "FeatureCollection", features };
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

class FakeScheduler {
  private nextId = 1;
  private timers = new Map<number, { fn: () => void; runAt: number }>();
  now = 0;

  setTimeout = (fn: () => void, ms: number): number => {
    const id = this.nextId++;
    this.timers.set(id, { fn, runAt: this.now + ms });
    return id;
  };

  clearTimeout = (id: number): void => {
    this.timers.delete(id);
  };

  advance(ms: number): void {
    this.now += ms;
    const due = [...this.timers.entries()]
      .filter(([, timer]) => timer.runAt <= this.now)
      .sort((a, b) => a[1].runAt - b[1].runAt);
    for (const [id, timer] of due) {
      if (this.timers.delete(id)) {
        timer.fn();
      }
    }
  }
}

describe("formatBbox", () => {
  it("formats WGS84 bounds strictly as minLon,minLat,maxLon,maxLat", () => {
    const bbox = formatBbox({
      minLon: 98.1234567,
      minLat: 7.05,
      maxLon: 99.6,
      maxLat: 9.0342091,
    });
    assert.equal(bbox, "98.123457,7.05,99.6,9.034209");
  });

  it("clamps wrapped or out-of-range bounds to valid WGS84 ranges", () => {
    const bbox = formatBbox({
      minLon: -210,
      minLat: -95,
      maxLon: 205,
      maxLat: 92,
    });
    assert.equal(bbox, "-180,-90,180,90");
  });
});

describe("createViewportSitesController", () => {
  const initialBounds: BboxBounds = { minLon: 98.0, minLat: 7.0, maxLon: 99.5, maxLat: 9.0 };
  const movedBoundsA: BboxBounds = { minLon: 98.2, minLat: 7.2, maxLon: 99.2, maxLat: 8.5 };
  const movedBoundsB: BboxBounds = { minLon: 98.5, minLat: 7.5, maxLon: 99.0, maxLat: 8.2 };

  it("loads immediately on initial viewport and transitions to ready or empty", async () => {
    const states: ViewportSitesState[] = [];
    const requests: string[] = [];
    const req1 = deferred<SiteFeatureCollection>();

    const controller = createViewportSitesController({
      debounceMs: 250,
      fetchSites: ({ bbox }) => {
        requests.push(bbox);
        return req1.promise;
      },
      onStateChange: (state) => states.push(state),
    });

    controller.loadInitial(initialBounds);
    assert.deepEqual(requests, ["98,7,99.5,9"]);
    assert.equal(states.at(-1)?.status, "loading");

    req1.resolve(makeCollection(makeSite("S-01", "very_good")));
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(states.at(-1)?.status, "ready");
    assert.equal(states.at(-1)?.data?.features.length, 1);
    assert.equal(states.at(-1)?.data?.features[0].properties.code, "S-01");
  });

  it("transitions to empty when viewport returns zero active Sites", async () => {
    const states: ViewportSitesState[] = [];
    const controller = createViewportSitesController({
      debounceMs: 250,
      fetchSites: async () => makeCollection(),
      onStateChange: (state) => states.push(state),
    });

    controller.loadInitial(initialBounds);
    await new Promise((r) => setTimeout(r, 0));

    assert.equal(states.at(-1)?.status, "empty");
    assert.deepEqual(states.at(-1)?.data?.features, []);
  });

  it("debounces rapid settled moves and only requests the final settled viewport", async () => {
    const scheduler = new FakeScheduler();
    const requests: string[] = [];
    const controller = createViewportSitesController({
      debounceMs: 250,
      scheduler,
      fetchSites: async ({ bbox }) => {
        requests.push(bbox);
        return makeCollection(makeSite("S-FINAL", "good"));
      },
      onStateChange: () => {},
    });

    controller.onViewportSettled(initialBounds);
    scheduler.advance(100);
    controller.onViewportSettled(movedBoundsA);
    scheduler.advance(150);
    controller.onViewportSettled(movedBoundsB);
    scheduler.advance(249);
    assert.deepEqual(requests, []);

    scheduler.advance(1);
    assert.deepEqual(requests, ["98.5,7.5,99,8.2"]);
  });

  it("aborts superseded requests and ignores a stale success after a newer success", async () => {
    const scheduler = new FakeScheduler();
    const states: ViewportSitesState[] = [];
    const signals: AbortSignal[] = [];
    const pending: Array<Deferred<SiteFeatureCollection>> = [];

    const controller = createViewportSitesController({
      debounceMs: 100,
      scheduler,
      fetchSites: ({ signal }) => {
        signals.push(signal);
        const d = deferred<SiteFeatureCollection>();
        pending.push(d);
        return d.promise;
      },
      onStateChange: (state) => states.push(state),
    });

    controller.loadInitial(initialBounds);
    controller.onViewportSettled(movedBoundsB);
    scheduler.advance(100);

    assert.equal(signals.length, 2);
    assert.equal(signals[0].aborted, true);
    assert.equal(signals[1].aborted, false);

    // Newer request resolves first
    pending[1].resolve(makeCollection(makeSite("NEWER", "fair")));
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(states.at(-1)?.data?.features[0].properties.code, "NEWER");

    // Stale older request resolves late (e.g. fetch ignored abort)
    pending[0].resolve(makeCollection(makeSite("STALE", "poor")));
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(states.at(-1)?.status, "ready");
    assert.equal(states.at(-1)?.data?.features[0].properties.code, "NEWER");
  });

  it("prevents a stale success from overwriting a newer request failure", async () => {
    const scheduler = new FakeScheduler();
    const states: ViewportSitesState[] = [];
    const pending: Array<Deferred<SiteFeatureCollection>> = [];

    const controller = createViewportSitesController({
      debounceMs: 100,
      scheduler,
      fetchSites: () => {
        const d = deferred<SiteFeatureCollection>();
        pending.push(d);
        return d.promise;
      },
      onStateChange: (state) => states.push(state),
    });

    controller.loadInitial(initialBounds);
    controller.onViewportSettled(movedBoundsB);
    scheduler.advance(100);

    // Newer request fails
    pending[1].reject(new Error("Gateway timeout"));
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(states.at(-1)?.status, "error");
    assert.match(states.at(-1)?.error?.message ?? "", /Gateway timeout/);

    // Older request resolves after newer failure — must be ignored
    pending[0].resolve(makeCollection(makeSite("STALE-AFTER-ERROR", "good")));
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(states.at(-1)?.status, "error");
    assert.match(states.at(-1)?.error?.message ?? "", /Gateway timeout/);
  });

  it("prevents a stale failure from overwriting a newer request success and supports retry", async () => {
    const scheduler = new FakeScheduler();
    const states: ViewportSitesState[] = [];
    const pending: Array<Deferred<SiteFeatureCollection>> = [];

    const controller = createViewportSitesController({
      debounceMs: 100,
      scheduler,
      fetchSites: () => {
        const d = deferred<SiteFeatureCollection>();
        pending.push(d);
        return d.promise;
      },
      onStateChange: (state) => states.push(state),
    });

    controller.loadInitial(initialBounds);
    controller.onViewportSettled(movedBoundsA);
    scheduler.advance(100);

    // Newer succeeds first
    pending[1].resolve(makeCollection(makeSite("FRESH", "no_data")));
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(states.at(-1)?.status, "ready");

    // Stale older request rejects late — must be ignored
    pending[0].reject(new Error("Old network failure"));
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(states.at(-1)?.status, "ready");
    assert.equal(states.at(-1)?.data?.features[0].properties.code, "FRESH");

    // Trigger a failure on a newer move, then retry and succeed
    controller.onViewportSettled(movedBoundsB);
    scheduler.advance(100);
    pending[2].reject(new Error("Temporary outage"));
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(states.at(-1)?.status, "error");

    controller.retry();
    assert.equal(states.at(-1)?.status, "loading");
    pending[3].resolve(makeCollection(makeSite("RECOVERED", "very_good")));
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(states.at(-1)?.status, "ready");
    assert.equal(states.at(-1)?.data?.features[0].properties.code, "RECOVERED");
  });

  it("ignores a late response from an older viewport when a newer settled move is queued for debounce", async () => {
    const scheduler = new FakeScheduler();
    const states: ViewportSitesState[] = [];
    const pending: Array<Deferred<SiteFeatureCollection>> = [];

    const controller = createViewportSitesController({
      debounceMs: 200,
      scheduler,
      fetchSites: () => {
        const d = deferred<SiteFeatureCollection>();
        pending.push(d);
        return d.promise;
      },
      onStateChange: (state) => states.push(state),
    });

    controller.loadInitial(initialBounds);
    controller.onViewportSettled(movedBoundsB);

    // Before debounce fires for movedBoundsB, initialBounds resolves late
    pending[0].resolve(makeCollection(makeSite("OLD-VIEW", "poor")));
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(states.at(-1)?.data, null);

    // Debounce fires and movedBoundsB succeeds
    scheduler.advance(200);
    pending[1].resolve(makeCollection(makeSite("NEW-VIEW", "very_good")));
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(states.at(-1)?.status, "ready");
    assert.equal(states.at(-1)?.data?.features[0].properties.code, "NEW-VIEW");
  });
});
