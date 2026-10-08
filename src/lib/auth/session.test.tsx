import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";
import {
  clearSession,
  getAccessToken,
  getAuthState,
  loadSession,
  refreshSession,
  signIn,
  signOut,
  signUp,
  useAuth,
} from "@/lib/auth/session";

const testUserID = "3f7c2b1e-4d5a-4c9b-8e2f-1a2b3c4d5e6f";

/** The shape `POST /auth/sign-in` answers with, per the contract. */
function sessionPayload(overrides: Record<string, unknown> = {}) {
  return {
    session: {
      userId: testUserID,
      role: "user",
      email: "player@example.com",
      onboarded: false,
      expiresAt: "2026-10-08T12:00:00.000Z",
    },
    tokens: {
      accessToken: "access-token-1",
      refreshToken: "refresh-token-1",
      tokenType: "bearer",
      expiresAt: "2026-10-08T12:00:00.000Z",
      expiresIn: 3600,
    },
    user: {
      id: testUserID,
      email: "player@example.com",
      emailConfirmed: true,
      createdAt: "2026-10-01T00:00:00.000Z",
    },
    ...overrides,
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

function errorResponse(status: number, code: string, message: string) {
  return jsonResponse({ error: { code, message, request_id: "req-abc123" } }, status);
}

function requestOf(spy: ReturnType<typeof mockFetch>, index = 0) {
  const call = spy.mock.calls[index];
  if (!call) throw new Error(`no request at index ${index}`);
  const [input, init] = call;
  return {
    path: new URL(String(input)).pathname,
    method: init?.method ?? "GET",
    headers: new Headers(init?.headers),
    body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
  };
}

beforeEach(() => {
  clearSession();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("signIn", () => {
  it("posts the credential to the auth service and adopts the session", async () => {
    const spy = mockFetch(() => jsonResponse(sessionPayload()));

    await expect(signIn("player@example.com", "correct-horse")).resolves.toMatchObject({
      session: { userId: testUserID, role: "user" },
    });

    const request = requestOf(spy);
    expect(request.method).toBe("POST");
    expect(request.path).toBe("/api/v1/auth/sign-in");
    // Exactly the two documented fields: the endpoint rejects unknown ones.
    expect(request.body).toEqual({ email: "player@example.com", password: "correct-horse" });
    // The credential is the request, so it is not repeated in a header.
    expect(request.headers.get("Authorization")).toBeNull();

    expect(getAuthState()).toEqual({
      status: "authenticated",
      session: expect.objectContaining({ userId: testUserID }),
    });
    expect(getAccessToken()).toBe("access-token-1");
  });

  it("stays anonymous and surfaces the envelope when the credential is wrong", async () => {
    mockFetch(() => errorResponse(401, "unauthorized", "That email and password do not match."));

    const failure = await signIn("player@example.com", "wrong").catch((error) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure.code).toBe("unauthorized");
    expect(failure.status).toBe(401);
    // The server's message is the one the user sees; nothing is invented here.
    expect(failure.message).toBe("That email and password do not match.");
    expect(failure.requestId).toBe("req-abc123");
    expect(getAuthState()).toEqual({ status: "anonymous" });
    expect(getAccessToken()).toBeUndefined();
  });
});

describe("signUp", () => {
  it("reports a confirmation-pending signup as success without a session", async () => {
    mockFetch(() =>
      jsonResponse(
        {
          session: { userId: testUserID, role: "user", email: "player@example.com" },
          user: {
            id: testUserID,
            email: "player@example.com",
            emailConfirmed: false,
            createdAt: "2026-10-01T00:00:00.000Z",
          },
        },
        201,
      ),
    );

    const payload = await signUp("player@example.com", "correct-horse-battery");

    expect(payload.tokens).toBeUndefined();
    expect(payload.user?.emailConfirmed).toBe(false);
    // No tokens means not signed in: the caller must not be treated as one.
    expect(getAuthState()).toEqual({ status: "anonymous" });
  });

  it("signs the caller in when Supabase returns a session", async () => {
    const spy = mockFetch(() => jsonResponse(sessionPayload(), 201));

    await signUp("player@example.com", "correct-horse-battery");

    expect(requestOf(spy).path).toBe("/api/v1/auth/sign-up");
    expect(getAuthState().status).toBe("authenticated");
  });

  it("surfaces an existing account as a conflict", async () => {
    mockFetch(() => errorResponse(409, "conflict", "An account with that email already exists."));

    const failure = await signUp("player@example.com", "correct-horse-battery").catch((e) => e);

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure.status).toBe(409);
    expect(failure.message).toBe("An account with that email already exists.");
  });
});

describe("refreshSession", () => {
  it("rotates both tokens", async () => {
    const spy = mockFetch((url) =>
      url.endsWith("/auth/refresh")
        ? jsonResponse(
            sessionPayload({
              tokens: {
                accessToken: "access-token-2",
                refreshToken: "refresh-token-2",
                tokenType: "bearer",
                expiresIn: 3600,
              },
            }),
          )
        : jsonResponse(sessionPayload()),
    );

    await signIn("player@example.com", "correct-horse");
    await refreshSession();

    const request = requestOf(spy, 1);
    expect(request.path).toBe("/api/v1/auth/refresh");
    expect(request.body).toEqual({ refreshToken: "refresh-token-1" });
    expect(getAccessToken()).toBe("access-token-2");
  });

  it("refuses to call the API without a session to rotate", async () => {
    const spy = mockFetch(() => jsonResponse(sessionPayload()));

    await expect(refreshSession()).rejects.toThrow(/no session to refresh/i);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("loadSession", () => {
  it("reads the session with the stored token as a bearer header", async () => {
    const spy = mockFetch((url) =>
      url.endsWith("/auth/sign-in")
        ? jsonResponse(sessionPayload())
        : jsonResponse({ userId: testUserID, role: "admin", onboarded: true }),
    );

    await signIn("player@example.com", "correct-horse");
    const session = await loadSession();

    const request = requestOf(spy, 1);
    expect(request.method).toBe("GET");
    expect(request.path).toBe("/api/v1/auth/session");
    expect(request.headers.get("Authorization")).toBe("Bearer access-token-1");
    expect(request.body).toBeUndefined();
    expect(session).toEqual({ userId: testUserID, role: "admin", onboarded: true });
  });

  it("refuses to call the API while anonymous", async () => {
    const spy = mockFetch(() => jsonResponse({}));

    await expect(loadSession()).rejects.toThrow(/no session to read/i);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("signOut", () => {
  it("revokes the session and forgets it locally", async () => {
    const spy = mockFetch((url) =>
      url.endsWith("/auth/sign-in")
        ? jsonResponse(sessionPayload())
        : new Response(null, { status: 204 }),
    );

    await signIn("player@example.com", "correct-horse");
    await signOut();

    const request = requestOf(spy, 1);
    expect(request.method).toBe("POST");
    expect(request.path).toBe("/api/v1/auth/sign-out");
    expect(request.headers.get("Authorization")).toBe("Bearer access-token-1");
    expect(getAuthState()).toEqual({ status: "anonymous" });
    expect(getAccessToken()).toBeUndefined();
  });

  it("forgets the session even when the revoke fails", async () => {
    mockFetch((url) =>
      url.endsWith("/auth/sign-in")
        ? jsonResponse(sessionPayload())
        : errorResponse(503, "service_unavailable", "Authentication is not available right now."),
    );

    await signIn("player@example.com", "correct-horse");

    await expect(signOut()).rejects.toBeInstanceOf(ApiError);
    // A signed-out screen is the point of signing out; a network failure must not
    // leave the app holding a token it can no longer revoke.
    expect(getAuthState()).toEqual({ status: "anonymous" });
    expect(getAccessToken()).toBeUndefined();
  });

  it("does nothing while anonymous", async () => {
    const spy = mockFetch(() => jsonResponse({}));

    await expect(signOut()).resolves.toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("credential handling", () => {
  it("never writes a token to web storage or a cookie", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    mockFetch(() => jsonResponse(sessionPayload()));

    await signIn("player@example.com", "correct-horse");

    expect(setItem).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    expect(document.cookie).not.toContain("access-token-1");
  });

  it("keeps the password out of the error path", async () => {
    mockFetch(() => errorResponse(500, "internal_error", "Something went wrong."));

    const failure = await signIn("player@example.com", "correct-horse").catch((e) => e);

    expect(String(failure)).not.toContain("correct-horse");
  });
});

describe("useAuth", () => {
  function Probe() {
    const auth = useAuth();
    return <span>{auth.status === "authenticated" ? auth.session.userId : "signed out"}</span>;
  }

  it("re-renders the tree when a session arrives and when it ends", async () => {
    mockFetch((url) =>
      url.endsWith("/auth/sign-out")
        ? new Response(null, { status: 204 })
        : jsonResponse(sessionPayload()),
    );

    render(<Probe />);
    expect(screen.getByText("signed out")).toBeInTheDocument();

    await act(async () => {
      await signIn("player@example.com", "correct-horse");
    });
    expect(screen.getByText(testUserID)).toBeInTheDocument();

    await act(async () => {
      await signOut();
    });
    expect(screen.getByText("signed out")).toBeInTheDocument();
  });
});
