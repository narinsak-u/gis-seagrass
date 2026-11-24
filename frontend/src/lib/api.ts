import axios, { type AxiosRequestConfig } from "axios";


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

