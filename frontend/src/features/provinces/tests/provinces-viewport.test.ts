import { describe, expect, it } from "vitest";
import { ApiClientError } from "@/src/lib/api";
import type { BboxBounds } from "@/src/features/sites/types";
import { fetchProvincesGeoJson } from "../api";
import {
  createViewportProvincesController,
  type ViewportProvincesState,
} from "../provinces-viewport";
import type { ProvinceFeature, ProvinceFeatureCollection } from "../types";

function makeProvince(code: string, nameTh: string): ProvinceFeature {
  return {
    type: "Feature",
    geometry: {
      type: "MultiPolygon",
      coordinates: [[[[98.0, 7.0], [99.0, 7.0], [99.0, 8.0], [98.0, 8.0], [98.0, 7.0]]]],
    },
    properties: {
      code,
      name_th: nameTh,
    },
  };
}

function makeCollection(...features: ProvinceFeature[]): ProvinceFeatureCollection {
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

describe("fetchProvincesGeoJson", () => {
  it("calls /api/provinces.geojson with WGS84 bbox and AbortSignal", async () => {
    const calls: Array<{ url: string; signal: AbortSignal | undefined }> = [];
    const controller = new AbortController();
    const expected = makeCollection(makeProvince("81", "กระบี่"));

    const result = await fetchProvincesGeoJson({
      bbox: "98.5,7.2,99.4,8.6",
      signal: controller.signal,
      fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(input), signal: init?.signal ?? undefined });
        return new Response(JSON.stringify(expected), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as typeof fetch,
    });

    expect(result).toEqual(expected);
    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe("/api/provinces.geojson?bbox=98.5%2C7.2%2C99.4%2C8.6");
    expect(calls[0].signal).toBe(controller.signal);
  });

  it("throws ApiClientError parsed from the shared error envelope on invalid bbox or server errors", async () => {
    const request = fetchProvincesGeoJson({
      bbox: "invalid",
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({
            error: { code: "INVALID_BBOX", message: "Invalid bbox", details: {} },
          }),
          { status: 400, headers: { "content-type": "application/json" } },
        )) as typeof fetch,
    });

    await expect(request).rejects.toBeInstanceOf(ApiClientError);
    await expect(request).rejects.toMatchObject({
      status: 400,
      code: "INVALID_BBOX",
      message: "Invalid bbox",
    });
  });
});

describe("createViewportProvincesController", () => {
  const initialBounds: BboxBounds = { minLon: 98.0, minLat: 7.0, maxLon: 99.5, maxLat: 9.0 };
  const movedBoundsA: BboxBounds = { minLon: 98.4, minLat: 7.2, maxLon: 99.3, maxLat: 8.6 };
  const movedBoundsB: BboxBounds = { minLon: 99.0, minLat: 7.4, maxLon: 100.2, maxLat: 8.4 };

  it("loads immediately on initial viewport and transitions to ready with code and name_th", async () => {
    const states: ViewportProvincesState[] = [];
    const requests: string[] = [];
    const req1 = deferred<ProvinceFeatureCollection>();

    const controller = createViewportProvincesController({
      debounceMs: 250,
      fetchProvinces: ({ bbox }) => {
        requests.push(bbox);
        return req1.promise;
      },
      onStateChange: (state) => states.push(state),
    });

    controller.loadInitial(initialBounds);
    expect(requests).toEqual(["98,7,99.5,9"]);
    expect(states.at(-1)?.status).toBe("loading");

    req1.resolve(makeCollection(makeProvince("81", "กระบี่"), makeProvince("92", "ตรัง")));
    await Promise.resolve();
    await Promise.resolve();

    expect(states.at(-1)?.status).toBe("ready");
    expect(states.at(-1)?.data?.features.map((f) => f.properties)).toEqual([
      { code: "81", name_th: "กระบี่" },
      { code: "92", name_th: "ตรัง" },
    ]);
  });

  it("replaces previous boundaries and transitions to empty when viewport has zero provinces", async () => {
    const scheduler = new FakeScheduler();
    const states: ViewportProvincesState[] = [];
    let call = 0;

    const controller = createViewportProvincesController({
      debounceMs: 100,
      scheduler,
      fetchProvinces: async () => {
        call += 1;
        return call === 1 ? makeCollection(makeProvince("81", "กระบี่")) : makeCollection();
      },
      onStateChange: (state) => states.push(state),
    });

    controller.loadInitial(initialBounds);
    await new Promise((r) => setTimeout(r, 0));
    expect(states.at(-1)?.status).toBe("ready");
    expect(states.at(-1)?.data?.features.length).toBe(1);

    controller.onViewportSettled(movedBoundsB);
    scheduler.advance(100);
    await new Promise((r) => setTimeout(r, 0));

    expect(states.at(-1)?.status).toBe("empty");
    expect(states.at(-1)?.data?.features).toEqual([]);
  });

  it("debounces rapid settled moves and requests only the final settled viewport", async () => {
    const scheduler = new FakeScheduler();
    const requests: string[] = [];

    const controller = createViewportProvincesController({
      debounceMs: 250,
      scheduler,
      fetchProvinces: async ({ bbox }) => {
        requests.push(bbox);
        return makeCollection(makeProvince("92", "ตรัง"));
      },
      onStateChange: () => {},
    });

    controller.onViewportSettled(initialBounds);
    scheduler.advance(100);
    controller.onViewportSettled(movedBoundsA);
    scheduler.advance(150);
    controller.onViewportSettled(movedBoundsB);
    scheduler.advance(249);
    expect(requests).toEqual([]);

    scheduler.advance(1);
    expect(requests).toEqual(["99,7.4,100.2,8.4"]);
  });

  it("aborts superseded requests and ignores stale success after newer success", async () => {
    const scheduler = new FakeScheduler();
    const states: ViewportProvincesState[] = [];
    const signals: AbortSignal[] = [];
    const pending: Array<Deferred<ProvinceFeatureCollection>> = [];

    const controller = createViewportProvincesController({
      debounceMs: 100,
      scheduler,
      fetchProvinces: ({ signal }) => {
        signals.push(signal);
        const d = deferred<ProvinceFeatureCollection>();
        pending.push(d);
        return d.promise;
      },
      onStateChange: (state) => states.push(state),
    });

    controller.loadInitial(initialBounds);
    controller.onViewportSettled(movedBoundsB);
    scheduler.advance(100);

    expect(signals.length).toBe(2);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);

    pending[1].resolve(makeCollection(makeProvince("92", "ตรัง")));
    await Promise.resolve();
    await Promise.resolve();
    expect(states.at(-1)?.data?.features[0].properties.code).toBe("92");

    // Stale older response resolves late — must not overwrite current layer
    pending[0].resolve(makeCollection(makeProvince("81", "กระบี่")));
    await Promise.resolve();
    await Promise.resolve();

    expect(states.at(-1)?.status).toBe("ready");
    expect(states.at(-1)?.data?.features[0].properties.code).toBe("92");
  });

  it("ignores stale responses across errors and supports retry recovery", async () => {
    const scheduler = new FakeScheduler();
    const states: ViewportProvincesState[] = [];
    const pending: Array<Deferred<ProvinceFeatureCollection>> = [];

    const controller = createViewportProvincesController({
      debounceMs: 100,
      scheduler,
      fetchProvinces: () => {
        const d = deferred<ProvinceFeatureCollection>();
        pending.push(d);
        return d.promise;
      },
      onStateChange: (state) => states.push(state),
    });

    controller.loadInitial(initialBounds);
    controller.onViewportSettled(movedBoundsA);
    scheduler.advance(100);

    // Newer fails
    pending[1].reject(new ApiClientError(502, "UPSTREAM_UNAVAILABLE", "API unavailable"));
    await Promise.resolve();
    await Promise.resolve();
    expect(states.at(-1)?.status).toBe("error");
    expect(states.at(-1)?.error?.code).toBe("UPSTREAM_UNAVAILABLE");

    // Older succeeds late — must not overwrite newer error
    pending[0].resolve(makeCollection(makeProvince("81", "กระบี่")));
    await Promise.resolve();
    await Promise.resolve();
    expect(states.at(-1)?.status).toBe("error");

    // Retry recovers
    controller.retry();
    expect(states.at(-1)?.status).toBe("loading");
    pending[2].resolve(makeCollection(makeProvince("82", "พังงา")));
    await Promise.resolve();
    await Promise.resolve();
    expect(states.at(-1)?.status).toBe("ready");
    expect(states.at(-1)?.data?.features[0].properties.code).toBe("82");
  });

  it("ignores a late response from an older viewport while a newer move is debouncing", async () => {
    const scheduler = new FakeScheduler();
    const states: ViewportProvincesState[] = [];
    const pending: Array<Deferred<ProvinceFeatureCollection>> = [];

    const controller = createViewportProvincesController({
      debounceMs: 200,
      scheduler,
      fetchProvinces: () => {
        const d = deferred<ProvinceFeatureCollection>();
        pending.push(d);
        return d.promise;
      },
      onStateChange: (state) => states.push(state),
    });

    controller.loadInitial(initialBounds);
    controller.onViewportSettled(movedBoundsB);

    pending[0].resolve(makeCollection(makeProvince("81", "กระบี่")));
    await Promise.resolve();
    await Promise.resolve();
    expect(states.at(-1)?.data).toBe(null);

    scheduler.advance(200);
    pending[1].resolve(makeCollection(makeProvince("92", "ตรัง")));
    await Promise.resolve();
    await Promise.resolve();
    expect(states.at(-1)?.status).toBe("ready");
    expect(states.at(-1)?.data?.features[0].properties.code).toBe("92");
  });
});
