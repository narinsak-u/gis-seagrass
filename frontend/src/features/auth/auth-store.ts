import { create } from "zustand";
import { ApiClientError } from "@/src/lib/api";
import {
  fetchCurrentIdentity,
  loginWithPassword,
  type AuthSessionError,
  type AuthSessionState,
  type AuthSessionStatus,
  type CurrentUser,
} from "./auth-session";

interface AuthStore extends AuthSessionState {
  sessionEpoch: number;
  setSignInOpen: (open: boolean) => void;
  clearError: () => void;
  login: (email: string, password: string) => Promise<CurrentUser | null>;
  refreshIdentity: () => Promise<CurrentUser | null>;
  logout: () => void;
  handleUnauthorized: (
    message?: string,
    expectedToken?: string,
    expectedEpoch?: number,
  ) => void;
}

const DEFAULT_UNAUTHORIZED_MESSAGE =
  "Your session expired. Sign in again to view protected survey history.";

let requestSeq = 0;
let activeAbort: AbortController | null = null;
let clearSurveyCache: (() => void) | null = null;

function abortInFlight(): void {
  activeAbort?.abort();
  activeAbort = null;
}

function toAuthError(error: unknown): AuthSessionError {
  if (error instanceof ApiClientError) {
    return { code: error.code, message: error.message, status: error.status };
  }
  if (error instanceof Error && error.message.trim()) {
    return { code: "NETWORK_ERROR", message: error.message };
  }
  return {
    code: "NETWORK_ERROR",
    message: "Unable to reach the authentication service. Try again.",
  };
}

export function registerSurveyCacheCleanup(cleanup: () => void): () => void {
  clearSurveyCache = cleanup;
  return () => {
    if (clearSurveyCache === cleanup) clearSurveyCache = null;
  };
}

// Tab-memory-only session state: never persisted to localStorage, sessionStorage, or cookies.
export const useAuthStore = create<AuthStore>((set, get) => ({
  status: "anonymous",
  token: null,
  user: null,
  error: null,
  signInOpen: false,
  sessionEpoch: 0,
  setSignInOpen(open) {
    const state = get();
    if (open === state.signInOpen) return;
    if (!open && state.status === "error") {
      set({
        status: state.user ? "authenticated" : "anonymous",
        error: null,
        signInOpen: false,
      });
      return;
    }
    set({ signInOpen: open });
  },
  clearError() {
    const state = get();
    if (!state.error) return;
    set({
      status: state.user ? "authenticated" : "anonymous",
      error: null,
    });
  },
  async login(email, password) {
    const normalizedEmail = email.trim();
    if (!normalizedEmail || !password) {
      clearSurveyCache?.();
      abortInFlight();
      requestSeq += 1;
      set((state) => ({
        status: "error",
        token: null,
        user: null,
        sessionEpoch: state.sessionEpoch + 1,
        signInOpen: true,
        error: {
          code: "VALIDATION_ERROR",
          message: "Enter both email and password to sign in.",
        },
      }));
      return null;
    }

    clearSurveyCache?.();
    abortInFlight();
    const seq = ++requestSeq;
    const abort = new AbortController();
    activeAbort = abort;
    set((state) => ({
      status: "authenticating",
      token: null,
      user: null,
      error: null,
      signInOpen: true,
      sessionEpoch: state.sessionEpoch + 1,
    }));

    try {
      const credentials = await loginWithPassword(normalizedEmail, password, abort.signal);
      if (seq !== requestSeq || abort.signal.aborted) return null;
      const user = await fetchCurrentIdentity(credentials.access_token, abort.signal);
      if (seq !== requestSeq || abort.signal.aborted) return null;
      activeAbort = null;
      set({
        status: "authenticated",
        token: credentials.access_token,
        user,
        error: null,
        signInOpen: false,
      });
      return user;
    } catch (error) {
      if (seq !== requestSeq || abort.signal.aborted) return null;
      activeAbort = null;
      set({
        status: "error",
        token: null,
        user: null,
        error: toAuthError(error),
        signInOpen: true,
      });
      return null;
    }
  },
  async refreshIdentity() {
    const { token } = get();
    if (!token) return null;
    abortInFlight();
    const seq = ++requestSeq;
    const abort = new AbortController();
    activeAbort = abort;
    try {
      const user = await fetchCurrentIdentity(token, abort.signal);
      if (seq !== requestSeq || abort.signal.aborted) return null;
      activeAbort = null;
      const current = get();
      if (current.token !== token) return null;
      const identityChanged =
        current.user?.email !== user.email || current.user?.role !== user.role;
      if (identityChanged) clearSurveyCache?.();
      set((state) => ({
        status: "authenticated",
        token,
        user,
        error: null,
        sessionEpoch: state.sessionEpoch + (identityChanged ? 1 : 0),
      }));
      return user;
    } catch (error) {
      if (seq !== requestSeq || abort.signal.aborted) return null;
      activeAbort = null;
      if (error instanceof ApiClientError && error.status === 401) {
        get().handleUnauthorized(error.message, token, get().sessionEpoch);
        return null;
      }
      set({ error: toAuthError(error) });
      return null;
    }
  },
  logout() {
    clearSurveyCache?.();
    requestSeq += 1;
    abortInFlight();
    set((state) => ({
      status: "anonymous",
      token: null,
      user: null,
      error: null,
      signInOpen: false,
      sessionEpoch: state.sessionEpoch + 1,
    }));
  },
  handleUnauthorized(message, expectedToken, expectedEpoch) {
    const state = get();
    if (
      (expectedToken !== undefined && state.token !== expectedToken) ||
      (expectedEpoch !== undefined && state.sessionEpoch !== expectedEpoch)
    ) return;
    clearSurveyCache?.();
    requestSeq += 1;
    abortInFlight();
    set((current) => ({
      status: "anonymous",
      token: null,
      user: null,
      sessionEpoch: current.sessionEpoch + 1,
      error: {
        code: "UNAUTHORIZED",
        message: message?.trim() || DEFAULT_UNAUTHORIZED_MESSAGE,
        status: 401,
      },
      signInOpen: true,
    }));
  },
}));

export type { AuthSessionError, AuthSessionStatus, CurrentUser };
