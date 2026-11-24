export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
}

export interface ProxyOptions {
  apiInternalUrl?: string;
  fetchImpl?: typeof fetch;
}

const DEFAULT_API_INTERNAL_URL = "http://127.0.0.1:3000";

function normalizeBaseUrl(rawUrl: string): string {
  return rawUrl.replace(/\/+$/, "");
}

function buildUpstreamUrl(
  baseUrl: string,
  pathSegments: readonly string[],
  search: string,
): string {
  const encodedPath = pathSegments.map((segment) => encodeURIComponent(segment)).join("/");
  return `${normalizeBaseUrl(baseUrl)}/${encodedPath}${search}`;
}

export async function proxyApiRequest(
  request: Request,
  pathSegments: readonly string[],
  options: ProxyOptions = {},
): Promise<Response> {
  const apiInternalUrl =
    options.apiInternalUrl ?? process.env.API_INTERNAL_URL ?? DEFAULT_API_INTERNAL_URL;
  const fetchImpl = options.fetchImpl ?? fetch;

  const incomingUrl = new URL(request.url);
  const upstreamUrl = buildUpstreamUrl(apiInternalUrl, pathSegments, incomingUrl.search);

  const forwardHeaders = new Headers();
  const authorization = request.headers.get("authorization");
  if (authorization) {
    forwardHeaders.set("authorization", authorization);
  }
  const contentType = request.headers.get("content-type");
  if (contentType) {
    forwardHeaders.set("content-type", contentType);
  }
  const accept = request.headers.get("accept");
  if (accept) {
    forwardHeaders.set("accept", accept);
  }

  const method = request.method.toUpperCase();
  const init: RequestInit = {
    method,
    headers: forwardHeaders,
    cache: "no-store",
  };

  if (method !== "GET" && method !== "HEAD") {
    const bodyText = await request.text();
    if (bodyText.length > 0) {
      init.body = bodyText;
    }
  }

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetchImpl(upstreamUrl, init);
  } catch {
    const envelope: ApiErrorEnvelope = {
      error: {
        code: "UPSTREAM_UNAVAILABLE",
        message: "Unable to reach the monitoring API service.",
        details: {},
      },
    };
    return new Response(JSON.stringify(envelope), {
      status: 502,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }

  const responseHeaders = new Headers();
  const upstreamContentType = upstreamResponse.headers.get("content-type");
  if (upstreamContentType) {
    responseHeaders.set("content-type", upstreamContentType);
  }
  responseHeaders.set("cache-control", "no-store");

  if (upstreamResponse.status === 204 || upstreamResponse.status === 304) {
    return new Response(null, {
      status: upstreamResponse.status,
      headers: responseHeaders,
    });
  }

  const responseBody = await upstreamResponse.arrayBuffer();
  return new Response(responseBody, {
    status: upstreamResponse.status,
    headers: responseHeaders,
  });
}
