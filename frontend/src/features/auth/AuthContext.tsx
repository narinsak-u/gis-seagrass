"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  createAuthSessionController,
  type AuthSessionController,
  type AuthSessionError,
  type AuthSessionState,
  type AuthSessionStatus,
  type CurrentUser,
} from "./auth-session";

export interface AuthContextValue {
  token: string | null;
  user: CurrentUser | null;
  status: AuthSessionStatus;
  error: AuthSessionError | null;
  signInOpen: boolean;
  setSignInOpen: (open: boolean) => void;
  clearError: () => void;
  login: (email: string, password: string) => Promise<CurrentUser | null>;
  refreshIdentity: () => Promise<CurrentUser | null>;
  logout: () => void;
  handleUnauthorized: (message?: string) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [controller] = useState<AuthSessionController>(() =>
    createAuthSessionController(),
  );

  const [state, setState] = useState<AuthSessionState>(() =>
    controller.getState(),
  );

  useEffect(() => {
    const unsubscribe = controller.subscribe(setState);
    setState(controller.getState());
    return () => {
      unsubscribe();
      controller.dispose();
    };
  }, [controller]);

  const setSignInOpen = useCallback(
    (open: boolean) => {
      controller.setSignInOpen(open);
    },
    [controller],
  );

  const clearError = useCallback(() => {
    controller.clearError();
  }, [controller]);

  const login = useCallback(
    (email: string, password: string) => {
      return controller.login(email, password);
    },
    [controller],
  );

  const refreshIdentity = useCallback(() => {
    return controller.refreshIdentity();
  }, [controller]);

  const logout = useCallback(() => {
    controller.logout();
  }, [controller]);

  const handleUnauthorized = useCallback(
    (message?: string) => {
      controller.handleUnauthorized(message);
    },
    [controller],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      token: state.token,
      user: state.user,
      status: state.status,
      error: state.error,
      signInOpen: state.signInOpen,
      setSignInOpen,
      clearError,
      login,
      refreshIdentity,
      logout,
      handleUnauthorized,
    }),
    [
      state.token,
      state.user,
      state.status,
      state.error,
      state.signInOpen,
      setSignInOpen,
      clearError,
      login,
      refreshIdentity,
      logout,
      handleUnauthorized,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthSession(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuthSession must be used within an AuthProvider");
  }
  return context;
}
