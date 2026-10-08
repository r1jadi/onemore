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
