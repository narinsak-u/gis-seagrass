import axios, { type AxiosRequestConfig } from "axios";
import { siteDetailSchema } from "@/src/features/sites/schema";
import type {
  SiteDetailFeature,
  SiteFeatureCollection,
} from "@/src/features/sites/types";

export interface ApiErrorPayload {
  code: string;
  message: string;
  details: Record<string, unknown>;
}

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface ApiFetchOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  token?: string | null;
  signal?: AbortSignal;
  headers?: HeadersInit;
  fetchImpl?: typeof fetch;
}

function normalizeApiPath(path: string): string {
  const withLeadingSlash = path.startsWith("/") ? path : `/${path}`;
  return withLeadingSlash.startsWith("/api/") || withLeadingSlash === "/api"
    ? withLeadingSlash
    : `/api${withLeadingSlash}`;
}

function extractApiError(payload: unknown, fallbackStatus: number): ApiErrorPayload {
  if (payload && typeof payload === "object" && "error" in payload) {
    const inner = (payload as { error?: unknown }).error;
    if (inner && typeof inner === "object") {
      const record = inner as Record<string, unknown>;
      const code =
        typeof record.code === "string" && record.code.trim()
          ? record.code
          : `HTTP_${fallbackStatus}`;
      const message =
        typeof record.message === "string" && record.message.trim()
          ? record.message
          : `Request failed with status ${fallbackStatus}`;
      const details =
        record.details && typeof record.details === "object" && !Array.isArray(record.details)
          ? (record.details as Record<string, unknown>)
          : {};
      return { code, message, details };
    }
  }

  return {
    code: `HTTP_${fallbackStatus}`,
    message: `Request failed with status ${fallbackStatus}`,
    details: {},
  };
}

export interface ApiRequestOptions {
  method?: AxiosRequestConfig["method"];
  params?: AxiosRequestConfig["params"];
  data?: AxiosRequestConfig["data"];
  signal?: AbortSignal;
  token?: string | null;
}

export const apiClient = axios.create({
  baseURL: "/api",
  timeout: 10_000,
  headers: { Accept: "application/json" },
});

export async function apiRequest<T>(
  path: string,
  { token, ...options }: ApiRequestOptions = {},
): Promise<T> {
  try {
    const response = await apiClient.request<T>({
      url: path,
      ...options,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    return (response.status === 204 ? undefined : response.data) as T;
  } catch (error) {
    if (axios.isCancel(error) || options.signal?.aborted) {
      throw new DOMException("The operation was aborted", "AbortError");
    }
    if (axios.isAxiosError(error)) {
      const status = error.response?.status ?? 0;
      const apiError = error.response
        ? extractApiError(error.response.data, status)
        : {
            code: "NETWORK_ERROR",
            message: error.message || "Network request failed",
            details: {},
          };
      throw new ApiClientError(status, apiError.code, apiError.message, apiError.details);
    }
    throw new ApiClientError(0, "NETWORK_ERROR", "Network request failed");
  }
}

function parseSiteDetail(payload: unknown): SiteDetailFeature {
  const result = siteDetailSchema.safeParse(payload);
  if (!result.success) {
    throw new ApiClientError(
      0,
      "INVALID_API_RESPONSE",
      "The API returned an invalid Site detail response",
    );
  }
  return result.data;
}

export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const {
    method = "GET",
    body,
    token,
    signal,
    headers: customHeaders,
    fetchImpl = fetch,
  } = options;

  const headers = new Headers(customHeaders);
  headers.set("accept", "application/json");
  if (token) {
    headers.set("authorization", `Bearer ${token}`);
  }
  if (body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetchImpl(normalizeApiPath(path), {
    method,
    headers,
    signal,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });

  if (!response.ok) {
    let parsed: unknown = null;
    try {
      parsed = await response.json();
    } catch {
      parsed = null;
    }
    const err = extractApiError(parsed, response.status);
    throw new ApiClientError(response.status, err.code, err.message, err.details);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export interface FetchActiveSitesParams {
  bbox: string;
  province?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

export async function fetchActiveSitesGeoJson({
  bbox,
  province,
  signal,
  fetchImpl,
}: FetchActiveSitesParams): Promise<SiteFeatureCollection> {
  const params = new URLSearchParams();
  params.set("bbox", bbox);
  params.set("status", "active");
  if (province && province.trim().length > 0) {
    params.set("province", province.trim());
  }
  return apiFetch<SiteFeatureCollection>(`/sites.geojson?${params.toString()}`, {
    signal,
    fetchImpl,
  });
}

export interface FetchSiteDetailParams {
  code: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

export async function fetchSiteDetail({
  code,
  signal,
  fetchImpl,
}: FetchSiteDetailParams): Promise<SiteDetailFeature> {
  const path = `/sites/${encodeURIComponent(code)}`;
  if (fetchImpl) {
    return parseSiteDetail(await apiFetch<unknown>(path, { signal, fetchImpl }));
  }
  return parseSiteDetail(await apiRequest<unknown>(path, { signal }));
}
