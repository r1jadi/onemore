import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearSession, SESSION_STORAGE_KEY } from "@/lib/auth/session";
import { Route as RootRoute } from "@/routes/__root";
import { routeTree } from "@/routeTree.gen";

delete (RootRoute.options as { shellComponent?: unknown }).shellComponent;

const testUserID = "3f7c2b1e-4d5a-4c9b-8e2f-1a2b3c4d5e6f";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * The Google OAuth round trip: the PKCE token exchange succeeds and the backend
 * answers with a session view whose `onboarded` is the server's answer. That
 * single field is what tells a brand-new Google account apart from a returning
 * one, so the callback routes on it instead of sending everyone to the feed.
 */
function stubOAuth(onboarded: boolean) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/auth/v1/token")) {
      return jsonResponse({
        access_token: "supabase-access-token",
        refresh_token: "supabase-refresh-token",
        expires_in: 3600,
        token_type: "bearer",
      });
    }
    if (url.endsWith("/api/v1/auth/session")) {
      return jsonResponse({
        userId: testUserID,
        role: "user",
        email: "player@example.com",
        onboarded,
      });
    }
    // The profile page the registered-account case lands on reads its header
    // from `GET /users/me`.
    if (url.endsWith("/api/v1/users/me")) {
      return jsonResponse({
        id: testUserID,
        username: "player_one",
        displayName: "Player One",
        bio: null,
        role: "user",
        onboardedAt: "2026-10-01T00:00:00.000Z",
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:00.000Z",
      });
    }
    return jsonResponse([]);
  });
}

async function renderCallback(onboarded: boolean, next = "/login") {
  vi.stubGlobal("fetch", stubOAuth(onboarded));
  sessionStorage.setItem("onemore-oauth-verifier", "test-verifier");
  const router = createRouter({
    routeTree,
    context: { queryClient: new QueryClient() },
    history: createMemoryHistory({
      initialEntries: [`/auth/callback?code=oauth-code&next=${encodeURIComponent(next)}`],
    }),
  });
  render(<RouterProvider router={router} />);
  await act(async () => {
    await router.load();
  });
  return router;
}

beforeEach(() => {
  clearSession();
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  sessionStorage.clear();
  window.localStorage.removeItem(SESSION_STORAGE_KEY);
});

describe("Google OAuth callback", () => {
  it("sends a new account to registration and keeps the session", async () => {
    const router = await renderCallback(false);

    await waitFor(() => expect(router.state.location.pathname).toBe("/signup"));
    // The completion step, not a fresh credential form: the Google account
    // already exists as an auth user, it just has no registration marker yet.
    expect(await screen.findByText("Choose your name")).toBeInTheDocument();
    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).not.toBeNull();
  });

  it("takes an existing account to where it was going, not through registration", async () => {
    const router = await renderCallback(true, "/login");

    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(screen.queryByText("Choose your name")).toBeNull();
    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).not.toBeNull();
  });

  it("never lands a registered account on the sign-up screen", async () => {
    const router = await renderCallback(true, "/signup");

    await waitFor(() => expect(router.state.location.pathname).toBe("/profile"));
    expect(screen.queryByText("Create your account")).toBeNull();
  });

  it("explains a Google identity that cannot attach to an existing account", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse([])),
    );
    const router = createRouter({
      routeTree,
      context: { queryClient: new QueryClient() },
      history: createMemoryHistory({
        initialEntries: ["/auth/callback?error=email_exists&error_description=Email+exists"],
      }),
    });
    render(<RouterProvider router={router} />);
    await act(async () => {
      await router.load();
    });

    // Nothing was created, and the way in is the existing account.
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "An account with this email already exists. Please sign in instead.",
    );
    expect(screen.getByRole("link", { name: "Back to log in" })).toBeInTheDocument();
  });
});
