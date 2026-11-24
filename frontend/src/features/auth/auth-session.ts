import { z } from "zod";
import { ApiClientError, apiRequest } from "@/src/lib/api";
import { currentUserSchema, loginResponseSchema } from "./schema";

export type ActorRole = z.infer<typeof currentUserSchema>["role"];

export type CurrentUser = z.infer<typeof currentUserSchema>;

export type LoginResponse = z.infer<typeof loginResponseSchema>;

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

export async function loginWithPassword(
  email: string,
  password: string,
  signal?: AbortSignal,
): Promise<LoginResponse> {
  const payload = await apiRequest<unknown>("/auth/login", {
    method: "POST",
    data: { email, password },
    signal,
  });
  const parsed = loginResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiClientError(0, "INVALID_API_RESPONSE", "The API returned an invalid login response");
  }
  return parsed.data;
}

export async function fetchCurrentIdentity(
  token: string,
  signal?: AbortSignal,
): Promise<CurrentUser> {
  const payload = await apiRequest<unknown>("/auth/me", {
    method: "GET",
    token,
    signal,
  });
  const parsed = currentUserSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiClientError(0, "INVALID_API_RESPONSE", "The API returned an invalid identity response");
  }
  return parsed.data;
}
