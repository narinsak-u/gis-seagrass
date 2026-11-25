import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { ApiClientError, apiRequest } from "@/src/lib/api";
import { registerSurveyCacheCleanup, useAuthStore } from "../auth-store";

vi.mock("@/src/lib/api", () => ({
  ApiClientError: class ApiClientError extends Error {
    constructor(
      public status: number,
      public code: string,
      message: string,
    ) {
      super(message);
    }
  },
  apiRequest: vi.fn(),
}));

const request = vi.mocked(apiRequest) as Mock;

function loginResponse(token: string) {
  return { access_token: token, token_type: "Bearer", expires_in: 900 };
}

function identity(email: string, role: "viewer" | "editor" | "admin" = "viewer") {
  return { email, role };
}

beforeEach(() => {
  request.mockReset();
  useAuthStore.getState().logout();
  useAuthStore.getState().clearError();
});

describe("authentication session", () => {
  it("logs in then loads validated identity with explicit token into memory", async () => {
    request
      .mockResolvedValueOnce(loginResponse("memory-token"))
      .mockResolvedValueOnce(identity("viewer@example.test"));

    const result = await useAuthStore.getState().login(" viewer@example.test ", "secret");

    expect(result).toEqual(identity("viewer@example.test"));
    expect(request).toHaveBeenNthCalledWith(1, "/auth/login", {
      method: "POST",
      data: { email: "viewer@example.test", password: "secret" },
      signal: expect.any(AbortSignal),
    });
    expect(request).toHaveBeenNthCalledWith(2, "/auth/me", {
      method: "GET",
      token: "memory-token",
      signal: expect.any(AbortSignal),
    });
    expect(useAuthStore.getState()).toMatchObject({
      status: "authenticated",
      token: "memory-token",
      user: identity("viewer@example.test"),
      signInOpen: false,
    });
  });

  it("evicts protected data before publishing replacement identity", async () => {
    request
      .mockResolvedValueOnce(loginResponse("account-a-token"))
      .mockResolvedValueOnce(identity("a@example.test"))
      .mockResolvedValueOnce(loginResponse("account-b-token"))
      .mockResolvedValueOnce(identity("b@example.test"));
    const protectedData = new Map([["site-1", ["account A survey"]]]);
    const publishOrder: string[] = [];
    const unregister = registerSurveyCacheCleanup(() => {
      protectedData.clear();
      publishOrder.push(`cleared:${useAuthStore.getState().user?.email}`);
    });

    try {
      await useAuthStore.getState().login("a@example.test", "secret");
      publishOrder.length = 0;
      await useAuthStore.getState().login("b@example.test", "secret");

      expect(protectedData.size).toBe(0);
      expect(publishOrder[0]).toBe("cleared:a@example.test");
      expect(useAuthStore.getState().user).toEqual(identity("b@example.test"));
    } finally {
      unregister();
    }
  });

  it("ignores stale login and 401 outcomes after account replacement", async () => {
    let resolveOldLogin!: (result: unknown) => void;
    request
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOldLogin = resolve; }))
      .mockResolvedValueOnce(loginResponse("new-token"))
      .mockResolvedValueOnce(identity("new@example.test"));

    const oldLogin = useAuthStore.getState().login("old@example.test", "secret");
    await useAuthStore.getState().login("new@example.test", "secret");
    resolveOldLogin(loginResponse("old-token"));
    await oldLogin;

    const currentEpoch = useAuthStore.getState().sessionEpoch;
    useAuthStore.getState().handleUnauthorized("old request expired", "old-token");
    useAuthStore.getState().handleUnauthorized("same token, old epoch", "new-token", currentEpoch - 1);
    expect(useAuthStore.getState()).toMatchObject({
      status: "authenticated",
      token: "new-token",
      user: identity("new@example.test"),
    });
  });

  it("cancels an in-flight identity request on logout", async () => {
    request
      .mockResolvedValueOnce(loginResponse("active-token"))
      .mockResolvedValueOnce(identity("active@example.test"));
    await useAuthStore.getState().login("active@example.test", "secret");
    let resolveRefresh!: (result: unknown) => void;
    request.mockImplementationOnce((_path, options) => {
      expect(options?.signal?.aborted).toBe(false);
      return new Promise((resolve) => { resolveRefresh = resolve; });
    });

    const refresh = useAuthStore.getState().refreshIdentity();
    let cacheClearedFor: string | null = null;
    const unregister = registerSurveyCacheCleanup(() => {
      cacheClearedFor = useAuthStore.getState().token;
    });
    useAuthStore.getState().logout();
    unregister();
    expect(cacheClearedFor).toBe("active-token");
    resolveRefresh(identity("active@example.test", "admin"));
    await refresh;

    expect(useAuthStore.getState()).toMatchObject({
      status: "anonymous",
      token: null,
      user: null,
    });
  });

  it("preserves authenticated session on 403 and clears it on current-session 401", async () => {
    request
      .mockResolvedValueOnce(loginResponse("active-token"))
      .mockResolvedValueOnce(identity("active@example.test"));
    await useAuthStore.getState().login("active@example.test", "secret");
    request.mockRejectedValueOnce(new ApiClientError(403, "FORBIDDEN", "Not allowed"));

    await useAuthStore.getState().refreshIdentity();
    expect(useAuthStore.getState()).toMatchObject({
      status: "authenticated",
      token: "active-token",
      user: identity("active@example.test"),
      error: { status: 403 },
    });
    let cacheClearedFor: string | null = null;
    const unregister = registerSurveyCacheCleanup(() => {
      cacheClearedFor = useAuthStore.getState().token;
    });
    useAuthStore.getState().handleUnauthorized("Session expired", "active-token");
    unregister();
    expect(cacheClearedFor).toBe("active-token");
    expect(useAuthStore.getState()).toMatchObject({
      status: "anonymous",
      token: null,
      user: null,
      signInOpen: true,
      error: { status: 401 },
    });
  });
});
