import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";
import {
  clearSession,
  signIn,
} from "@/lib/auth/session";
import { fetchFollowingFeed, useFollowingFeed } from "@/lib/games/following";
import type { Game } from "@/lib/games/catalog";
import {
  fetchUnreadCount,
  useUnreadCount,
} from "@/lib/notifications/store";

const testUserID = "3f7c2b1e-4d5a-4c9b-8e2f-1a2b3c4d5e6f";
// Matches src/test/setup.ts: publicConfig is computed at import time from the
// stubbed env, so tests must use the setup value rather than re-stubbing.
const supabaseBase = "https://project.supabase.co";

function sessionPayload() {
  return {
    session: { userId: testUserID, role: "user", email: "player@example.com" },
    tokens: {
      accessToken: "access-token-1",
      refreshToken: "refresh-token-1",
      tokenType: "bearer",
      expiresIn: 3600,
    },
    user: {
      id: testUserID,
      email: "player@example.com",
      emailConfirmed: true,
      createdAt: "2026-10-01T00:00:00.000Z",
    },
  };
}

function game(slug: string): Game {
  return {
    slug,
    title: slug,
    playable: false,
    plays: 0,
    isOfficial: false,
    updatedAt: "2026-09-01T12:00:00.000Z",
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Routes stubbed fetch by URL: relative /api/v1/* goes to the Go gateway
 * double, absolute Supabase REST goes to the Supabase double.
 */
function stubApiAndSupabase(handlers: {
  gateway?: (url: string, init?: RequestInit) => Response;
  supabase?: (url: string, init?: RequestInit) => Response;
}) {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/v1/")) {
      if (!handlers.gateway) throw new Error(`unexpected gateway call ${url}`);
      return handlers.gateway(url, init);
    }
    if (url.startsWith(supabaseBase)) {
      if (!handlers.supabase) throw new Error(`unexpected supabase call ${url}`);
      return handlers.supabase(url, init);
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

beforeEach(() => {
  clearSession();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearSession();
});

describe("following feed is server-scoped, not a filtered catalogue", () => {
  it("refuses anonymous callers without touching the API", async () => {
    const spy = stubApiAndSupabase({});
    await expect(fetchFollowingFeed()).rejects.toMatchObject({ status: 401 });
    expect(spy).not.toHaveBeenCalled();
  });

  it("pages through the server cursor and keeps items on a failed next page", async () => {
    stubApiAndSupabase({
      gateway: (url) => {
        if (url.includes("/auth/sign-in")) return jsonResponse(sessionPayload());
        if (url.includes("/games/following")) {
          const parsed = new URL(url);
          const cursor = parsed.searchParams.get("cursor");
          // The follower must never travel as a parameter: identity is the token.
          expect(url).not.toContain(testUserID);
          expect(parsed.searchParams.get("limit")).toBe("2");
          if (!cursor) {
            return jsonResponse({ items: [game("a"), game("b")], nextCursor: "cursor-1" });
          }
          if (cursor === "cursor-1") {
            return jsonResponse({
              error: { code: "service_unavailable", message: "Feed is down." },
            }, 503);
          }
          throw new Error(`unexpected cursor ${cursor}`);
        }
        throw new Error(`unexpected gateway ${url}`);
      },
    });

    await signIn("player@example.com", "correct-horse");

    function Probe() {
      const feed = useFollowingFeed({ limit: 2 });
      return (
        <div>
          <span data-testid="status">{feed.status}</span>
          <span data-testid="count">
            {feed.status === "ready" || feed.status === "loading-more" || feed.status === "error"
              ? feed.items.length
              : -1}
          </span>
          <button onClick={() => void feed.loadMore()}>more</button>
          {feed.status === "error" && <span data-testid="err">{feed.error.message}</span>}
        </div>
      );
    }

    render(<Probe />);
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("ready"),
    );
    expect(screen.getByTestId("count").textContent).toBe("2");

    await act(async () => {
      screen.getByText("more").click();
    });
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("error"),
    );
    // The two loaded games stay on screen; the failure belongs to next page.
    expect(screen.getByTestId("count").textContent).toBe("2");
    expect(screen.getByTestId("err").textContent).toMatch(/down/i);
  });
});

describe("unread badge distinguishes zero from failure", () => {
  it("anonymous callers get unauthorized, never a zero count", async () => {
    stubApiAndSupabase({});
    await expect(fetchUnreadCount()).rejects.toMatchObject({ status: 401 });
  });

  function BadgeProbe() {
    const badge = useUnreadCount();
    return (
      <div>
        <span data-testid="status">{badge.status}</span>
        <span data-testid="count">{badge.count}</span>
        <button onClick={badge.retry}>retry</button>
      </div>
    );
  }

  it("reports a genuine zero as ready with count 0", async () => {
    stubApiAndSupabase({
      gateway: (url) =>
        url.includes("/auth/sign-in") ? jsonResponse(sessionPayload()) : jsonResponse({}),
      supabase: () => jsonResponse([]),
    });
    await signIn("player@example.com", "correct-horse");

    render(<BadgeProbe />);
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("ready"),
    );
    expect(screen.getByTestId("count").textContent).toBe("0");
  });

  it("reports a positive count, then failure, then recovery via retry", async () => {
    let mode: "ok" | "fail" = "ok";
    stubApiAndSupabase({
      gateway: (url) =>
        url.includes("/auth/sign-in") ? jsonResponse(sessionPayload()) : jsonResponse({}),
      supabase: () => {
        if (mode === "fail") {
          return jsonResponse({ message: "boom", code: "XX" }, 500);
        }
        return jsonResponse([{ id: "1" }, { id: "2" }, { id: "3" }]);
      },
    });
    await signIn("player@example.com", "correct-horse");

    render(<BadgeProbe />);
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("ready"),
    );
    expect(screen.getByTestId("count").textContent).toBe("3");

    // Next tick fails: the badge must become error, not a silent zero.
    mode = "fail";
    await act(async () => {
      screen.getByText("retry").click();
    });
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("error"),
    );
    expect(screen.getByTestId("count").textContent).toBe("0");

    // Recovery: success again restores the real count.
    mode = "ok";
    await act(async () => {
      screen.getByText("retry").click();
    });
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("ready"),
    );
    expect(screen.getByTestId("count").textContent).toBe("3");
  });

  it("fetchUnreadCount throws ApiError on transport-mapped failures", async () => {
    stubApiAndSupabase({
      gateway: (url) =>
        url.includes("/auth/sign-in") ? jsonResponse(sessionPayload()) : jsonResponse({}),
      supabase: () => jsonResponse({ message: "db down" }, 503),
    });
    await signIn("player@example.com", "correct-horse");
    const failure = await fetchUnreadCount().catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ApiError);
  });
});
