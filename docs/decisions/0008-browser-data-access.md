# 0008 — The browser uses /api/v1 for domain data, and Supabase directly only for auth and storage

* Status: accepted
* Date: 2026-10-05

## Context

Supabase offers a REST and realtime API straight from the browser with the
publishable key. That is convenient, but it spreads the product's rules across two
places: some reads come from PostgREST under RLS, others from the Go API. Rules
that are not expressible as a policy (rate limits, derived fields, aggregation,
referral logic, anti-cheat) would end up in the client, where they cannot be
enforced at all. It also makes the API contract optional, which is the opposite of
what `packages/api-contracts` is for.

A browser-facing database client also has to be versioned with the schema rather
than with the API, so a migration can break deployed clients without warning.

## Decision

* **Auth and storage go direct.** The browser uses Supabase for sign-in, session
  management, token refresh, password reset and storage uploads/downloads
  (avatars, game assets). Supabase Auth is the identity provider
  ([0003](0003-authentication-and-identity.md)); RLS plus bucket policies protect
  what it touches.
* **Domain data goes through `/api/v1`.** Games, sessions, scores, leaderboards,
  feed, comments, follows, notifications, search, moderation and admin data are
  read and written with `src/lib/api/client.ts` (`apiFetch`), authenticated with the
  Supabase access token in the `Authorization` header.
* **No direct table access** from the client for domain data, even though RLS is
  configured and tested. RLS is the second line of defence, not the API.
* **No service key in the browser**, ever.
* The publishable Supabase URL and anon key are the only Supabase values in the
  client bundle.

## Consequences

* One place defines the product's rules, with validation, rate limiting and
  authorization in the same request — and the contract in
  `packages/api-contracts/openapi-v1.yaml` stays true.
* Every domain read costs an API hop instead of a direct database round trip.
  Acceptable today; if a read becomes latency-critical, it is optimised behind the
  API (caching, a materialised view, a purpose-built endpoint) rather than by
  bypassing it.
* Realtime subscriptions are not available for domain data. When live updates are
  needed, they go through the notifications or events service, or a dedicated
  channel decision recorded in a new ADR.
* A schema migration never breaks a deployed client by itself: the API contract is
  the compatibility boundary.
* The migration from `src/lib/mock.ts` to the API happens feature by feature; until
  each feature lands, the mock data remains the UI's source.
