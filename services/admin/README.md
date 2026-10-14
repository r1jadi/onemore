# services/admin

The operations API behind the admin dashboard. It is the only service whose
routes are all staff-gated, and the only one whose authorization is decided by a
**row** rather than only by a token claim.

## The rule this service exists to enforce

A role claim travels in the access token. The token is signed, so the claim cannot
be edited — but it is _stale_, and it comes from a different system than the one
that decides what an account may do:

| Where the role lives             | Written by           | Read by                                      |
| -------------------------------- | -------------------- | -------------------------------------------- |
| `app_metadata.role` in the token | Supabase's admin API | `authn.Middleware` (the tier check)          |
| `public.user_roles.role`         | this database        | `public.admin_identity()` (the actual check) |

They can disagree, and when they do the **row wins**. Every staff route therefore
does two checks:

1. the router's tier middleware (`ModeratorFunc` / `AdminFunc`) verifies the token
   and refuses one whose claim is too weak — a `401` or `403` before a handler
   exists;
2. `service.staff` calls the database as the caller and asks
   `public.admin_identity()` what role they actually hold, refusing anything the
   row does not support.

Nothing in this service reads a role, a user id or an admin flag from a request
body or a query string, and no handler trusts the token's claim on its own. A role
revoked in the database takes effect on the caller's next request rather than when
their token expires.

## No secrets in this service

The admin deployment holds **no service-role key**. Every database call carries the
caller's own access token, so the Data API answers as that user and each staff
function re-checks `public.is_staff()` / `public.is_admin()` itself. A bug in a
handler therefore cannot read a table no policy allows, and a compromised admin
deployment cannot bypass RLS — it can only do what the person whose token it holds
could do.

## Routes

All paths are the public ones, `/api/v1/admin/...`, served through the gateway.
The tier column is the router's; every route also passes the database check above.

| Route                         | Method | Tier           | What it answers                                                                                                                                                                                                            |
| ----------------------------- | ------ | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/admin/session`              | GET    | authenticated  | The caller's own role and account state. The one route an ordinary user may call: being able to learn "you are not staff" is not privileged information, and without it the only answer would be an uninterpretable `403`. |
| `/admin/overview`             | GET    | moderator + DB | Dashboard aggregate: counts, a 14-day series, recent activity, most-played games.                                                                                                                                          |
| `/admin/analytics`            | GET    | moderator + DB | Activity over 7–90 days: totals, daily series, top games, top players.                                                                                                                                                     |
| `/admin/games`                | GET    | moderator + DB | Every game, published or not, with status, owner, real runs, players, best score.                                                                                                                                          |
| `/admin/games/{gameID}`       | PATCH  | moderator + DB | Publish, reject, archive or return a game to review, with a reason; writes the audit row in the same transaction.                                                                                                          |
| `/admin/categories`           | GET    | moderator + DB | Categories with published and total game counts. Read-only: the schema has no admin write path for categories.                                                                                                             |
| `/admin/reports`              | GET    | moderator + DB | The moderation queue, each report joined to its target's title, username or excerpt.                                                                                                                                       |
| `/admin/reports/{reportID}`   | PATCH  | moderator + DB | Start reviewing, resolve, dismiss or reopen a report, with a reason.                                                                                                                                                       |
| `/admin/comments`             | GET    | moderator + DB | Comments including hidden ones, filtered by state and text.                                                                                                                                                                |
| `/admin/comments/{commentID}` | PATCH  | moderator + DB | Hide or restore a comment, with a reason.                                                                                                                                                                                  |
| `/admin/users`                | GET    | moderator + DB | The account directory: profile, email, role, suspension state, real activity counts.                                                                                                                                       |
| `/admin/users/{userID}`       | PATCH  | **admin** + DB | Suspend or restore an account, with a reason. Registered with `AdminFunc`, and the database checks `is_admin()` again.                                                                                                     |
| `/admin/leaderboards`         | GET    | moderator + DB | Verified scores, with the game and the run behind each one.                                                                                                                                                                |
| `/admin/moderation-log`       | GET    | moderator + DB | The audit trail: every decision, its target, its reason and the moderator who made it.                                                                                                                                     |
| `/admin/system/services`      | GET    | moderator + DB | The platform's routing table. It answers which services exist — **not** whether they are healthy, because this deployment collects no metrics.                                                                             |

Lists are paged with `limit` (default 50, max 100) and `offset`, and answer
`{ "items": [...], "hasMore": bool }`. The extra row read is how `hasMore` is
known without a `COUNT`. Filters are validated before the database: an unknown
status, role or state is a `400` naming the field.

## Where the numbers come from

Every figure is a count of persisted rows, computed in one `security definer`
function per screen (`public.admin_overview()`, `admin_analytics()`,
`admin_game_directory()`, …) so that a screen is one round trip and one query plan
rather than an N+1 join written in Go.

A value that cannot be computed is `null`, never zero: `avgRunSeconds` is null
until a run has been completed, and the dashboard renders "not measured yet"
rather than `0s`. There is no comparison against a previous period and no
projection, because the database does not compute either — an invented `+3.1%` is
indistinguishable from a measured one.

## What is deliberately absent

- **No fixture data.** There is no fallback in this service or in the dashboard:
  a failed read is reported as a failure, and a screen with no backend says so.
- **No role writing.** Granting or revoking a role is not an endpoint. It is an
  operator action against `public.user_roles`, and the procedure — including why
  it is not a dashboard button — is in
  [ADR 0013](../../docs/decisions/0013-admin-authorization.md).
- **No health metrics.** `/admin/system/services` reports the routing table with
  `measured: false`. An uptime number invented here would look exactly like a real
  one.
- **No notifications or featured-slot management.** Neither has a data model;
  the dashboard says so instead of showing an editor that would persist nothing.
- **No service-role key, and no Supabase secret of any kind.** See above.

## Configuration

| Variable                                                    | Purpose                                                                     |
| ----------------------------------------------------------- | --------------------------------------------------------------------------- |
| `SUPABASE_URL`                                              | project URL, for the Data API calls                                         |
| `SUPABASE_PUBLISHABLE_KEY`                                  | the same publishable key the browser holds — the token does the authorizing |
| `SUPABASE_JWT_SECRET` / `SUPABASE_JWKS_URL`                 | token verification (derived from `SUPABASE_URL` when unset)                 |
| `ADMIN_EMAILS`                                              | administrator allowlist (server-only): comma-separated verified emails      |
| `ENVIRONMENT`, `CORS_ALLOWED_ORIGINS`, `RATE_LIMIT_ENABLED` | the platform's shared middleware                                            |

## The ADMIN_EMAILS allowlist

`ADMIN_EMAILS` (exact name, never a `VITE_` variable) grants administrator
access to the accounts it names, managed in Vercel rather than in SQL:

```dotenv
ADMIN_EMAILS=admin@example.com,another@example.com
```

Rules:

- **Server-only.** Read per request from the process environment by the Go
  API (`packages/go/platform/adminallowlist`). Never inlined into the browser
  bundle, never sent to the client — `GET /admin/session` reports the
  elevated role, never the allowlist itself.
- **Verified email only.** Compared case-insensitively (whitespace ignored)
  against `identity.Identity.Email`, which `authn.Verifier` sets from the
  JWT's `email` claim after signature, audience, issuer and expiry checks. A
  client-supplied email, user id, role or `isAdmin` flag — in a body, query
  string or header — is never trusted (identity headers are stripped, strict
  bodies reject unknown fields).
- **Fail-closed.** Missing or empty grants no one. Database roles keep
  working.
- **Immediate.** Read on every request, so removing an address revokes its
  Go API access on the next call — not when a token expires and not from any
  client-cached role. (On Vercel an env change redeploys; the fresh process
  reads the new value.)

### How it interacts with database roles and RLS

| Caller                                              | Go tier (`AdminFunc`/`ModeratorFunc`) | Go `staff` wrapper | Database functions / RLS |
| --------------------------------------------------- | ------------------------------------- | ------------------ | ------------------------ |
| Verified email in `ADMIN_EMAILS`                    | pass (allowlist OR claim)             | pass (elevated to admin for this request) | staff reads/writes still call the caller's-token RPCs, which re-check `is_staff()`/`is_admin()` from `user_roles` |
| `user_roles` row `admin`/`moderator`, not allowlisted | pass iff the token claim is strong enough | pass iff the row is staff | pass per the row (unchanged) |
| Ordinary user, not allowlisted                      | 403 (moderator routes), 403/401 as documented | 403, database never reached | refused (`42501`) on any direct RPC too |

Consequences worth stating plainly:

- The allowlist is an **additional Go-layer grant**, OR'd with the existing
  row+claim checks. It removes the need to set the `app_metadata.role` claim
  for allowlisted accounts, and revoking at the Go layer is immediate.
- It does **not** replace the row for data access and does **not** weaken
  RLS: no migration was changed, no grant was added, and no service holds the
  service-role/secret key. A direct browser call to
  `POST /rest/v1/rpc/admin_overview` with a caller token is still answered
  from the row alone — an allowlisted address without a staff row cannot read
  staff data that way, and removing an address from the allowlist does not by
  itself demote its row. Full revocation of a row-backed account is env
  removal **plus** the existing row demotion (`update user_roles set role =
  'user' …`); for allowlist-only accounts env removal alone suffices at the
  Go API.
- For allowlisted accounts to read staff aggregates through the Go API today,
  grant the row once with the existing procedure
  ([ADR 0013](../../docs/decisions/0013-admin-authorization.md#granting-and-revoking-a-role))
  and then manage day-to-day membership in Vercel. A future change could sync
  the allowlist into rows with a privileged writer; that writer does not exist
  today by design.

Missing Data API configuration is not fatal: the service still serves its probes
and answers `503` on the admin routes, which is diagnosable, where a crash loop is
not.

## Running it locally

```bash
cd services
go run ./admin/cmd/admin          # the admin service alone, on the platform port
```

It is normally reached through the gateway, which is how the browser calls it:

```bash
curl -sS -H "Authorization: Bearer $ACCESS_TOKEN" \
  http://localhost:8080/api/v1/admin/session
```

`GET` without a token answers `401`; with a token whose row is not staff, `403`
with `This area requires a moderator account.`

## Deployment

The routes are served by the **games deployment**, which mounts this package
beside the catalogue and the play sessions: Vercel's Go preset gives a service root
three entrypoint names and all three are taken, and a second container service at
the same root is not detected (see
[docs/deployment/vercel.md](../../docs/deployment/vercel.md)). The routing table
lists `/api/v1/admin` under the service that answers it, so the gateway's
`UPSTREAM_GAMES_URL` binding covers it with no extra configuration.

Sharing a process shares no privilege: these routes verify a token and ask the
database for a role on every request, exactly as they would in a deployment of
their own, and hold no credential the catalogue routes do not also hold.

## Tests

```bash
cd services && go test ./admin/...
```

`admin_test.go` boots the real router through `httpx.NewRouter` and asserts the
tier boundary for every route — anonymous `401`, ordinary user `403`, moderator
allowed, suspension `403` for a non-admin — plus body validation (unknown fields
rejected, a malformed id, a missing `hidden`/`suspended`), pagination bounds, and
that a database refusal is never reported as success.
`internal/supabaseadmin/client_test.go` covers the Data API client: the projection
it asks for, the token it carries, and the mapping of a Postgres error back onto
the platform's error envelope.

The database half lives in
[tests/security/rls_test.sql](../../tests/security/rls_test.sql): that an ordinary
caller cannot read a staff function's output, that a moderator cannot suspend an
account, and that a role cannot be granted through the Data API.
