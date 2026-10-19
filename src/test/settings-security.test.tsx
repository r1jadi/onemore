import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SESSION_STORAGE_KEY, clearSession, signIn } from "@/lib/auth/session";
import { SecuritySection } from "@/routes/settings.$section";

const testUserID = "3f7c2b1e-4d5a-4c9b-8e2f-1a2b3c4d5e6f";
const supabaseBase = "https://project.supabase.co";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

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

/**
 * The bug this test guards against: the Security screen's Log out was a link to
 * `/settings`, so it navigated without ever revoking or clearing the session.
 */
async function renderSecurity() {
  const root = createRootRoute();
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({
        getParentRoute: () => root,
        path: "/settings/security",
        component: () => <SecuritySection signedIn />,
      }),
      createRoute({
        getParentRoute: () => root,
        path: "/welcome",
        component: () => <p>welcome</p>,
      }),
    ]),
    history: createMemoryHistory({ initialEntries: ["/settings/security"] }),
  });
  render(<RouterProvider router={router} />);
  await act(async () => {
    await router.load();
  });
  return router;
}

beforeEach(() => {
  clearSession();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("security settings", () => {
  it("logs out instead of navigating to settings", async () => {
    const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/v1/auth/sign-in")) return jsonResponse(sessionPayload());
      if (url.includes("/api/v1/auth/session")) {
        return jsonResponse({ userId: testUserID, role: "user" });
      }
      if (url.includes("/api/v1/auth/sign-out") && init?.method === "POST") {
        return jsonResponse({});
      }
      if (url.includes("/api/v1/admin/session")) {
        return jsonResponse({ userId: testUserID, role: "user", isStaff: false });
      }
      if (url.startsWith(supabaseBase)) return jsonResponse([]);
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", spy);

    await signIn("player@example.com", "correct-horse");
    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).not.toBeNull();

    const router = await renderSecurity();
    expect(screen.getByRole("button", { name: "Log out" })).toBeInTheDocument();

    await act(async () => {
      screen.getByRole("button", { name: "Log out" }).click();
    });

    await waitFor(() => expect(router.state.location.pathname).toBe("/welcome"));
    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
    expect(spy.mock.calls.some(([input]) => String(input).includes("/auth/sign-out"))).toBe(true);
  });
});
