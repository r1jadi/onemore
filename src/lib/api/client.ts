/**
 * Typed client for the versioned Go API (`/api/v1`).
 *
 * Rules this module exists to enforce:
 *   - the caller identity is never sent in a body or query string; it travels
 *     in the `Authorization` header (a verified Supabase access token);
 *   - every response is either the documented payload or the shared error
 *     envelope, so failures surface as one `ApiError` type;
 *   - requests are bounded by a timeout and correlated by `X-Request-ID`.
 */

import { publicConfig } from "@/lib/config";

export type ApiErrorDetail = { field?: string; rule?: string; message?: string };

type ApiErrorEnvelope = {
  error?: {
    code?: string;
    message?: string;
    /** The envelope's own field name: the Go API serialises it snake_case. */
    request_id?: string;
    /** Read as a fallback so a response written against the older spelling still works. */
    requestId?: string;
    details?: Array<ApiErrorDetail>;
  };
};

/** A failure returned by the API, or a transport failure talking to it. */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId?: string;
  readonly details: Array<ApiErrorDetail>;

  constructor(
    message: string,
    options: {
      code?: string;
      status?: number;
      requestId?: string;
      details?: Array<ApiErrorDetail>;
    } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.code = options.code ?? "unknown_error";
    this.status = options.status ?? 0;
    this.requestId = options.requestId;
    this.details = options.details ?? [];
  }

  /** True when the caller needs to sign in again. */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isRateLimited(): boolean {
    return this.status === 429;
  }
}

export type ApiRequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  /** JSON body. Unknown fields are rejected by the API, so send exact shapes. */
  body?: unknown;
  /** Verified Supabase access token. Omit for public endpoints. */
  token?: string;
  query?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
  /** Defaults to 15s. Long-running work should be a job, not a slow request. */
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 15_000;

/** Builds the absolute request URL from the configured base. */
export function buildUrl(path: string, query?: ApiRequestOptions["query"]): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(
    `${publicConfig.apiBaseUrl}${normalized}`,
    globalThis.location?.origin ?? "http://localhost",
  );
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined) continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function requestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function timeoutSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal | undefined {
  const timeout =
    typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
      ? AbortSignal.timeout(timeoutMs)
      : undefined;
  if (!timeout) return signal;
  if (!signal) return timeout;
  // Prefer combining so either the caller's abort or the timeout wins.
  return "any" in AbortSignal ? AbortSignal.any([signal, timeout]) : timeout;
}

/**
 * Calls the API and returns the typed payload.
 *
 * @throws ApiError for any non-2xx response, timeout or malformed payload.
 */
export async function apiFetch<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { method = "GET", body, token, query, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-Request-ID": requestId(),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      headers,
      // No cookies: authentication is a bearer token, which also removes
      // cross-site request forgery as an attack path for the API.
      credentials: "omit",
      cache: "no-store",
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: timeoutSignal(timeoutMs, signal),
    });
  } catch (cause) {
    const aborted = cause instanceof Error && cause.name === "TimeoutError";
    throw new ApiError(
      aborted ? "The request timed out. Try again." : "Could not reach the server.",
      {
        code: aborted ? "timeout" : "network_error",
      },
    );
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const payload = parseJson(text);

  if (!response.ok) {
    const envelope = (payload ?? {}) as ApiErrorEnvelope;
    throw new ApiError(
      envelope.error?.message ?? `Request failed with status ${response.status}.`,
      {
        code: envelope.error?.code ?? "http_error",
        status: response.status,
        requestId:
          envelope.error?.request_id ??
          envelope.error?.requestId ??
          response.headers.get("X-Request-ID") ??
          undefined,
        details: envelope.error?.details ?? [],
      },
    );
  }

  if (payload === undefined) {
    throw new ApiError("The server returned a response that could not be read.", {
      code: "invalid_response",
      status: response.status,
    });
  }

  return payload as T;
}

function parseJson(text: string): unknown {
  if (text.trim() === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
