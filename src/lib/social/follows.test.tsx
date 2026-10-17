import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearSession, signIn } from "@/lib/auth/session";
import { followUser, useFollowState } from "@/lib/social/follows";

const testUserID = "3f7c2b1e-4d5a-4c9b-8e2f-1a2b3c4d5e6f";
const otherUserID = "9a8b7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d";

/** The shape `POST /auth/sign-in` answers with, per the contract. */
function sessionPayload() {
  return {
    session: {
      userId: testUserID,
      role: "user",
      email: "player@example.com",
      onboarded: true,
      expiresAt: "2026-10-08T12:00:00.000Z",
    },
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

/** A `public.follows` row, as PostgREST answers for it. */
function followRow(followerId = testUserID, followeeId = otherUserID) {
  return {
    follower_id: followerId,
    followee_id: followeeId,
    created_at: "2026-10-15T00:00:00.000Z",
  };
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function requestOf(spy: ReturnType<typeof mockFetch>, index = 0) {
  const call = spy.mock.calls[index];
  if (!call) throw new Error(`no request at index ${index}`);
  const [input, init] = call;
  return {
    url: String(input),
    method: init?.method ?? "GET",
    headers: new Headers(init?.headers),
    body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
  };
}

/** Signs in through the real endpoint, so follow calls carry a real token. */
async function signInAs() {
  await signIn("player@example.com", "correct-horse");
}

beforeEach(() => {
  clearSession();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("followUser", () => {
  it("asks the database to ignore a duplicate, so a repeated follow converges", async () => {
    const spy = mockFetch((url) =>
      url.includes("/auth/sign-in") ? jsonResponse(sessionPayload()) : jsonResponse([], 201),
    );
    await signInAs();

    await followUser(otherUserID);
    // The same click again — a double tap, a retry after a lost response, a
    // second tab: the insert converges instead of violating the primary key.
    await followUser(otherUserID);

    const request = requestOf(spy, 1);
    expect(request.method).toBe("POST");
    const parsed = new URL(request.url);
    expect(parsed.pathname).toBe("/rest/v1/follows");
    // ON CONFLICT DO NOTHING on the follow's own primary key.
    expect(parsed.searchParams.get("on_conflict")).toBe("follower_id,followee_id");
    expect(request.headers.get("Prefer")).toBe("resolution=ignore-duplicates");
    // The follower is the session's own id, never one a caller passed in.
    expect(request.body).toEqual({ follower_id: testUserID, followee_id: otherUserID });
  });

  it("lets two simultaneous follows converge on the same row", async () => {
    // Both inserts carry ON CONFLICT DO NOTHING, so whichever lands second is a
    // no-op instead of a primary-key violation the caller would have to
    // reconcile.
    const spy = mockFetch((url) =>
      url.includes("/auth/sign-in") ? jsonResponse(sessionPayload()) : jsonResponse([], 201),
    );
    await signInAs();

    await expect(Promise.all([followUser(otherUserID), followUser(otherUserID)])).resolves.toEqual([
      undefined,
      undefined,
    ]);

    for (const index of [1, 2]) {
      const request = requestOf(spy, index);
      expect(request.method).toBe("POST");
      expect(new URL(request.url).searchParams.get("on_conflict")).toBe("follower_id,followee_id");
      expect(request.headers.get("Prefer")).toBe("resolution=ignore-duplicates");
    }
  });

  it("refuses to follow while signed out, without trusting a client-supplied id", async () => {
    const spy = mockFetch(() => jsonResponse({}));

    await expect(followUser(otherUserID)).rejects.toMatchObject({ status: 401 });
    // No token means no request at all: there is nothing to derive the actor
    // from, and a browser-supplied id is not a credential.
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("useFollowState", () => {
  it("loads the stored relationship instead of assuming it is absent", async () => {
    const spy = mockFetch((url) =>
      url.includes("/auth/sign-in") ? jsonResponse(sessionPayload()) : jsonResponse([followRow()]),
    );
    await signInAs();

    const { result } = renderHook(() => useFollowState(otherUserID));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.following).toBe(true);

    const read = requestOf(spy, 1);
    const parsed = new URL(read.url);
    expect(parsed.pathname).toBe("/rest/v1/follows");
    expect(parsed.searchParams.get("follower_id")).toBe(`eq.${testUserID}`);
    expect(parsed.searchParams.get("followee_id")).toBe(`eq.${otherUserID}`);
    expect(read.headers.get("Authorization")).toBe("Bearer access-token-1");
  });

  it("trusts a state the caller just read without a second query", async () => {
    const spy = mockFetch(() => jsonResponse(sessionPayload()));
    await signInAs();

    const { result } = renderHook(() => useFollowState(otherUserID, true));

    expect(result.current.following).toBe(true);
    expect(result.current.loading).toBe(false);
    // One call — the sign-in. The search page's followees query stays the only
    // read behind its buttons.
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("resolves a duplicate-key refusal into the state it describes", async () => {
    // The first read has not seen the row (it raced another tab); the insert
    // hits the primary key. The end state is already the desired one, so the
    // old "You're already following" error must not surface.
    let reads = 0;
    mockFetch((url, init) => {
      if (url.includes("/auth/sign-in")) return jsonResponse(sessionPayload());
      if ((init?.method ?? "GET") === "POST") {
        return jsonResponse(
          { code: "23505", message: "duplicate key value violates unique constraint" },
          409,
        );
      }
      reads += 1;
      return jsonResponse(reads === 1 ? [] : [followRow()]);
    });
    await signInAs();

    const { result } = renderHook(() => useFollowState(otherUserID));
    await waitFor(() => expect(reads).toBe(1));

    await act(async () => {
      await result.current.toggle();
    });

    expect(reads).toBe(2);
    expect(result.current.following).toBe(true);
    expect(result.current.error).toBeUndefined();
  });

  it("adopts the row when a follow write fails but the relationship exists", async () => {
    let inserted = false;
    mockFetch((url, init) => {
      if (url.includes("/auth/sign-in")) return jsonResponse(sessionPayload());
      if ((init?.method ?? "GET") === "POST") {
        // The response was lost on the wire, but the row landed.
        inserted = true;
        return jsonResponse({ code: "500", message: "The write was lost." }, 500);
      }
      return jsonResponse(inserted ? [followRow()] : []);
    });
    await signInAs();

    const { result } = renderHook(() => useFollowState(otherUserID));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.following).toBe(false);

    await act(async () => {
      await result.current.toggle();
    });

    expect(inserted).toBe(true);
    expect(result.current.following).toBe(true);
    expect(result.current.error).toBeUndefined();
  });

  it("reports the failure when the database still disagrees", async () => {
    mockFetch((url, init) => {
      if (url.includes("/auth/sign-in")) return jsonResponse(sessionPayload());
      if ((init?.method ?? "GET") === "POST") {
        return jsonResponse({ code: "500", message: "The write failed." }, 500);
      }
      return jsonResponse([]);
    });
    await signInAs();

    const { result } = renderHook(() => useFollowState(otherUserID));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.toggle();
    });

    expect(result.current.following).toBe(false);
    expect(result.current.error).toBe("Couldn't update the follow. Try again.");
  });
});
