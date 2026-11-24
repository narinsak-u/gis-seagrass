import { create } from "zustand";
import {
  createAuthSessionController,
  type AuthSessionError,
  type AuthSessionState,
  type AuthSessionStatus,
  type CurrentUser,
} from "./auth-session";

const controller = createAuthSessionController();

interface AuthStore extends AuthSessionState {
  setSignInOpen: (open: boolean) => void;
  clearError: () => void;
  login: (email: string, password: string) => Promise<CurrentUser | null>;
  refreshIdentity: () => Promise<CurrentUser | null>;
  logout: () => void;
  handleUnauthorized: (message?: string) => void;
}

export const useAuthStore = create<AuthStore>(() => ({
  ...controller.getState(),
  setSignInOpen: controller.setSignInOpen,
  clearError: controller.clearError,
  login: controller.login,
  refreshIdentity: controller.refreshIdentity,
  logout: controller.logout,
  handleUnauthorized: controller.handleUnauthorized,
}));

export function subscribeToAuthStore(): () => void {
  return controller.subscribe((state) => useAuthStore.setState(state));
}

export type { AuthSessionError, AuthSessionStatus, CurrentUser };
