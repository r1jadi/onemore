# services/admin

The operations API behind the admin dashboard. It is the only service whose
routes are all staff-gated, and authorization is decided by the server-side
**`ADMIN_EMAILS` allowlist alone** — never by a token claim or a database row.

## The rule this service exists to enforce

**Verified email in `ADMIN_EMAILS` = admin; otherwise = not admin.**

The email is taken from the verified Supabase access token on every request and
compared case-insensitively against the allowlist read from the process
environment. Token role claims (`app_metadata.role`) and database rows
(`public.user_roles`) never grant access, so a stale claim, a leftover row, a
request body, a query string, a header, or frontend state cannot make anyone an
admin. Every staff route therefore does two allowlist checks:

1. the router's tier middleware (`ModeratorFunc` / `AdminFunc`) verifies the token
   and refuses a non-allowlisted email — a `401` or `403` before a handler
   exists;
2. `service.staff` re-checks the same allowlist and refuses anything it does
   not contain, without consulting the database for the decision.

Nothing in this service reads a role, a user id, an email or an admin flag from
a request body, query string or header. Removing an email takes effect on the
caller's next request rather than when a token expires, with no database
cleanup and no manual role change.

## No secrets in this service

The admin deployment holds **no service-role key**. Every database call carries the
caller's own access token, so the Data API answers as that user and each staff
function re-checks `public.is_staff()` / `public.is_admin()` itself. A bug in a
handler therefore cannot read a table no policy allows, and a compromised admin
deployment cannot bypass RLS — it can only do what the person whose token it holds
could do.

## Routes

All paths are the public ones, `/api/v1/admin/...`, served through the gateway.
The tier column is the router's allowlist gate; every staff route also passes
the service's per-request allowlist re-check above.

| Route                         | Method | Tier          | What it answers                                                                                                                                                                                                            |
| ----------------------------- | ------ | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/admin/session`              | GET    | authenticated | The caller's own admin state (allowlist-derived) and profile. The one route an ordinary user may call: being able to learn "you are not an admin" is not privileged information, and without it the only answer would be an uninterpretable `403`. |
| `/admin/overview`             | GET    | allowlist     | Dashboard aggregate: counts, a 14-day series, recent activity, most-played games.                                                                                                                                          |
| `/admin/analytics`            | GET    | allowlist     | Activity over 7–90 days: totals, daily series, top games, top players.                                                                                                                                                     |
| `/admin/games`                | GET    | allowlist     | Every game, published or not, with status, owner, real runs, players, best score.                                                                                                                                          |
| `/admin/games/{gameID}`       | PATCH  | allowlist     | Publish, reject, archive or return a game to review, with a reason; writes the audit row in the same transaction.                                                                                                          |
| `/admin/categories`           | GET    | allowlist     | Categories with published and total game counts. Read-only: the schema has no admin write path for categories.                                                                                                             |
| `/admin/reports`              | GET    | allowlist     | The moderation queue, each report joined to its target's title, username or excerpt.                                                                                                                                       |
| `/admin/reports/{reportID}`   | PATCH  | allowlist     | Start reviewing, resolve, dismiss or reopen a report, with a reason.                                                                                                                                                       |
| `/admin/comments`             | GET    | allowlist     | Comments including hidden ones, filtered by state and text.                                                                                                                                                                |
| `/admin/comments/{commentID}` | PATCH  | allowlist     | Hide or restore a comment, with a reason.                                                                                                                                                                                  |
| `/admin/users`                | GET    | allowlist     | The account directory: profile, email, role, suspension state, real activity counts.                                                                                                                                       |
| `/admin/users/{userID}`       | PATCH  | allowlist     | Suspend or restore an account, with a reason.                                                                                                                                                                              |
| `/admin/leaderboards`         | GET    | allowlist     | Verified scores, with the game and the run behind each one.                                                                                                                                                                |
| `/admin/moderation-log`       | GET    | allowlist     | The audit trail: every decision, its target, its reason and the moderator who made it.                                                                                                                                     |
| `/admin/system/services`      | GET    | allowlist     | The platform's routing table. It answers which services exist — **not** whether they are healthy, because this deployment collects no metrics.                                                                             |

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
- **Fail-closed.** Missing or empty grants no one — including database admins
  and admin claims.
- **Immediate.** Read on every request, so removing an address revokes on the
  next call — not when a token expires and not from any client-cached role.
  (On Vercel an env change redeploys; the fresh process reads the new value.)
  No database cleanup or manual role change is required.

### How it relates to database roles and RLS

| Caller                                               | Go tier (`AdminFunc`/`ModeratorFunc`) | Go `staff` wrapper | `GET /admin/session` |
| ---------------------------------------------------- | ------------------------------------- | ------------------ | -------------------- |
| Verified email in `ADMIN_EMAILS`                     | pass                                  | pass               | admin, staff, admin  |
| Anyone else (any claim, any row, any body/query)     | 403                                   | 403, database never reached for staff work | user, not staff, not admin |

Consequences worth stating plainly:

- The allowlist is the **only** grant. Claims and rows are never consulted
  for the decision — a leftover `app_metadata.role` or `user_roles` row grants
  nothing at the application layer, and removal needs no row demotion.
- It does **not** weaken RLS: no migration was changed, no grant was added,
  and no service holds the service-role/secret key. The `user_roles` table,
  its RLS policies and the row-gated staff functions stay exactly as they are
  (defense-in-depth on the data path, and staff visibility for non-admin data
  surfaces is unchanged).
- Residual path, stated honestly: the row-gated SQL functions still answer
  from the row when called directly (e.g. `POST /rest/v1/rpc/admin_overview`
  with a caller token). The application never calls them directly — every
  admin screen goes through this service, which denies first — and no new
  rows are granted by this repository. A follow-up that needs explicit
  approval (a privileged allowlist sync writer, or a service-role reader)
  could close the direct path entirely; it is deliberately not done here.
- `GET /admin/session` reports the allowlist decision, never the allowlist
  itself. The dashboard, the nav link and the suspend button all follow that
  response, so no cached session or edited frontend state can keep the
  privilege.

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

Sharing a process shares no privilege: these routes verify a token and check the
allowlist on every request, exactly as they would in a deployment of their own,
and hold no credential the catalogue routes do not also hold.

## Tests

```bash
cd services && go test ./admin/...
```

`admin_test.go` boots the real router through `httpx.NewRouter` and asserts the
single-source boundary for every route — anonymous `401`, non-allowlisted `403`
(including database/claim admins and moderators), allowlisted `200` with no
claim or row required — plus body validation (unknown fields rejected, a
malformed id, a missing `hidden`/`suspended`), pagination bounds, revocation on
the next request after removal, and that a database refusal is never reported
as success.
`internal/supabaseadmin/client_test.go` covers the Data API client: the projection
it asks for, the token it carries, and the mapping of a Postgres error back onto
the platform's error envelope.

The database half lives in
[tests/security/rls_test.sql](../../tests/security/rls_test.sql): that an ordinary
caller cannot read a staff function's output, that a moderator cannot suspend an
account, and that a role cannot be granted through the Data API.
