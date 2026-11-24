import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createAuthSessionController,
  type AuthSessionState,
} from "./auth-session";

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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createAuthSessionController", () => {
  it("logs in via POST /api/auth/login then fetches /api/auth/me in memory without touching web storage", async () => {
    const calls: Array<{ url: string; method: string; auth: string | null; body: string | null }> = [];
    let storageTouched = false;

    const originalLocalStorage = (globalThis as Record<string, unknown>).localStorage;
    const originalSessionStorage = (globalThis as Record<string, unknown>).sessionStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        storageTouched = true;
        return {};
      },
    });
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      get() {
        storageTouched = true;
        return {};
      },
    });

    try {
      const fakeFetch: typeof fetch = async (input, init) => {
        const url = String(input);
        const headers = new Headers(init?.headers);
        calls.push({
          url,
          method: init?.method ?? "GET",
          auth: headers.get("authorization"),
          body: typeof init?.body === "string" ? init.body : null,
        });
        if (url === "/api/auth/login") {
          return jsonResponse({
            access_token: "jwt-abc-123",
            token_type: "Bearer",
            expires_in: 900,
          });
        }
        if (url === "/api/auth/me") {
          return jsonResponse({
            email: "dev-viewer@example.test",
            role: "viewer",
          });
        }
        throw new Error(`Unexpected URL ${url}`);
      };

      const states: AuthSessionState[] = [];
      const controller = createAuthSessionController({ fetchImpl: fakeFetch });
      controller.subscribe((next) => states.push(next));
      controller.setSignInOpen(true);

      const user = await controller.login(" dev-viewer@example.test ", "dev-viewer-password");

      assert.deepEqual(user, { email: "dev-viewer@example.test", role: "viewer" });
      assert.equal(storageTouched, false);
      assert.deepEqual(calls, [
        {
          url: "/api/auth/login",
          method: "POST",
          auth: null,
          body: JSON.stringify({
            email: "dev-viewer@example.test",
            password: "dev-viewer-password",
          }),
        },
        {
          url: "/api/auth/me",
          method: "GET",
          auth: "Bearer jwt-abc-123",
          body: null,
        },
      ]);

      assert.equal(states.some((s) => s.status === "authenticating"), true);
      const finalState = controller.getState();
      assert.equal(finalState.status, "authenticated");
      assert.equal(finalState.token, "jwt-abc-123");
      assert.deepEqual(finalState.user, { email: "dev-viewer@example.test", role: "viewer" });
      assert.equal(finalState.error, null);
      assert.equal(finalState.signInOpen, false);
    } finally {
      if (originalLocalStorage === undefined) {
        delete (globalThis as Record<string, unknown>).localStorage;
      } else {
        Object.defineProperty(globalThis, "localStorage", {
          configurable: true,
          value: originalLocalStorage,
        });
      }
      if (originalSessionStorage === undefined) {
        delete (globalThis as Record<string, unknown>).sessionStorage;
      } else {
        Object.defineProperty(globalThis, "sessionStorage", {
          configurable: true,
          value: originalSessionStorage,
        });
      }
    }
  });

  it("surfaces the shared API error envelope on failed login and keeps sign-in open", async () => {
    const fakeFetch: typeof fetch = async () =>
      jsonResponse(
        {
          error: {
            code: "UNAUTHORIZED",
            message: "Invalid email or password",
            details: {},
          },
        },
        401,
      );

    const controller = createAuthSessionController({ fetchImpl: fakeFetch });
    controller.setSignInOpen(true);

    const result = await controller.login("viewer@example.test", "wrong-pass");

    assert.equal(result, null);
    const state = controller.getState();
    assert.equal(state.status, "error");
    assert.equal(state.token, null);
    assert.equal(state.user, null);
    assert.equal(state.signInOpen, true);
    assert.deepEqual(state.error, {
      code: "UNAUTHORIZED",
      message: "Invalid email or password",
      status: 401,
    });
  });

  it("discards the token if GET /api/auth/me rejects after POST /api/auth/login", async () => {
    const fakeFetch: typeof fetch = async (input) => {
      if (String(input) === "/api/auth/login") {
        return jsonResponse({ access_token: "short-lived", token_type: "Bearer", expires_in: 900 });
      }
      return jsonResponse(
        { error: { code: "UNAUTHORIZED", message: "Authentication required", details: {} } },
        401,
      );
    };

    const controller = createAuthSessionController({ fetchImpl: fakeFetch });
    const result = await controller.login("viewer@example.test", "pw");

    assert.equal(result, null);
    assert.equal(controller.getState().token, null);
    assert.equal(controller.getState().user, null);
    assert.equal(controller.getState().status, "error");
    assert.equal(controller.getState().error?.message, "Authentication required");
  });

  it("refreshes current role from /api/auth/me and clears session on 401", async () => {
    let meCalls = 0;
    const fakeFetch: typeof fetch = async (input) => {
      if (String(input) === "/api/auth/login") {
        return jsonResponse({ access_token: "tok-1", token_type: "Bearer", expires_in: 900 });
      }
      meCalls += 1;
      if (meCalls === 1) {
        return jsonResponse({ email: "user@example.test", role: "viewer" });
      }
      if (meCalls === 2) {
        return jsonResponse({ email: "user@example.test", role: "editor" });
      }
      return jsonResponse(
        { error: { code: "UNAUTHORIZED", message: "Authentication required", details: {} } },
        401,
      );
    };

    const controller = createAuthSessionController({ fetchImpl: fakeFetch });
    await controller.login("user@example.test", "secret");
    assert.equal(controller.getState().user?.role, "viewer");

    const refreshed = await controller.refreshIdentity();
    assert.deepEqual(refreshed, { email: "user@example.test", role: "editor" });
    assert.equal(controller.getState().user?.role, "editor");

    const afterExpiry = await controller.refreshIdentity();
    assert.equal(afterExpiry, null);
    const state = controller.getState();
    assert.equal(state.token, null);
    assert.equal(state.user, null);
    assert.equal(state.status, "anonymous");
    assert.equal(state.signInOpen, true);
    assert.equal(state.error?.status, 401);
  });

  it("logout clears session immediately and ignores late in-flight login responses", async () => {
    const loginPending = deferred<Response>();
    const signals: AbortSignal[] = [];

    const fakeFetch: typeof fetch = (_input, init) => {
      if (init?.signal) signals.push(init.signal);
      return loginPending.promise;
    };

    const controller = createAuthSessionController({ fetchImpl: fakeFetch });
    const loginPromise = controller.login("viewer@example.test", "secret");

    controller.logout();
    assert.equal(signals[0]?.aborted, true);

    loginPending.resolve(
      jsonResponse({ access_token: "stale-token", token_type: "Bearer", expires_in: 900 }),
    );
    const result = await loginPromise;

    assert.equal(result, null);
    assert.equal(controller.getState().token, null);
    assert.equal(controller.getState().user, null);
    assert.equal(controller.getState().status, "anonymous");
    assert.equal(controller.getState().signInOpen, false);
  });

  it("handleUnauthorized clears token and identity and opens sign-in with recoverable message", async () => {
    const fakeFetch: typeof fetch = async (input) => {
      if (String(input) === "/api/auth/login") {
        return jsonResponse({ access_token: "tok-active", token_type: "Bearer", expires_in: 900 });
      }
      return jsonResponse({ email: "admin@example.test", role: "admin" });
    };

    const controller = createAuthSessionController({ fetchImpl: fakeFetch });
    await controller.login("admin@example.test", "secret");
    assert.equal(controller.getState().token, "tok-active");

    controller.handleUnauthorized("Token expired. Please sign in again.");
    const state = controller.getState();
    assert.equal(state.token, null);
    assert.equal(state.user, null);
    assert.equal(state.status, "anonymous");
    assert.equal(state.signInOpen, true);
    assert.equal(state.error?.code, "UNAUTHORIZED");
    assert.equal(state.error?.message, "Token expired. Please sign in again.");
  });
});
