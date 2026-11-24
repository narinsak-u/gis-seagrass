import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiClientError } from "@/src/lib/api";
import type { SurveyListItem, SurveyPageResponse } from "./types";
import {
  createSurveyHistoryController,
  type SurveyHistoryFetchRequest,
  type SurveyHistoryState,
} from "./history-controller";

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

function makeSurvey(
  id: string,
  overrides: Partial<SurveyListItem> = {},
): SurveyListItem {
  return {
    id,
    lon: 99.1 + Number(id) * 0.001,
    lat: 7.3 + Number(id) * 0.001,
    surveyed_on: "2025-03-15",
    cover_percent: 65,
    species: ["ENAC"],
    note: `Survey ${id}`,
    created_by: "a0000000-0000-0000-0000-000000000001",
    ...overrides,
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("createSurveyHistoryController", () => {
  it("stays idle with zero requests when no Site is selected, and unauthenticated with zero requests for anonymous visitors", () => {
    const states: SurveyHistoryState[] = [];
    const requests: SurveyHistoryFetchRequest[] = [];

    const controller = createSurveyHistoryController({
      fetchSurveys: (req) => {
        requests.push(req);
        return Promise.resolve({ items: [], total: 0, page: 1 });
      },
      onStateChange: (state) => states.push(state),
    });

    controller.syncContext({ siteCode: null, token: null, role: null });
    assert.equal(controller.getState().status, "idle");
    assert.equal(requests.length, 0);

    controller.syncContext({ siteCode: "TRG-01", token: null, role: null });
    assert.equal(controller.getState().status, "unauthenticated");
    assert.equal(controller.getState().siteCode, "TRG-01");
    assert.equal(controller.getState().items.length, 0);
    assert.equal(controller.getState().points.features.length, 0);
    assert.equal(requests.length, 0);

    // Whitespace-only token is still unauthenticated
    controller.syncContext({ siteCode: "TRG-01", token: "   ", role: "viewer" });
    assert.equal(controller.getState().status, "unauthenticated");
    assert.equal(requests.length, 0);
  });

  it("blocks unauthorized roles without sending any /surveys request", () => {
    const requests: SurveyHistoryFetchRequest[] = [];

    const controller = createSurveyHistoryController({
      fetchSurveys: (req) => {
        requests.push(req);
        return Promise.resolve({ items: [], total: 0, page: 1 });
      },
      onStateChange: () => {},
    });

    controller.syncContext({
      siteCode: "TRG-01",
      token: "valid-token",
      role: "guest" as unknown as null,
    });

    assert.equal(controller.getState().status, "unauthorized_role");
    assert.equal(controller.getState().items.length, 0);
    assert.equal(controller.getState().points.features.length, 0);
    assert.equal(requests.length, 0);
  });

  it("allows viewer, editor, and admin roles to fetch selected-Site surveys with Bearer token and plots real lon/lat points", async () => {
    for (const role of ["viewer", "editor", "admin"] as const) {
      const requests: SurveyHistoryFetchRequest[] = [];
      const req = deferred<SurveyPageResponse>();

      const controller = createSurveyHistoryController({
        pageSize: 5,
        fetchSurveys: (request) => {
          requests.push(request);
          return req.promise;
        },
        onStateChange: () => {},
      });

      controller.syncContext({
        siteCode: "TRG-01",
        token: `${role}-jwt`,
        role,
      });

      assert.equal(controller.getState().status, "loading");
      assert.equal(requests.length, 1);
      assert.equal(requests[0].code, "TRG-01");
      assert.equal(requests[0].page, 1);
      assert.equal(requests[0].pageSize, 5);
      assert.equal(requests[0].token, `${role}-jwt`);

      req.resolve({
        items: [makeSurvey("1", { lon: 99.21, lat: 7.41 })],
        total: 1,
        page: 1,
      });
      await flushMicrotasks();

      const state = controller.getState();
      assert.equal(state.status, "ready");
      assert.equal(state.items.length, 1);
      assert.equal(state.total, 1);
      assert.equal(state.hasMore, false);
      assert.equal(state.isPartialCoverage, false);
      assert.equal(state.points.features.length, 1);
      assert.deepEqual(state.points.features[0].geometry.coordinates, [99.21, 7.41]);
      assert.equal(state.points.features[0].properties.siteCode, "TRG-01");
    }
  });

  it("supports cumulative pagination, deduplicates by id, and accurately tracks partial coverage", async () => {
    const requests: SurveyHistoryFetchRequest[] = [];
    const pending: Array<Deferred<SurveyPageResponse>> = [];

    const controller = createSurveyHistoryController({
      pageSize: 2,
      fetchSurveys: (request) => {
        requests.push(request);
        const d = deferred<SurveyPageResponse>();
        pending.push(d);
        return d.promise;
      },
      onStateChange: () => {},
    });

    controller.syncContext({ siteCode: "TRG-01", token: "tok", role: "viewer" });
    pending[0].resolve({
      items: [makeSurvey("10"), makeSurvey("9")],
      total: 3,
      page: 1,
    });
    await flushMicrotasks();

    let state = controller.getState();
    assert.equal(state.status, "ready");
    assert.equal(state.items.length, 2);
    assert.equal(state.points.features.length, 2);
    assert.equal(state.loadedPages, 1);
    assert.equal(state.total, 3);
    assert.equal(state.hasMore, true);
    assert.equal(state.isPartialCoverage, true);

    // Load page 2 (including a duplicate id "9" to verify deduplication)
    controller.loadNextPage();
    assert.equal(controller.getState().status, "loading_more");
    assert.equal(requests.length, 2);
    assert.equal(requests[1].page, 2);
    assert.equal(requests[1].pageSize, 2);

    pending[1].resolve({
      items: [makeSurvey("9"), makeSurvey("8")],
      total: 3,
      page: 2,
    });
    await flushMicrotasks();

    state = controller.getState();
    assert.equal(state.status, "ready");
    assert.deepEqual(
      state.items.map((item) => item.id),
      ["10", "9", "8"],
    );
    assert.equal(state.points.features.length, 3);
    assert.equal(state.loadedPages, 2);
    assert.equal(state.hasMore, false);
    assert.equal(state.isPartialCoverage, false);

    // Further loadNextPage is a no-op once all pages are loaded
    controller.loadNextPage();
    assert.equal(requests.length, 2);
  });

  it("transitions to explicit empty state when total is 0", async () => {
    const req = deferred<SurveyPageResponse>();
    const controller = createSurveyHistoryController({
      fetchSurveys: () => req.promise,
      onStateChange: () => {},
    });

    controller.syncContext({ siteCode: "TRG-EMPTY", token: "tok", role: "editor" });
    req.resolve({ items: [], total: 0, page: 1 });
    await flushMicrotasks();

    const state = controller.getState();
    assert.equal(state.status, "empty");
    assert.equal(state.items.length, 0);
    assert.equal(state.points.features.length, 0);
    assert.equal(state.total, 0);
    assert.equal(state.hasMore, false);
    assert.equal(state.isPartialCoverage, false);
  });

  it("immediately clears previous Site items/points on Site change and ignores stale responses", async () => {
    const signals: AbortSignal[] = [];
    const pending: Array<Deferred<SurveyPageResponse>> = [];

    const controller = createSurveyHistoryController({
      fetchSurveys: ({ signal }) => {
        signals.push(signal);
        const d = deferred<SurveyPageResponse>();
        pending.push(d);
        return d.promise;
      },
      onStateChange: () => {},
    });

    // Load Site A first
    controller.syncContext({ siteCode: "SITE-A", token: "tok", role: "viewer" });
    pending[0].resolve({
      items: [makeSurvey("1", { lon: 99.11, lat: 7.11 })],
      total: 2,
      page: 1,
    });
    await flushMicrotasks();
    assert.equal(controller.getState().points.features.length, 1);

    // Start page 2 for Site A, then immediately switch to Site B
    controller.loadNextPage();
    assert.equal(signals.length, 2);
    assert.equal(signals[1].aborted, false);

    controller.syncContext({ siteCode: "SITE-B", token: "tok", role: "viewer" });
    // Previous in-flight request aborted & Site A items/points immediately cleared
    assert.equal(signals[1].aborted, true);
    assert.equal(controller.getState().siteCode, "SITE-B");
    assert.equal(controller.getState().status, "loading");
    assert.equal(controller.getState().items.length, 0);
    assert.equal(controller.getState().points.features.length, 0);

    // Site B resolves
    pending[2].resolve({
      items: [makeSurvey("20", { lon: 98.44, lat: 8.12 })],
      total: 1,
      page: 1,
    });
    await flushMicrotasks();
    assert.equal(controller.getState().status, "ready");
    assert.deepEqual(
      controller.getState().points.features.map((f) => f.properties.siteCode),
      ["SITE-B"],
    );

    // Late stale response from Site A arrives — must be ignored!
    pending[1].resolve({
      items: [makeSurvey("2", { lon: 99.12, lat: 7.12 })],
      total: 2,
      page: 2,
    });
    await flushMicrotasks();

    assert.equal(controller.getState().siteCode, "SITE-B");
    assert.deepEqual(
      controller.getState().items.map((item) => item.id),
      ["20"],
    );
    assert.deepEqual(
      controller.getState().points.features.map((f) => f.properties.siteCode),
      ["SITE-B"],
    );
  });

  it("clears items and points immediately on sign-out and ignores late in-flight responses", async () => {
    const signals: AbortSignal[] = [];
    const req = deferred<SurveyPageResponse>();

    const controller = createSurveyHistoryController({
      fetchSurveys: ({ signal }) => {
        signals.push(signal);
        return req.promise;
      },
      onStateChange: () => {},
    });

    controller.syncContext({ siteCode: "TRG-01", token: "tok", role: "admin" });
    controller.syncContext({ siteCode: "TRG-01", token: null, role: null });

    assert.equal(signals[0].aborted, true);
    assert.equal(controller.getState().status, "unauthenticated");
    assert.equal(controller.getState().items.length, 0);
    assert.equal(controller.getState().points.features.length, 0);

    req.resolve({ items: [makeSurvey("99")], total: 1, page: 1 });
    await flushMicrotasks();

    assert.equal(controller.getState().status, "unauthenticated");
    assert.equal(controller.getState().items.length, 0);
    assert.equal(controller.getState().points.features.length, 0);
  });

  it("on 401 immediately clears loaded items/points and invokes onUnauthorized", async () => {
    const unauthorizedMessages: string[] = [];
    const pending: Array<Deferred<SurveyPageResponse>> = [];

    const controller = createSurveyHistoryController({
      pageSize: 1,
      fetchSurveys: () => {
        const d = deferred<SurveyPageResponse>();
        pending.push(d);
        return d.promise;
      },
      onStateChange: () => {},
      onUnauthorized: (message) => unauthorizedMessages.push(message),
    });

    // Load page 1 successfully first
    controller.syncContext({ siteCode: "TRG-01", token: "expiring-tok", role: "viewer" });
    pending[0].resolve({ items: [makeSurvey("1")], total: 2, page: 1 });
    await flushMicrotasks();
    assert.equal(controller.getState().items.length, 1);
    assert.equal(controller.getState().points.features.length, 1);

    // Page 2 returns 401 (expired token)
    controller.loadNextPage();
    pending[1].reject(
      new ApiClientError(401, "UNAUTHORIZED", "Access token has expired"),
    );
    await flushMicrotasks();

    const state = controller.getState();
    assert.equal(state.status, "unauthenticated");
    assert.equal(state.siteCode, "TRG-01");
    assert.equal(state.items.length, 0);
    assert.equal(state.points.features.length, 0);
    assert.deepEqual(unauthorizedMessages, ["Access token has expired"]);
  });

  it("on 403 immediately clears items/points, transitions to forbidden with API message, and does not trigger onUnauthorized", async () => {
    const unauthorizedMessages: string[] = [];
    const pending: Array<Deferred<SurveyPageResponse>> = [];

    const controller = createSurveyHistoryController({
      fetchSurveys: () => {
        const d = deferred<SurveyPageResponse>();
        pending.push(d);
        return d.promise;
      },
      onStateChange: () => {},
      onUnauthorized: (message) => unauthorizedMessages.push(message),
    });

    controller.syncContext({ siteCode: "TRG-01", token: "tok", role: "viewer" });
    pending[0].reject(
      new ApiClientError(403, "FORBIDDEN", "Insufficient role for survey history"),
    );
    await flushMicrotasks();

    const state = controller.getState();
    assert.equal(state.status, "forbidden");
    assert.equal(state.items.length, 0);
    assert.equal(state.points.features.length, 0);
    assert.equal(state.error?.code, "FORBIDDEN");
    assert.equal(state.error?.message, "Insufficient role for survey history");
    assert.equal(unauthorizedMessages.length, 0);
  });

  it("supports retry recovery for both initial load errors and load-more errors", async () => {
    const requests: SurveyHistoryFetchRequest[] = [];
    const pending: Array<Deferred<SurveyPageResponse>> = [];

    const controller = createSurveyHistoryController({
      pageSize: 1,
      fetchSurveys: (request) => {
        requests.push(request);
        const d = deferred<SurveyPageResponse>();
        pending.push(d);
        return d.promise;
      },
      onStateChange: () => {},
    });

    // Initial load fails with 503
    controller.syncContext({ siteCode: "TRG-01", token: "tok", role: "editor" });
    pending[0].reject(
      new ApiClientError(503, "SERVICE_UNAVAILABLE", "Database temporarily unavailable"),
    );
    await flushMicrotasks();

    assert.equal(controller.getState().status, "error");
    assert.equal(
      controller.getState().error?.message,
      "Database temporarily unavailable",
    );
    assert.equal(controller.getState().items.length, 0);

    // Retry page 1 succeeds
    controller.retry();
    assert.equal(controller.getState().status, "loading");
    assert.equal(requests[1].page, 1);
    pending[1].resolve({ items: [makeSurvey("1")], total: 2, page: 1 });
    await flushMicrotasks();

    assert.equal(controller.getState().status, "ready");
    assert.equal(controller.getState().items.length, 1);

    // Load page 2 fails with network error — keeps page 1 items/points visible
    controller.loadNextPage();
    pending[2].reject(new Error("Network offline"));
    await flushMicrotasks();

    assert.equal(controller.getState().status, "error");
    assert.equal(controller.getState().error?.message, "Network offline");
    assert.equal(controller.getState().items.length, 1);
    assert.equal(controller.getState().points.features.length, 1);

    // Retry retries page 2 (not page 1!)
    controller.retry();
    assert.equal(controller.getState().status, "loading_more");
    assert.equal(requests[3].page, 2);
    pending[3].resolve({ items: [makeSurvey("2")], total: 2, page: 2 });
    await flushMicrotasks();

    assert.equal(controller.getState().status, "ready");
    assert.equal(controller.getState().items.length, 2);
    assert.equal(controller.getState().points.features.length, 2);
    assert.equal(controller.getState().hasMore, false);
  });
});
