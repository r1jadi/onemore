/**
 * The application session, as the Go auth service defines it.
 *
 * The web app never talks to Supabase Auth directly: `/api/v1/auth/*` is the
 * credential surface (see packages/api-contracts/openapi-v1.yaml), so no Supabase
 * key — publishable or secret — has to be embedded in a page, and one place
 * decides how a session is stored.
 *
 * Storage rule: the token pair lives in memory only, for the lifetime of the
 * page. Nothing writes a credential to `localStorage`, `sessionStorage` or a
 * cookie, so a script injected into the page cannot read a refresh token back
 * out of web storage. The trade-off is explicit: a reload starts anonymous, and
 * restoring a session on boot is a deliberate decision for whoever adds route
 * guards — not something to slip in behind the existing screens.
 */

import { useSyncExternalStore } from "react";

import { ApiError, apiFetch } from "@/lib/api/client";
import { publicConfig } from "@/lib/config";

/** Routes implemented by `services/auth`. Kept together so they cannot drift. */
const Routes = {
  signUp: "/auth/sign-up",
  signIn: "/auth/sign-in",
  refresh: "/auth/refresh",
  session: "/auth/session",
  signOut: "/auth/sign-out",
} as const;

export type SessionRole = "user" | "moderator" | "admin";

/** The session view. It never contains a token. */
export type Session = {
  userId: string;
  role: SessionRole;
  email?: string;
  /** Absent when the server could not read it — not the same as `false`. */
  onboarded?: boolean;
  expiresAt?: string;
};

/** The Supabase token pair. Returned by the credential and refresh endpoints. */
export type Tokens = {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresAt?: string;
  expiresIn?: number;
};

/** The Supabase user record, trimmed to what the app shows. */
export type AuthUser = {
  id: string;
  email: string;
  emailConfirmed: boolean;
  createdAt: string;
};

/**
 * What sign-up, sign-in and refresh return. `tokens` (and therefore a usable
 * session) are absent while Supabase still requires email confirmation.
 */
export type AuthSession = {
  session: Session;
  tokens?: Tokens;
  user?: AuthUser;
};

export type AuthState = { status: "anonymous" } | { status: "authenticated"; session: Session };

let state: AuthState = { status: "anonymous" };
let tokens: Tokens | undefined;
const listeners = new Set<() => void>();

function publish(next: AuthState): void {
  state = next;
  for (const listener of listeners) listener();
}

/** Subscribes to session changes. Passed straight to `useSyncExternalStore`. */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The current session state. Stable between changes, so it is safe as a snapshot. */
export function getAuthState(): AuthState {
  return state;
}

/**
 * The bearer token to send with API calls, or `undefined` while anonymous.
 * Callers pass it to `apiFetch`'s `token` option; it is never put in a URL.
 */
export function getAccessToken(): string | undefined {
  return tokens?.accessToken;
}

/** Reads the session reactively. */
export function useAuth(): AuthState {
  return useSyncExternalStore(subscribe, getAuthState, getAuthState);
}

/**
 * Adopts the session a credential call returned.
 *
 * A response without tokens means Supabase created the account and is waiting
 * for email confirmation: the caller is not signed in yet, and reporting one
 * would be a lie the rest of the app would act on.
 */
function adopt(payload: AuthSession): AuthSession {
  if (payload.tokens) {
    tokens = payload.tokens;
    publish({ status: "authenticated", session: payload.session });
  }
  return payload;
}

/** Forgets the session locally. Used by sign-out and between tests. */
export function clearSession(): void {
  tokens = undefined;
  publish({ status: "anonymous" });
}

/**
 * The message to show a user when an auth call fails.
 *
 * The API writes messages that are safe to display ("That email and password do
 * not match."), so they are passed through unchanged rather than re-worded here
 * — one place decides what a caller is told. Anything else is a bug or a
 * transport failure, and gets a generic message instead of an internal detail.
 */
export function authErrorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Something went wrong. Please try again.";
}

/** Creates an account. Resolves with no tokens while confirmation is pending. */
export function signUp(email: string, password: string): Promise<AuthSession> {
  return apiFetch<AuthSession>(Routes.signUp, {
    method: "POST",
    body: { email, password },
  }).then(adopt);
}

function supabaseAuthBase(): { url: string; publishableKey: string } {
  const url = publicConfig.supabase.url.replace(/\/+$/, "");
  const publishableKey = publicConfig.supabase.publishableKey;
  if (url === "" || publishableKey === "") {
    throw new Error(
      "Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (see .env.example).",
    );
  }
  return { url, publishableKey };
}

/** Asks Supabase to re-send the confirmation email for an unconfirmed address. */
export async function resendConfirmation(email: string): Promise<void> {
  const { url, publishableKey } = supabaseAuthBase();
  const response = await fetch(`${url}/auth/v1/resend`, {
    method: "POST",
    headers: {
      apikey: publishableKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type: "signup", email }),
  });
  if (!response.ok) {
    throw new ApiError("We could not re-send the confirmation email. Try again shortly.", {
      code: "resend_failed",
      status: response.status,
    });
  }
}

/**
 * Verifies a Supabase email-confirmation link (`token_hash` + `type`) and
 * returns the Supabase token pair. This is the link format Supabase sends for
 * signup confirmation; no six-digit code is involved.
 */
export async function verifyEmailLink(
  tokenHash: string,
  type: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const { url, publishableKey } = supabaseAuthBase();
  const response = await fetch(`${url}/auth/v1/verify`, {
    method: "POST",
    headers: {
      apikey: publishableKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ token_hash: tokenHash, type }),
  });
  if (!response.ok) {
    throw new ApiError("That confirmation link is invalid or has expired. Request a new one.", {
      code: "invalid_confirmation",
      status: response.status,
    });
  }
  const payload = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
  };
  if (!payload.access_token || !payload.refresh_token) {
    throw new ApiError("That confirmation link is invalid or has expired. Request a new one.", {
      code: "invalid_confirmation",
      status: 400,
    });
  }
  return { accessToken: payload.access_token, refreshToken: payload.refresh_token };
}

/**
 * Exchanges a verified Supabase access token for the application session and
 * adopts the returned token pair. `POST /auth/session` verifies the token
 * server-side, so an arbitrary URL parameter can never count as proof of
 * authentication — only a token Supabase issued and the backend verified does.
 */
export async function adoptSupabaseTokens(input: {
  accessToken: string;
  refreshToken: string;
  expiresIn?: number;
}): Promise<AuthSession> {
  const view = await apiFetch<Session>(Routes.session, {
    method: "POST",
    body: { accessToken: input.accessToken },
  });
  tokens = {
    accessToken: input.accessToken,
    refreshToken: input.refreshToken,
    tokenType: "bearer",
    expiresIn: input.expiresIn,
  };
  publish({ status: "authenticated", session: view });
  return { session: view, tokens: tokens as Tokens };
}

/**
 * The Supabase OAuth entry point for Google sign-in/up (PKCE, no secrets).
 *
 * Async because the S256 code challenge must be derived before the redirect:
 * without `code_challenge` Supabase falls back to the implicit flow instead of
 * returning the `?code=` the callback exchanges. The `apikey` query parameter
 * is required too — a browser redirect carries no headers, and the gateway
 * rejects authorize calls without it.
 */
export async function googleAuthorizeUrl(next = "/"): Promise<string> {
  const { url, publishableKey } = supabaseAuthBase();
  const redirectTo = new URL("/auth/callback", window.location.origin);
  redirectTo.searchParams.set("next", next);
  // PKCE: generate a verifier now and keep it for the callback exchange. It is
  // a single-use random value in sessionStorage, never a long-lived token.
  const verifier = randomVerifier();
  try {
    sessionStorage.setItem("onemore-oauth-verifier", verifier);
  } catch {
    // Storage may be unavailable (private mode); the callback then reports a
    // clear error instead of silently failing.
  }
  const challenge = await codeChallenge(verifier);
  const authorize = new URL(`${url}/auth/v1/authorize`);
  authorize.searchParams.set("provider", "google");
  authorize.searchParams.set("redirect_to", redirectTo.toString());
  // The publishable key is public by design (it ships in the web bundle).
  authorize.searchParams.set("apikey", publishableKey);
  authorize.searchParams.set("code_challenge", challenge);
  authorize.searchParams.set("code_challenge_method", "s256");
  return authorize.toString();
}

function randomVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const bytes = new Uint8Array(digest);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Exchanges an OAuth authorization `code` for Supabase tokens (PKCE) and then
 * for the application session. Rejects when the verifier is missing (a fresh
 * tab, cleared storage) rather than inventing a session.
 */
export async function exchangeOAuthCode(code: string): Promise<AuthSession> {
  const { url, publishableKey } = supabaseAuthBase();
  let verifier: string | null = null;
  try {
    verifier = sessionStorage.getItem("onemore-oauth-verifier");
  } catch {
    verifier = null;
  }
  if (!verifier) {
    throw new ApiError("That sign-in did not finish. Start again from Log in.", {
      code: "oauth_verifier_missing",
      status: 400,
    });
  }
  const response = await fetch(`${url}/auth/v1/token?grant_type=pkce`, {
    method: "POST",
    headers: {
      apikey: publishableKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
  });
  if (!response.ok) {
    throw new ApiError("That Google sign-in did not complete. Try again.", {
      code: "oauth_exchange_failed",
      status: response.status,
    });
  }
  const payload = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!payload.access_token || !payload.refresh_token) {
    throw new ApiError("That Google sign-in did not complete. Try again.", {
      code: "oauth_exchange_failed",
      status: 400,
    });
  }
  try {
    sessionStorage.removeItem("onemore-oauth-verifier");
  } catch {
    // Best effort cleanup only.
  }
  // Tokens are verified by the backend before they are trusted (see above).
  return adoptSupabaseTokens({
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresIn: payload.expires_in,
  });
}

/** Changes the password for the current session through Supabase Auth. */
export async function changePassword(newPassword: string): Promise<void> {
  const token = getAccessToken();
  if (!token) {
    throw new ApiError("Sign in to change your password.", {
      code: "unauthorized",
      status: 401,
    });
  }
  if (newPassword.length < 8) {
    throw new ApiError("Use at least 8 characters for your password.", {
      code: "unprocessable_entity",
      status: 422,
    });
  }
  const { url, publishableKey } = supabaseAuthBase();
  const response = await fetch(`${url}/auth/v1/user`, {
    method: "PUT",
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password: newPassword }),
  });
  if (!response.ok) {
    throw new ApiError("That password could not be saved. Try a stronger one.", {
      code: "password_change_failed",
      status: response.status,
    });
  }
}

/** Reads the provider identities linked to the current Supabase user. */
export async function fetchLinkedProviders(): Promise<Array<{ provider: string }>> {
  const token = getAccessToken();
  if (!token) return [];
  const { url, publishableKey } = supabaseAuthBase();
  const response = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: publishableKey, Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return [];
  const payload = (await response.json()) as { identities?: Array<{ provider?: string }> };
  return (payload.identities ?? [])
    .map((identity) => ({ provider: String(identity.provider ?? "").toLowerCase() }))
    .filter((entry) => entry.provider !== "");
}

/** Exchanges an email and password for a session. */
export function signIn(email: string, password: string): Promise<AuthSession> {
  return apiFetch<AuthSession>(Routes.signIn, {
    method: "POST",
    body: { email, password },
  }).then(adopt);
}

/**
 * Rotates the current session: the new pair always replaces the stored one.
 *
 * Whether Supabase also invalidates the *previous* refresh token depends on the
 * project's refresh-token rotation setting, and it is a project setting rather
 * than something this client controls. It was measured **off** for this project
 * on 2026-10-08 — the same refresh token was accepted repeatedly, a minute
 * apart — so until that changes, a refresh token has to be treated as a live
 * credential for its whole lifetime rather than as single-use. See the
 * production verification section of docs/deployment/vercel.md.
 */
export function refreshSession(): Promise<AuthSession> {
  const refreshToken = tokens?.refreshToken;
  if (!refreshToken) {
    return Promise.reject(new Error("There is no session to refresh."));
  }
  return apiFetch<AuthSession>(Routes.refresh, {
    method: "POST",
    body: { refreshToken },
  }).then(adopt);
}

/**
 * Confirms the stored token against the server and returns the session it
 * belongs to. The body of `GET /auth/session` comes from the verified token, so
 * this is the authoritative answer to "is this session still valid".
 */
export async function loadSession(): Promise<Session> {
  const token = getAccessToken();
  if (!token) {
    throw new Error("There is no session to read.");
  }
  return apiFetch<Session>(Routes.session, { token });
}

/**
 * Revokes the session and forgets it locally.
 *
 * The local session is cleared before the request is sent, so a failure cannot
 * leave a signed-out user holding a token. A failed revoke is reported to the
 * caller rather than swallowed; the access token stops being accepted when it
 * expires regardless.
 */
export async function signOut(): Promise<void> {
  const token = getAccessToken();
  clearSession();
  if (!token) return;
  await apiFetch<void>(Routes.signOut, { method: "POST", token });
}
