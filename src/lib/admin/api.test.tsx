import { act, render, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";
import {
  fetchAdminGames,
  fetchAdminSession,
  formatAgo,
  formatSeconds,
  moderateGame,
  setAccountSuspension,
  useAdminOverview,
} from "@/lib/admin/api";
import { clearSession, signIn } from "@/lib/auth/session";

const userId = "3f7c2b1e-4d5a-4c9b-8e2f-1a2b3c4d5e6f";
const otherUserId = "9c1f0b2a-7e63-4a5d-9f10-5e6d7c8b9a01";

/**
 * The admin client, driven through the real session module.
 *
 * The token here is not injected into the module under test: it is obtained the
 * way the app obtains one — by signing in — so these tests also pin down that an
 * admin call carries the session's own credential and nothing else.
 */
function mockApi(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/auth/sign-in")) {
      return jsonResponse({
        session: {
          userId,
          role: "moderator",
          email: "moderator@example.com",
          onboarded: true,
          expiresAt: "2026-10-13T12:00:00.000Z",
        },
        tokens: {
          accessToken: "access-token-1",
          refreshToken: "refresh-token-1",
          tokenType: "bearer",
          expiresAt: "2026-10-13T12:00:00.000Z",
          expiresIn: 3600,
        },
      });
    }
    return handler(url, init);
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(status: number, code: string, message: string) {
  return jsonResponse({ error: { code, message, request_id: "req-admin-1" } }, status);
}

function overhead(status: number, message = "The admin API is not available right now.") {
  return errorResponse(status, "service_unavailable", message);
}

function requestOf(spy: ReturnType<typeof mockApi>, index = 0) {
  const call = spy.mock.calls[index];
  if (!call) throw new Error(`no request at index ${index}`);
  const [input, init] = call;
  return {
    url: new URL(String(input)),
    method: init?.method ?? "GET",
    headers: new Headers(init?.headers),
    credentials: init?.credentials,
    body: init?.body === undefined ? undefined : (JSON.parse(String(init.body)) as unknown),
  };
}

/** Signs in so the admin calls below have a real session token to send. */
async function signedIn(spy: ReturnType<typeof mockApi>) {
  await signIn("moderator@example.com", "correct-horse");
  expect(spy.mock.calls[0]?.[0]).toContain("/auth/sign-in");
}

/** A minimal `renderHook`: renders a probe component and exposes its latest value. */
function renderHook<T>(hook: () => T) {
  const ref: { current: T } = { current: undefined as unknown as T };
  function Probe() {
    const value = hook();
    const latest = useRef(value);
    latest.current = value;
    ref.current = latest.current;
    return null;
  }
  const utils = render(<Probe />);
  return {
    get result() {
      return ref.current;
    },
    ...utils,
  };
}

beforeEach(() => {
  clearSession();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("while anonymous", () => {
  it("sends nothing at all and reports that a session is needed", async () => {
    const spy = mockApi(() => jsonResponse({}));

    const error = (await fetchAdminSession().catch((e: unknown) => e)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(401);
    expect(error.code).toBe("unauthorized");
    // The important part: no request was attempted without a credential.
    expect(spy).not.toHaveBeenCalled();
  });

  it("refuses the same way for every admin read and write", async () => {
    const spy = mockApi(() => jsonResponse({}));

    await expect(fetchAdminGames()).rejects.toBeInstanceOf(ApiError);
    await expect(moderateGame(otherUserId, "published")).rejects.toBeInstanceOf(ApiError);
    await expect(setAccountSuspension(otherUserId, true, "reason")).rejects.toBeInstanceOf(
      ApiError,
    );

    expect(spy).not.toHaveBeenCalled();
  });
});

describe("reads", () => {
  it("sends the session token in the header, and no role or account in the request", async () => {
    const spy = mockApi(() => jsonResponse({ role: "moderator", isStaff: true }));
    await signedIn(spy);

    await fetchAdminSession();

    const request = requestOf(spy, 1);
    expect(request.method).toBe("GET");
    expect(request.url.pathname).toBe("/api/v1/admin/session");
    expect(request.headers.get("Authorization")).toBe("Bearer access-token-1");
    expect(request.credentials).toBe("omit");
    expect(request.body).toBeUndefined();
    // Nothing about who the caller claims to be travels in the query string: the
    // database decides that from the token.
    expect([...request.url.searchParams.keys()]).toEqual([]);
    expect(request.url.toString()).not.toContain(userId);
  });

  it("passes filters as query parameters, including paging", async () => {
    const spy = mockApi(() => jsonResponse({ items: [], hasMore: false }));
    await signedIn(spy);

    await fetchAdminGames({ status: "review", q: "stack", limit: 20, offset: 40 });

    const { url } = requestOf(spy, 1);
    expect(url.pathname).toBe("/api/v1/admin/games");
    expect(url.searchParams.get("status")).toBe("review");
    expect(url.searchParams.get("q")).toBe("stack");
    expect(url.searchParams.get("limit")).toBe("20");
    expect(url.searchParams.get("offset")).toBe("40");
    expect(url.searchParams.get("role")).toBeNull();
  });
});

describe("moderation writes", () => {
  it("PATCHes a game decision to the game's own route with the documented body", async () => {
    const spy = mockApi(() =>
      jsonResponse({
        id: otherUserId,
        previousStatus: "review",
        status: "published",
        action: "game_published",
      }),
    );
    await signedIn(spy);

    await moderateGame(otherUserId, "published");

    const request = requestOf(spy, 1);
    expect(request.method).toBe("PATCH");
    expect(request.url.pathname).toBe(`/api/v1/admin/games/${otherUserId}`);
    expect(request.headers.get("Authorization")).toBe("Bearer access-token-1");
    expect(request.body).toEqual({ status: "published", reason: "" });
  });

  it("sends a suspension with its reason", async () => {
    const spy = mockApi(() =>
      jsonResponse({ id: otherUserId, suspended: true, action: "account_suspended" }),
    );
    await signedIn(spy);

    await setAccountSuspension(otherUserId, true, "Repeated abuse after a warning.");

    const request = requestOf(spy, 1);
    expect(request.url.pathname).toBe(`/api/v1/admin/users/${otherUserId}`);
    expect(request.body).toEqual({ suspended: true, reason: "Repeated abuse after a warning." });
  });

  it("propagates a refusal rather than resolving successfully", async () => {
    const spy = mockApi(() =>
      errorResponse(403, "forbidden", "This action requires an administrator account."),
    );
    await signedIn(spy);

    const error = (await setAccountSuspension(otherUserId, true, "reason").catch(
      (e: unknown) => e,
    )) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(403);
    expect(error.message).toBe("This action requires an administrator account.");
  });
});

describe("useResource", () => {
  it("reports a 403 as a state instead of retrying it", async () => {
    const spy = mockApi(() =>
      errorResponse(403, "forbidden", "This area requires a moderator account."),
    );
    await signedIn(spy);

    const hook = renderHook(() => useAdminOverview());

    await waitFor(() => expect(hook.result.status).toBe("error"));
    expect(hook.result.status === "error" && hook.result.error.status).toBe(403);
    // One attempt: a refused role is an answer, not a failure to retry around.
    expect(spy.mock.calls.length).toBe(2);
  });

  it("re-reads on retry, and never falls back to a cached page", async () => {
    // A gateway that is down for the whole load: the read is retried briefly,
    // still fails, and the retry is what asks again — one attempt sequence each.
    let down = true;
    const spy = mockApi(() =>
      down
        ? overhead(503)
        : jsonResponse({ totalUsers: 4, series: [], activity: [], topGames: [] }),
    );
    await signedIn(spy);
    const beforeLoad = spy.mock.calls.length;

    const hook = renderHook(() => useAdminOverview());

    await waitFor(() => expect(hook.result.status).toBe("error"));
    // Three attempts before the failure is reported, not one.
    expect(spy.mock.calls.length - beforeLoad).toBe(3);

    down = false;
    await act(async () => {
      hook.result.retry();
    });

    await waitFor(() => expect(hook.result.status).toBe("ready"));
    // The retry is one fresh read, not a cached page played back.
    expect(spy.mock.calls.length - beforeLoad).toBe(4);
  });
});

describe("formatting", () => {
  it("keeps an unmeasured duration distinct from zero", () => {
    expect(formatSeconds(null)).toBeNull();
    expect(formatSeconds(0)).toBe("0s");
    expect(formatSeconds(95)).toBe("1m 35s");
  });

  it("returns nothing for a timestamp the API did not send", () => {
    expect(formatAgo(null)).toBeNull();
    expect(formatAgo("not a date")).toBeNull();
  });
});
