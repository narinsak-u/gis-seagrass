import type { SiteFeatureCollection } from "@/src/features/sites/types";

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
