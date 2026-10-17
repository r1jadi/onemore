import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearSession, signIn } from "@/lib/auth/session";
import { Route as RootRoute } from "@/routes/__root";
import { routeTree } from "@/routeTree.gen";

// The real root renders the whole document shell (`<html>`/`<head>`/`<body>`),
// which jsdom cannot mount inside a test container; every other component under
// test is the real one. `shellComponent` is a Start-level option the core route
// options type does not carry, hence the narrow cast.
delete (RootRoute.options as { shellComponent?: unknown }).shellComponent;

const viewerID = "3f7c2b1e-4d5a-4c9b-8e2f-1a2b3c4d5e6f";
const followedID = "9a8b7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d";
const strangerID = "1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

/** The shape `POST /auth/sign-in` answers with, per the contract. */
function sessionPayload() {
  return {
    session: {
      userId: viewerID,
      role: "user",
      email: "player@example.com",
      onboarded: true,
      // Far enough ahead that this suite never trips the refresh path: the
      // session state under test is unrelated to token rotation.
      expiresAt: "2027-10-08T12:00:00.000Z",
    },
    tokens: {
      accessToken: "access-token-1",
      refreshToken: "refresh-token-1",
      tokenType: "bearer",
      expiresIn: 3600,
    },
    user: {
      id: viewerID,
      email: "player@example.com",
      emailConfirmed: true,
      createdAt: "2026-10-01T00:00:00.000Z",
    },
  };
}

/**
 * `GET /auth/session` re-validates a restored session on boot. It has to answer
 * with the same view, or the cached session's `userId` is replaced by nothing.
 */
function sessionView() {
  return {
    userId: viewerID,
    role: "user",
    email: "player@example.com",
    onboarded: true,
    expiresAt: "2027-10-08T12:00:00.000Z",
  };
}

/** Two real accounts in the public profile projection: one followed, one not. */
function searchResults() {
  return [
    {
      id: followedID,
      username: "followed_player",
      display_name: "Followed Player",
      bio: null,
      avatar_path: null,
    },
    {
      id: strangerID,
      username: "stranger_player",
      display_name: "Stranger Player",
      bio: null,
      avatar_path: null,
    },
  ];
}

/** True for the read that loads the viewer's own followees. */
function isFolloweesRead(url: string): boolean {
  return url.includes("/rest/v1/follows?") && url.includes("select=followee_id");
}

/** True for `isFollowing`'s per-target check. */
function isTargetCheck(url: string): boolean {
  return url.includes("/rest/v1/follows?") && url.includes("followee_id=eq.");
}

async function renderSearch(query: string) {
  const router = createRouter({
    routeTree,
    context: { queryClient: new QueryClient() },
    history: createMemoryHistory({ initialEntries: ["/search"] }),
  });
  render(<RouterProvider router={router} />);
  await act(async () => {
    await router.load();
  });
  fireEvent.change(screen.getByLabelText("Search"), { target: { value: query } });
  return router;
}

/** The row that renders `@username`, or undefined before it is on screen. */
function rowFor(username: string): HTMLElement | undefined {
  const name = screen.queryByText(`@${username}`);
  return name?.parentElement?.parentElement?.parentElement ?? undefined;
}

function followButton(username: string): HTMLButtonElement {
  const row = rowFor(username);
  if (!row) throw new Error(`the ${username} row is not on screen yet`);
  return within(row).getByRole("button") as HTMLButtonElement;
}

beforeEach(() => {
  clearSession();
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("search people follow state", () => {
  it("shows the persisted relationship instead of a pre-read default", async () => {
    // The reported bug: the rows rendered before the viewer's followees were
    // read, the button was seeded with a definite "not following", and the
    // later read never replaced it — so an account the viewer follows showed
    // "Follow" on every search, on every visit.
    let followeesAsked = false;
    let releaseFollowees: (() => void) | undefined;
    const followeesGate = new Promise<Response>((resolve) => {
      releaseFollowees = () =>
        resolve(jsonResponse([{ follower_id: viewerID, followee_id: followedID }]));
    });

    mockFetch((url) => {
      if (url.includes("/auth/sign-in")) return jsonResponse(sessionPayload());
      if (url.includes("/api/v1/auth/session")) return jsonResponse(sessionView());
      if (url.includes("/rest/v1/profiles?") && url.includes("or=")) {
        return jsonResponse(searchResults());
      }
      if (url.includes("/rest/v1/blocked_users")) return jsonResponse([]);
      if (url.includes("/api/v1/games")) return jsonResponse({ items: [], nextCursor: null });
      if (isFolloweesRead(url)) {
        followeesAsked = true;
        return followeesGate;
      }
      // A re-read of one target (an auth event) answers for that target alone.
      if (isTargetCheck(url)) {
        return jsonResponse(
          url.includes(`followee_id=eq.${followedID}`)
            ? [{ follower_id: viewerID, followee_id: followedID }]
            : [],
        );
      }
      return jsonResponse([]);
    });
    await signIn("player@example.com", "correct-horse");

    await renderSearch("play");
    await waitFor(() => expect(followeesAsked).toBe(true), { timeout: 3000 });
    await act(async () => {});

    // The database is the authority on the relationship. While the read is in
    // flight the row is unknown — never a definite "Follow".
    const pending = rowFor("followed_player");
    expect(pending ? within(pending).queryByRole("button", { name: "Follow" }) : null).toBeNull();

    releaseFollowees?.();
    await waitFor(() => expect(followButton("followed_player")).toHaveTextContent("Following"));
    // The other account is not followed, and the screen says so from the same
    // read — not by assuming everything is followed or not followed.
    expect(followButton("stranger_player")).toHaveTextContent("Follow");
  });

  it("verifies each result itself when the viewer's followees cannot be read", async () => {
    const targetReads: string[] = [];
    mockFetch((url) => {
      if (url.includes("/auth/sign-in")) return jsonResponse(sessionPayload());
      if (url.includes("/rest/v1/profiles?") && url.includes("or=")) {
        return jsonResponse(searchResults());
      }
      if (url.includes("/rest/v1/blocked_users")) return jsonResponse([]);
      if (url.includes("/api/v1/games")) return jsonResponse({ items: [], nextCursor: null });
      if (url.includes("/api/v1/auth/session")) return jsonResponse(sessionView());
      if (isFolloweesRead(url)) return jsonResponse({ message: "unavailable" }, 500);
      if (isTargetCheck(url)) {
        targetReads.push(url);
        return jsonResponse(
          url.includes(`followee_id=eq.${followedID}`)
            ? [{ follower_id: viewerID, followee_id: followedID }]
            : [],
        );
      }
      return jsonResponse([]);
    });
    await signIn("player@example.com", "correct-horse");

    await renderSearch("play");

    // The batch read failed; the relationship is unknown, so each row answers
    // for its own target instead of everyone defaulting to "Follow".
    await waitFor(() => expect(followButton("followed_player")).toHaveTextContent("Following"), {
      timeout: 3000,
    });
    expect(followButton("stranger_player")).toHaveTextContent("Follow");
    expect(targetReads.length).toBe(2);
  });

  it("reports an unverifiable follow state instead of presenting a default", async () => {
    mockFetch((url) => {
      if (url.includes("/auth/sign-in")) return jsonResponse(sessionPayload());
      if (url.includes("/rest/v1/profiles?") && url.includes("or=")) {
        return jsonResponse(searchResults());
      }
      if (url.includes("/rest/v1/blocked_users")) return jsonResponse([]);
      if (url.includes("/api/v1/games")) return jsonResponse({ items: [], nextCursor: null });
      if (url.includes("/api/v1/auth/session")) return jsonResponse(sessionView());
      if (isFolloweesRead(url) || isTargetCheck(url)) {
        return jsonResponse({ message: "unavailable" }, 503);
      }
      return jsonResponse([]);
    });
    await signIn("player@example.com", "correct-horse");

    await renderSearch("play");

    // Neither read succeeded, so the relationship is unknown. Silence would
    // present the button's default as an answer; the failure has to be visible.
    const alerts = await screen.findAllByText(/couldn't check your follow state/i);
    expect(alerts.length).toBeGreaterThan(0);
  });

  it("does not read a follow graph for a signed-out visitor", async () => {
    const followReads: string[] = [];
    mockFetch((url) => {
      if (url.includes("/rest/v1/profiles?") && url.includes("or=")) {
        return jsonResponse(searchResults());
      }
      if (url.includes("/api/v1/games")) return jsonResponse({ items: [], nextCursor: null });
      if (url.includes("/rest/v1/follows")) {
        followReads.push(url);
        return jsonResponse([]);
      }
      return jsonResponse([]);
    });

    await renderSearch("play");

    expect(await screen.findByText("@followed_player")).toBeInTheDocument();
    // Anonymous visitors follow nobody; that answer needs no request and the
    // screen must not invent one.
    expect(followButton("followed_player")).toHaveTextContent("Follow");
    expect(followButton("stranger_player")).toHaveTextContent("Follow");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(followReads).toEqual([]);
  });

  it("updates a result immediately when the viewer follows and unfollows", async () => {
    const writes: Array<{ method: string; url: string }> = [];
    // The stub mirrors the follow graph so any re-read (a re-check, an auth
    // event) answers with what the accepted write stored.
    const followed = new Set<string>([followedID]);
    mockFetch((url, init) => {
      const method = init?.method ?? "GET";
      if (url.includes("/auth/sign-in")) return jsonResponse(sessionPayload());
      if (url.includes("/rest/v1/profiles?") && url.includes("or=")) {
        return jsonResponse(searchResults());
      }
      if (url.includes("/rest/v1/blocked_users")) return jsonResponse([]);
      if (url.includes("/api/v1/games")) return jsonResponse({ items: [], nextCursor: null });
      if (url.includes("/api/v1/auth/session")) return jsonResponse(sessionView());
      if (url.includes("/rest/v1/follows") && (method === "POST" || method === "DELETE")) {
        writes.push({ method, url });
        const target = url.includes(followedID) ? followedID : strangerID;
        if (method === "POST") followed.add(target);
        else followed.delete(target);
        return new Response(null, { status: method === "POST" ? 201 : 204 });
      }
      if (isFolloweesRead(url)) {
        return jsonResponse(
          [...followed].map((id) => ({ follower_id: viewerID, followee_id: id })),
        );
      }
      if (isTargetCheck(url)) {
        const target = url.includes(followedID) ? followedID : strangerID;
        return jsonResponse(
          followed.has(target) ? [{ follower_id: viewerID, followee_id: target }] : [],
        );
      }
      return jsonResponse([]);
    });
    await signIn("player@example.com", "correct-horse");

    await renderSearch("play");
    await waitFor(() => expect(followButton("stranger_player")).toHaveTextContent("Follow"), {
      timeout: 3000,
    });
    await waitFor(() => expect(followButton("followed_player")).toHaveTextContent("Following"));

    // Following: the button reflects the accepted write with no reload.
    fireEvent.click(followButton("stranger_player"));
    await waitFor(() => expect(followButton("stranger_player")).toHaveTextContent("Following"));

    // Unfollowing: same, in the other direction.
    fireEvent.click(followButton("stranger_player"));
    await waitFor(() => expect(followButton("stranger_player")).toHaveTextContent("Follow"));

    expect(writes.map((write) => write.method)).toEqual(["POST", "DELETE"]);
    expect(writes[0].url).toContain("on_conflict=follower_id,followee_id");
  });
});
