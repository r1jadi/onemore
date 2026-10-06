# 0004 — In-process token buckets now, Redis when the API scales out

* Status: accepted
* Date: 2026-10-05

## Context

The API needs abuse protection from day one: unauthenticated endpoints
(catalogue, search, analytics ingest) and the auth group are the obvious targets.
Redis is on the roadmap but is not deployed, and the API runs as a single instance
today. Adding Redis now would mean operating a stateful dependency for a limit
that one process can enforce correctly.

Two properties matter more than sophistication: the limit must never be the thing
that takes the API down, and it must be cheap to make correct across instances
later.

## Decision

Implement a token-bucket limiter in `httpx` with two buckets:

* `ip:<address>` — the outermost layer, keyed by the real client address derived by
  the gateway, with `X-Forwarded-For` treated as a hint only (never an
  authorization input).
* `user:<uuid>` — applied *after* authentication on authenticated and optional-auth
  routes, so a verified caller is metered by identity rather than by a spoofable
  header, and anonymous traffic is not charged twice.

Defaults: 600 requests/minute, burst 60, configurable with
`RATE_LIMIT_REQUESTS_PER_MINUTE`/`RATE_LIMIT_BURST`. Health probes are exempt so a
throttled client cannot trigger a restart. `429` responses carry `Retry-After`.
Buckets expire after 10 minutes idle and `Cleanup()` runs on a timer, so the map
cannot grow without bound. `RATE_LIMIT_ENABLED=0` is rejected in production.

The limiter's interface is deliberately tiny (`Allow(key) bool`, `Cleanup()`), so
replacing the storage with Redis does not change the middleware.

## Consequences

* Correct on one instance, approximate on several: each instance enforces its own
  budget, so the effective limit multiplies with instance count. Acceptable while
  the API is a single instance, and it degrades to "weaker than configured", not
  "no protection".
* No new infrastructure, no network hop on the hot path, no failure mode where the
  limiter's own dependency outage rejects valid traffic.
* Moving to Redis requires: a shared `Allow` implementation with an atomic
  increment/expire, a timeout plus a fail-open/fail-closed decision (fail-open for
  read traffic, fail-closed for the auth group), and a per-route budget table
  rather than one global number.
* The limits are per route group in name only today — a single budget covers all
  routes. Route-specific budgets (tighter on `/auth`, looser on reads) are a
  follow-up once real traffic exists to size them.
