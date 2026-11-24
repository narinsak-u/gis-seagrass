import { ApiClientError, apiFetch } from "@/src/lib/api";

export type ActorRole = "viewer" | "editor" | "admin";

export interface CurrentUser {
  email: string;
  role: ActorRole;
}

export interface LoginResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
}

export type AuthSessionStatus =
  | "anonymous"
  | "authenticating"
  | "authenticated"
  | "error";

export interface AuthSessionError {
  code: string;
  message: string;
  status?: number;
}

export interface AuthSessionState {
  status: AuthSessionStatus;
  token: string | null;
  user: CurrentUser | null;
  error: AuthSessionError | null;
  signInOpen: boolean;
}

export interface AuthSessionControllerOptions {
  fetchImpl?: typeof fetch;
}

export interface AuthSessionController {
  getState(): AuthSessionState;
  subscribe(listener: (state: AuthSessionState) => void): () => void;
  setSignInOpen(open: boolean): void;
  clearError(): void;
  login(email: string, password: string): Promise<CurrentUser | null>;
  refreshIdentity(): Promise<CurrentUser | null>;
  logout(): void;
  handleUnauthorized(message?: string): void;
  dispose(): void;
}

const DEFAULT_UNAUTHORIZED_MESSAGE =
  "Your session expired. Sign in again to view protected survey history.";

function toAuthError(error: unknown): AuthSessionError {
  if (error instanceof ApiClientError) {
    return {
      code: error.code,
      message: error.message,
      status: error.status,
    };
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return {
      code: "NETWORK_ERROR",
      message: error.message,
    };
  }
  return {
    code: "NETWORK_ERROR",
    message: "Unable to reach the authentication service. Try again.",
  };
}

export async function loginWithPassword(
  email: string,
  password: string,
  options: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<LoginResponse> {
  return apiFetch<LoginResponse>("/auth/login", {
    method: "POST",
    body: { email, password },
    signal: options.signal,
    fetchImpl: options.fetchImpl,
  });
}

export async function fetchCurrentIdentity(
  token: string,
  options: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<CurrentUser> {
  return apiFetch<CurrentUser>("/auth/me", {
    method: "GET",
    token,
    signal: options.signal,
    fetchImpl: options.fetchImpl,
  });
}

export function createAuthSessionController(
  options: AuthSessionControllerOptions = {},
): AuthSessionController {
  const fetchImpl = options.fetchImpl;
  const listeners = new Set<(state: AuthSessionState) => void>();

  // Tab-memory-only session state: never persisted to localStorage, sessionStorage, or cookies.
  let state: AuthSessionState = {
    status: "anonymous",
    token: null,
    user: null,
    error: null,
    signInOpen: false,
  };

  let requestSeq = 0;
  let activeAbort: AbortController | null = null;

  function emit(next: AuthSessionState): void {
    state = next;
    for (const listener of listeners) {
      listener(state);
    }
  }

  function abortInFlight(): void {
    if (activeAbort) {
      activeAbort.abort();
      activeAbort = null;
    }
  }

  function setSignInOpen(open: boolean): void {
    if (open === state.signInOpen) return;
    if (!open && state.status === "error") {
      emit({
        ...state,
        status: state.user ? "authenticated" : "anonymous",
        error: null,
        signInOpen: false,
      });
      return;
    }
    emit({ ...state, signInOpen: open });
  }

  function clearError(): void {
    if (!state.error) return;
    emit({
      ...state,
      status: state.user ? "authenticated" : "anonymous",
      error: null,
    });
  }

  async function login(email: string, password: string): Promise<CurrentUser | null> {
    const normalizedEmail = email.trim();
    if (!normalizedEmail || !password) {
      emit({
        ...state,
        status: "error",
        token: null,
        user: null,
        signInOpen: true,
        error: {
          code: "VALIDATION_ERROR",
          message: "Enter both email and password to sign in.",
        },
      });
      return null;
    }

    abortInFlight();
    const seq = ++requestSeq;
    const abortController = new AbortController();
    activeAbort = abortController;

    emit({
      ...state,
      status: "authenticating",
      error: null,
      signInOpen: true,
    });

    try {
      const loginPayload = await loginWithPassword(normalizedEmail, password, {
        signal: abortController.signal,
        fetchImpl,
      });
      if (seq !== requestSeq || abortController.signal.aborted) {
        return null;
      }

      const identity = await fetchCurrentIdentity(loginPayload.access_token, {
        signal: abortController.signal,
        fetchImpl,
      });
      if (seq !== requestSeq || abortController.signal.aborted) {
        return null;
      }

      activeAbort = null;
      emit({
        status: "authenticated",
        token: loginPayload.access_token,
        user: identity,
        error: null,
        signInOpen: false,
      });
      return identity;
    } catch (err) {
      if (seq !== requestSeq || abortController.signal.aborted) {
        return null;
      }
      activeAbort = null;
      emit({
        status: "error",
        token: null,
        user: null,
        error: toAuthError(err),
        signInOpen: true,
      });
      return null;
    }
  }

  async function refreshIdentity(): Promise<CurrentUser | null> {
    const currentToken = state.token;
    if (!currentToken) return null;

    abortInFlight();
    const seq = ++requestSeq;
    const abortController = new AbortController();
    activeAbort = abortController;

    try {
      const identity = await fetchCurrentIdentity(currentToken, {
        signal: abortController.signal,
        fetchImpl,
      });
      if (seq !== requestSeq || abortController.signal.aborted) {
        return null;
      }
      activeAbort = null;
      emit({
        ...state,
        status: "authenticated",
        token: currentToken,
        user: identity,
        error: null,
      });
      return identity;
    } catch (err) {
      if (seq !== requestSeq || abortController.signal.aborted) {
        return null;
      }
      activeAbort = null;
      if (err instanceof ApiClientError && err.status === 401) {
        handleUnauthorized(err.message);
        return null;
      }
      emit({
        ...state,
        error: toAuthError(err),
      });
      return null;
    }
  }

  function logout(): void {
    requestSeq += 1;
    abortInFlight();
    emit({
      status: "anonymous",
      token: null,
      user: null,
      error: null,
      signInOpen: false,
    });
  }

  function handleUnauthorized(message?: string): void {
    requestSeq += 1;
    abortInFlight();
    const resolvedMessage =
      typeof message === "string" && message.trim().length > 0
        ? message.trim()
        : DEFAULT_UNAUTHORIZED_MESSAGE;
    emit({
      status: "anonymous",
      token: null,
      user: null,
      error: {
        code: "UNAUTHORIZED",
        message: resolvedMessage,
        status: 401,
      },
      signInOpen: true,
    });
  }

  function dispose(): void {
    requestSeq += 1;
    abortInFlight();
    listeners.clear();
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setSignInOpen,
    clearError,
    login,
    refreshIdentity,
    logout,
    handleUnauthorized,
    dispose,
  };
}
