# API architecture

## Versioning

Everything is versioned in the path: `/api/v1/...`. There is no version
negotiation in a header, and no unversioned endpoint except the probes
(`/healthz`, `/readyz`), which orchestrators must find without knowing the API
version.

`GET /api/v1` returns the version and build identifiers, so a client can confirm
what it is talking to:

```json
{ "apiVersion": "v1", "version": "0.1.0", "commit": "9f2c1ab" }
```

When a breaking change is unavoidable, `v2` is added alongside `v1` and the old
version is deprecated with a dated removal note in this file. Additive changes
(new optional fields, new endpoints) do not require a version bump.

## Authorization tiers

Every route declares exactly one tier. `authn.Middleware` derives identity from
the token and the router applies the tier middleware.

| Tier | Router method | Requirement | Answer when unsatisfied |
| --- | --- | --- | --- |
| public | `Public` / `PublicFunc` | none | — |
| optional | `OptionalAuth` | no token needed; a valid token personalises the response | anonymous view |
| authenticated | `Authenticated` | verified Supabase access token | `401` |
| moderator | `Moderator` | token whose `app_metadata.role` is `moderator` or `admin` | `403` |
| admin | `Admin` | token whose `app_metadata.role` is `admin` | `403` |

Rules that hold everywhere:

* the user id comes from the token — a body or query field naming a user is
  either ignored or rejected, never trusted;
* an unauthenticated request to a protected route is `401`, not `404`;
* a `service_role` token is rejected on every user-facing route, even when its
  signature is valid;
* when a service has no auth material configured, protected routes answer `503`
  (fail closed) rather than allowing anonymous access.

## Gateway routing

`services/internal/apiroutes/routes.go` is the single source of truth:

| Prefix | Service | Notes |
| --- | --- | --- |
| `/api/v1/auth` | auth | sessions on top of Supabase Auth |
| `/api/v1/users` | users | profiles |
| `/api/v1/games` | games | catalogue |
| `/api/v1/sessions` | game-sessions | play sessions; the only door to a score |
| `/api/v1/scores` | scores | read-only to clients |
| `/api/v1/leaderboards` | leaderboards | projections over scores |
| `/api/v1/feed` | feed | personalised feed |
| `/api/v1/recommendations` | recommendations | suggestions |
| `/api/v1/comments`, `/follows`, `/likes` | social | comments, follows, likes |
| `/api/v1/notifications` | notifications | in-app and push |
| `/api/v1/search` | search | games, creators, players |
| `/api/v1/moderation` | moderation | reports and actions |
| `/api/v1/analytics` | analytics | product analytics |
| `/api/v1/admin` | admin | operations API |

The gateway proxies a group only when its `UPSTREAM_<SERVICE>_URL` is configured.
An unconfigured group answers `503` with the standard envelope; it is never
resolved dynamically, so the gateway cannot be used as an open proxy. Both
directions of that mapping are checked in CI by
`scripts/check-api-contract.mjs`.

## Error envelope

```json
{
  "error": {
    "code": "forbidden",
    "message": "This area requires an administrator account.",
    "requestId": "9f2c1ab3d4e5",
    "details": [{ "field": "role", "rule": "admin" }]
  }
}
```

* `code` is a stable, machine-readable string, mapped to a status by
  `apierr.Status`.
* `message` is safe to display. It never contains an internal error, a stack
  trace, a SQL fragment or a token.
* An unexpected error becomes `500 internal` with a generic message; the real
  error is logged with the same `requestId`.
* `requestId` is echoed in the `X-Request-ID` header and appears in logs.

## Conventions

* `POST` creates, `PATCH` updates a subset, `PUT` replaces, `DELETE` removes;
  `204` means success with no body.
* Request bodies are strict JSON: unknown fields are rejected
  (`DisallowUnknownFields`), and the configured limit is 1 MiB.
* Lists are cursor paginated (`limit`, `cursor`). `limit` is capped (100) and
  defaults to 20; a response never streams an unbounded result set.
* Ids are database-generated UUIDs. A client never sends a primary key it expects
  to be honoured.
* Timestamps are RFC 3339 UTC.

## The contract

`packages/api-contracts/openapi-v1.yaml` is the published contract. Operations
carry `x-status: planned | available`; `planned` means the route exists, is
authorized and is rate limited, and answers `501` until the feature task lands.

CI verifies the contract twice: `redocly lint` for structural validity, and the
drift check that every routed group appears in it (and that nothing documented is
unroutable).

## Adding an endpoint

1. Add the handler to the owning service in `services/<service>/cmd/<service>/main.go`,
   registering it on the correct tier.
2. Document it in `packages/api-contracts/openapi-v1.yaml` with `x-status`.
3. Return `httpx.WriteError(w, r, err)` for failures and `httpx.WriteJSON` for
   success; typed errors keep their code, everything else becomes `500`.
4. Reject input you do not need (`DecodeJSON`), validate ranges and formats, and
   derive ownership from the token.
5. Run `go test ./...` in `services`, `node scripts/check-api-contract.mjs`, and
   add at least one test asserting the denied case at the tier boundary.
