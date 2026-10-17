import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearSession, getAccessToken, signIn } from "@/lib/auth/session";
import { clearProfile } from "@/lib/users/profile";
import { completeRegistration } from "@/lib/users/registration";

const testUserID = "3f7c2b1e-4d5a-4c9b-8e2f-1a2b3c4d5e6f";
const supabaseBase = "https://project.supabase.co";
const marker = "2026-10-17T12:00:00.000Z";

/** The shape `POST /auth/sign-in` answers with, per the contract. */
function sessionPayload() {
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

/** The shape `PATCH /users/me` answers with, per the contract. */
function profilePayload(overrides: Record<string, unknown> = {}) {
  return {
    id: testUserID,
    username: "player_one",
    displayName: "New Player",
    bio: null,
    role: "user",
    onboardedAt: null,
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-17T12:00:00.000Z",
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

async function signInAs() {
  await signIn("player@example.com", "correct-horse");
}

beforeEach(() => {
  clearSession();
  clearProfile();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("completeRegistration", () => {
  it("stores the name through the users API, then marks the profile exactly once", async () => {
    const spy = mockFetch((url, init) => {
      if (url.includes("/api/v1/auth/sign-in")) return jsonResponse(sessionPayload());
      if (url.includes("/api/v1/users/me")) return jsonResponse(profilePayload());
      if (url.startsWith(supabaseBase)) return jsonResponse([{ onboarded_at: marker }]);
      throw new Error(`unexpected fetch ${url}`);
    });
    await signInAs();

    await completeRegistration("New Player");

    const named = requestOf(spy, 1);
    expect(named.method).toBe("PATCH");
    expect(named.body).toEqual({ displayName: "New Player" });

    const marked = requestOf(spy, 2);
    expect(marked.method).toBe("PATCH");
    const parsed = new URL(marked.url);
    expect(parsed.pathname).toBe("/rest/v1/profiles");
    // The caller's own row, only while the marker is still missing, asked to
    // read back only the column this module is allowed to touch.
    expect(parsed.searchParams.get("id")).toBe(`eq.${testUserID}`);
    expect(parsed.searchParams.get("onboarded_at")).toBe("is.null");
    expect(parsed.searchParams.get("select")).toBe("onboarded_at");
    expect(marked.headers.get("Prefer")).toBe("return=representation");
    // The caller's own token, never the secret key.
    expect(marked.headers.get("Authorization")).toBe("Bearer access-token-1");
    expect(new Date(String(marked.body.onboarded_at)).toISOString()).toBe(marked.body.onboarded_at);
  });

  it("is a no-op when the marker is already set", async () => {
    const spy = mockFetch((url, init) => {
      if (url.includes("/api/v1/auth/sign-in")) return jsonResponse(sessionPayload());
      if ((init?.method ?? "GET") === "PATCH") return jsonResponse([]);
      return jsonResponse([{ onboarded_at: marker }]);
    });
    await signInAs();

    // A retry, a second tab, a resumed sign-in: the row already answers
    // "registered", which is the end state this call exists to reach.
    await expect(completeRegistration()).resolves.toBeUndefined();

    expect(spy).toHaveBeenCalledTimes(3); // sign-in, the conditional write, the re-read
    expect(requestOf(spy, 2).method).toBe("GET");
  });

  it("converges when two completions race", async () => {
    let writes = 0;
    const spy = mockFetch((url, init) => {
      if (url.includes("/api/v1/auth/sign-in")) return jsonResponse(sessionPayload());
      if ((init?.method ?? "GET") === "PATCH") {
        writes += 1;
        // Only the first conditional write matches; the second finds nothing
        // left to do and re-reads the row.
        return jsonResponse(writes === 1 ? [{ onboarded_at: marker }] : []);
      }
      return jsonResponse([{ onboarded_at: marker }]);
    });
    await signInAs();

    await expect(Promise.all([completeRegistration(), completeRegistration()])).resolves.toEqual([
      undefined,
      undefined,
    ]);
    expect(writes).toBe(2);
    expect(spy).toHaveBeenCalledTimes(4); // sign-in, write, write, re-read
  });

  it("reports a missing profile row instead of pretending to register", async () => {
    mockFetch((url, init) => {
      if (url.includes("/api/v1/auth/sign-in")) return jsonResponse(sessionPayload());
      if ((init?.method ?? "GET") === "PATCH") return jsonResponse([]);
      return jsonResponse([]);
    });
    await signInAs();

    await expect(completeRegistration()).rejects.toThrow(/no profile/i);
  });

  it("does not write a blank display name", async () => {
    const spy = mockFetch((url) => {
      if (url.includes("/api/v1/auth/sign-in")) return jsonResponse(sessionPayload());
      return jsonResponse([{ onboarded_at: marker }]);
    });
    await signInAs();

    await completeRegistration("   ");

    // The sign-in and the marker: whitespace is not a name, so the users API
    // is never asked to store one.
    expect(spy).toHaveBeenCalledTimes(2);
    expect(new URL(requestOf(spy, 1).url).pathname).toBe("/rest/v1/profiles");
  });

  it("does not mark anything when the display name is refused", async () => {
    const spy = mockFetch((url) => {
      if (url.includes("/api/v1/auth/sign-in")) return jsonResponse(sessionPayload());
      if (url.includes("/api/v1/users/me")) {
        return jsonResponse(
          { error: { code: "validation_error", message: "Add a display name." } },
          400,
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    await signInAs();

    await expect(completeRegistration("New Player")).rejects.toThrow("Add a display name.");

    // The name is written first for exactly this reason: a refused name must
    // not leave the account marked registered.
    expect(spy).toHaveBeenCalledTimes(2); // sign-in + the refused name write
    expect(new URL(requestOf(spy, 1).url).pathname).toBe("/api/v1/users/me");
  });

  it("refuses to mark an account the caller is not signed in as", async () => {
    const spy = mockFetch(() => jsonResponse({}));

    await expect(completeRegistration("New Player")).rejects.toMatchObject({ status: 401 });
    expect(spy).not.toHaveBeenCalled();
    expect(getAccessToken()).toBeUndefined();
  });
});
