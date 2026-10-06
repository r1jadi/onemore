# API hardening

## The chain

Every request passes through the same middleware, assembled once in
`httpx.NewServer`. Order is the specification; `httpx.Chain` applies the first
argument outermost:

```
RequestID          trust an inbound X-Request-ID only when it looks like one,
                   otherwise generate 96 bits of randomness, echo it, and put it
                   in the request context
Recover            a panic becomes a logged 500 with the standard envelope —
                   never a stack trace to the client
SecurityHeaders    nosniff · DENY · no-referrer · CORP same-site · COOP
                   same-origin · Permissions-Policy (camera/mic/geo/payment off)
                   · CSP default-src 'none' · no-store · HSTS in production only
CORS               exact origin allowlist; `*` only in development; credentials
                   are never combined with a wildcard; OPTIONS answered 204;
                   unlisted origins get no CORS headers at all
StripIdentityHeaders
                   delete X-User-ID, X-User-Role, X-Admin, X-Forwarded-User,
                   X-Supabase-Auth … before anything can read them
RequestLogger      one structured JSON line per request with id, route, status,
                   bytes, duration and user id when known
[ExtraHandlers]    the gateway installs its reverse proxy here
RateLimit          per-IP token bucket for anonymous traffic (probes exempt)
BodyLimit          1 MiB MaxBytesReader on every request body
mux                route-level authentication (public / optional / auth / staff)
```

Two details that matter:

* the identity headers are stripped **before** any handler and again inside the
  gateway before forwarding, so a client cannot impersonate a user to a service
  behind the gateway;
* the rate limiter is the outermost layer that can still be keyed by IP, and a
  second, per-user bucket is applied **after** authentication so an authenticated
  caller is metered by verified user id and never charged twice for one request.

## Request validation

* `DecodeJSON` checks the content type, applies `MaxBytesReader`, and uses
  `DisallowUnknownFields`. An unknown field is a `400`, not something silently
  ignored — mass assignment is a rejected request, not a hope.
* `httpx.RequireQuery` rejects missing or blank required query values.
* Handlers validate ranges, formats and lengths. Pattern checks exist in both
  layers where they must (e.g. slug format is a database `CHECK` and a handler
  check, because a future direct write should fail too).
* There is no "trusted internal" parse path: the gateway forwards the request as
  received.

## Identity

* `BearerToken` reads only the `Authorization` header. A token in a cookie, a
  query string or a body is not read at all, which removes a class of leaks
  (referrer headers, logs, shared URLs).
* `authn.Verifier` requires `exp` and `iat`, validates audience and issuer with
  30s leeway, accepts only ES256/RS256 (JWKS) and optionally HS256 with a ≥32-char
  secret, rejects `alg: none`, unknown `kid`, symmetric keys in a JWKS document,
  EC keys that are not on the curve, subjects that do not look like a Supabase
  user id, and tokens larger than 8 KiB.
* A `service_role` token is refused on every user-facing route even with a valid
  signature.
* With no auth material configured, a request that presents a token to a
  protected route gets `503` and a log line: fail closed, loudly.

## Rate limiting

Token bucket, in-process, per instance. Two buckets: `ip:<addr>` for anonymous
traffic and `user:<uuid>` for authenticated traffic. Defaults: 600 requests per
minute with a burst of 60, configurable with `RATE_LIMIT_REQUESTS_PER_MINUTE` and
`RATE_LIMIT_BURST`, and `RATE_LIMIT_ENABLED=0` is rejected in production.
`X-Forwarded-For` is a bucketing hint only, never an authorization input. Health
probes are exempt so a throttled client cannot make an orchestrator restart a
healthy task.

The interface is deliberately small so the buckets can move to Redis when the API
runs as more than one instance — see
[decisions/0004](../decisions/0004-rate-limiting.md).

## CORS

An exact allowlist. In production an empty list is a startup error, and `*` is a
startup error as well, so a misconfiguration cannot silently open the API. Because
authentication is a bearer token with `credentials: "omit"`, a browser cannot
attach authority to a cross-site request even if CORS is wrong — but CORS is still
configured correctly rather than relied on to fail.

## Gateway specifics

* Only prefixes in `services/internal/apiroutes/routes.go` with a configured
  `UPSTREAM_*_URL` are forwarded. Anything else under `/api/` is `503`; nothing is
  resolved dynamically.
* An upstream URL must be `http`/`https`, must have a host, and must not carry a
  query or a fragment. A `file://` or malformed value is dropped with a log line.
* Hop-by-hop headers are removed, `Host` is set to the upstream, and
  `X-Forwarded-For`/`Proto`/`Host` are set by the proxy from the real connection.
* The upstream's own error becomes `503` with the standard envelope; the internal
  error is logged, never returned.

## What a service inherits

A new service gets all of the above by existing: `servicekit.MustRun` loads
validated configuration, builds the logger, verifies tokens, installs the chain,
registers `/healthz` and `/readyz`, and shuts down gracefully on `SIGINT`/`SIGTERM`
(drain readiness first, then close the listener with a 20s deadline). A service
cannot opt out of the security headers, the body limit or the request id.
