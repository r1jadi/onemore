import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiFetch, buildUrl } from "@/lib/api/client";

function mockFetch(handler: (url: string, init?: RequestInit) => Promise<Response> | Response) {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("buildUrl", () => {
  it("prefixes the versioned API path", () => {
    expect(new URL(buildUrl("/games")).pathname).toBe("/api/v1/games");
  });

  it("adds query parameters and skips undefined values", () => {
    const url = new URL(buildUrl("/games", { limit: 20, cursor: undefined, include: false }));
    expect(url.searchParams.get("limit")).toBe("20");
    expect(url.searchParams.has("cursor")).toBe(false);
    expect(url.searchParams.get("include")).toBe("false");
  });
});

describe("apiFetch", () => {
  it("returns the parsed payload for a success response", async () => {
    mockFetch(() => new Response(JSON.stringify({ id: "stack-10" }), { status: 200 }));

    await expect(apiFetch<{ id: string }>("/games/stack-10")).resolves.toEqual({ id: "stack-10" });
  });

  it("returns undefined for 204 responses", async () => {
    mockFetch(() => new Response(null, { status: 204 }));

    await expect(
      apiFetch("/games/stack-10/like", { method: "DELETE", token: "t" }),
    ).resolves.toBeUndefined();
  });

  it("sends the access token as a bearer header and never as a body or query value", async () => {
    const spy = mockFetch(() => new Response("{}", { status: 200 }));

    await apiFetch("/users/me", {
      token: "test-token",
      body: { displayName: "rijad" },
      method: "PATCH",
    });

    const [url, init] = spy.mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer test-token");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(String(url)).not.toContain("test-token");
    // No cookies: a bearer token cannot be replayed by a cross-site form post.
    expect(init?.credentials).toBe("omit");
  });

  it("maps the shared error envelope onto ApiError", async () => {
    mockFetch(
      () =>
        new Response(
          JSON.stringify({
            error: {
              code: "forbidden",
              message: "This area requires an administrator account.",
              requestId: "abc123",
              details: [{ field: "role", rule: "admin" }],
            },
          }),
          { status: 403 },
        ),
    );

    const error = await apiFetch("/admin/users", { token: "t" }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(403);
    expect(apiError.code).toBe("forbidden");
    expect(apiError.requestId).toBe("abc123");
    expect(apiError.details).toEqual([{ field: "role", rule: "admin" }]);
    expect(apiError.isUnauthorized).toBe(false);
  });

  it("falls back to a generic error when the body is not the envelope", async () => {
    mockFetch(() => new Response("<html>502</html>", { status: 502 }));

    const error = (await apiFetch("/games").catch((e: unknown) => e)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(502);
    expect(error.code).toBe("http_error");
  });

  it("reports transport failures without leaking the underlying error", async () => {
    mockFetch(() => Promise.reject(new Error("socket hang up")));

    const error = (await apiFetch("/games").catch((e: unknown) => e)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe("network_error");
    expect(error.message).toBe("Could not reach the server.");
  });

  it("retries a read through a gateway that is still starting", async () => {
    // A cold service answers 503; the same request a moment later is served.
    let calls = 0;
    const spy = mockFetch(() => {
      calls += 1;
      return calls === 1
        ? new Response("<html>503</html>", { status: 503 })
        : new Response(JSON.stringify({ items: [] }), { status: 200 });
    });

    await expect(apiFetch("/games")).resolves.toEqual({ items: [] });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("does not retry a write, so a slow gateway cannot duplicate it", async () => {
    const spy = mockFetch(() => new Response("<html>503</html>", { status: 503 }));

    const error = (await apiFetch("/games/stack-10/like", { method: "POST", token: "t" }).catch(
      (e: unknown) => e,
    )) as ApiError;

    expect(error.status).toBe(503);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("retries a write the server deduplicates when the caller says so", async () => {
    let calls = 0;
    const spy = mockFetch(() => {
      calls += 1;
      return calls === 1
        ? new Response("", { status: 502 })
        : new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    await expect(
      apiFetch("/sessions/s1/complete", { method: "POST", body: {}, retryable: true }),
    ).resolves.toEqual({ ok: true });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("explains a bare gateway failure instead of quoting its status", async () => {
    mockFetch(() => new Response("", { status: 502 }));

    const error = (await apiFetch("/sessions", { method: "POST", body: {} }).catch(
      (e: unknown) => e,
    )) as ApiError;

    expect(error.status).toBe(502);
    expect(error.message).toBe("The server is busy right now. Try again in a moment.");
  });

  it("reports the outage once every retry has failed", async () => {
    const spy = mockFetch(() => new Response("<html>503</html>", { status: 503 }));

    const error = (await apiFetch("/admin/leaderboards").catch((e: unknown) => e)) as ApiError;

    expect(error.status).toBe(503);
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("flags 429 responses as rate limited", async () => {
    mockFetch(
      () => new Response(JSON.stringify({ error: { code: "rate_limited" } }), { status: 429 }),
    );

    const error = (await apiFetch("/games").catch((e: unknown) => e)) as ApiError;

    expect(error.isRateLimited).toBe(true);
  });
});
