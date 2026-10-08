# Deploying to Vercel

One Vercel project serves the whole product on one domain: the TanStack Start web
app and the Go API gateway. There is no second host and no `api.` subdomain.

| | |
| --- | --- |
| Project | `onemorestartup` → `https://onemorestartup.vercel.app` |
| Configuration | [`vercel.json`](../../vercel.json) (services + rewrites) |
| Web service | the repository root, framework `tanstack-start-lovable` (TanStack Start + Vite, SSR through Nitro) |
| API service | `services/`, framework `go`, entrypoint `services/cmd/api/main.go` |
| Local API | `http://localhost:8080/api/v1` (`go run ./gateway/cmd/gateway`, `HTTP_ADDR=:8080`) |
| Production API | `https://onemorestartup.vercel.app/api/v1` |
| Health | `https://onemorestartup.vercel.app/api/v1/health` |

## Why Vercel Services

Vercel builds one project as **services** when the project's framework preset is
*Services* **and** `vercel.json` contains a `services` key. Both the web app and
the Go gateway are services of the same deployment: they share one domain, one
firewall, one set of environment variables and one public routing table.

The alternatives were rejected on purpose:

* **A second Vercel project** (or Fly/Render/Railway) for the API would create a
  second public surface, a second CORS problem and a second thing to keep in
  sync with this repository.
* **`api/*.go` serverless functions** are Vercel's other Go path. They expect a
  `go.mod` at the project root and one `http.HandlerFunc` per file, which would
  mean a shim around the router instead of the gateway that already exists — and
  they are not part of what a Nitro build emits.
* **A container image service** works, but it packages an operating system to run
  one Go binary. The Go framework preset builds the binary and runs it.

### Why the web service pins a framework

A service has no dashboard preset of its own, and Vercel refuses to guess: the
first deployment with only `"root": "./"` failed with

> Multiple frameworks detected in project root: TanStack Start, Nitro, Node.
> Specify "framework" explicitly in services.

`tanstack-start-lovable` is the entry Vercel defines for a repository that has
both `@lovable.dev/vite-tanstack-config` and `@tanstack/react-start` — exactly
this one. It **supersedes** the generic `tanstack-start` and `vite` detectors,
and its build settings are `vite build` with output `dist`, identical to the
generic entry, so `"framework": "tanstack-start"` is the drop-in fallback if the
Lovable slug is ever removed. Both slugs are real values in Vercel's published
schema.

The project-wide framework preset must still be **Services**; the per-service
`framework` only replaces the ambiguous auto-detection inside the service.

## Routing

`vercel.json` routes public traffic with service rewrites. Vercel evaluates them in
order, and routing into a service is final: a request routed to the API service
never falls back to the web app, whatever path it is.

| Request | Service | Notes |
| --- | --- | --- |
| `/api/v1/health` | `api` | Liveness of the gateway; no auth, no dependency checks |
| `/api/v1` | `api` | Version discovery |
| `/api/v1/<group>/…` | `api` | The gateway proxies a group only when its `UPSTREAM_<SERVICE>_URL` is set; otherwise `503` |
| `/healthz`, `/readyz` | `api` | The Go probes, so they stay usable in production |
| everything else | `web` | `/`, `/explore`, `/games/…`, `/categories/…`, `/profile/…`, `/settings`, assets, sitemap |

A service receives the **original** request path (`/api/v1/health`, not
`/health`), which is why the gateway's routes are mounted under `/api/v1` and
nothing has to be rewritten in Go.

## The gateway on Vercel's Go runtime

Vercel does not give the gateway a container with a fixed listener. Its Go
framework preset cross-compiles one package (`cmd/api`, pinned in `vercel.json`)
for `linux/amd64` with `CGO_ENABLED=0`, then runs the binary as the service and
proxies requests to it, injecting the port to bind as `PORT`. Two consequences:

* `services/cmd/api/main.go` exists as the deployment entrypoint. It is three
  lines of `servicekit.MustRun(gateway.Options())` — the same wiring
  `services/gateway/cmd/gateway` runs locally, so the two cannot drift.
* `config.Load` reads `HTTP_ADDR`, then `PORT_HTTP`, then `PORT`. `PORT` is a bare
  port (`3000`), which is normalised to `:3000`; `HTTP_ADDR` remains the explicit
  override for local work and containers.

The Go builder searches upwards for a module, so the `go.work` workspace at the
repository root and `services/go.mod`'s `replace` of the platform module both work
as they do locally.

## Health, liveness and readiness

Three routes, two purposes, and none of them needs Supabase:

| Route | Purpose | Answers |
| --- | --- | --- |
| `GET /api/v1/health` | The published liveness probe, for deployments and uptime checks | `200 {"status":"ok","version":"…"}`; `503 {"status":"draining"}` while shutting down |
| `GET /healthz` | The same liveness signal for orchestrators, unversioned, plain text | `200 ok` |
| `GET /readyz` | **Readiness**: runs the registered dependency checks | `200 {"status":"ready","checks":…}` or `503 {"status":"not_ready",…}` |

`/api/v1/health` verifies no token, opens no database connection and calls no
upstream, so it stays `200` while every backend service is still unimplemented —
and it is exempt from the rate limiter. Readiness is deliberately separate: a
dependency that is down must not make a healthy process look dead, because that
is how a restart loop starts.

## Environment variables

Set these in **Vercel → Project → Settings → Environment Variables**. Vercel
scopes variables per environment; the values below are for **Production**.

### Public — compiled into the browser bundle (`VITE_` prefix)

| Name | Production value |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | the publishable key (`sb_publishable_…`) |
| `VITE_PUBLIC_SITE_URL` | `https://onemorestartup.vercel.app` |
| `VITE_API_BASE_URL` | `https://onemorestartup.vercel.app/api/v1` |

`VITE_API_BASE_URL` is the gateway's origin. It is the same origin as the app, so
the browser calls it without CORS preflights; the absolute value is used so the
built bundle is explicit about where the API lives rather than depending on the
origin it happens to be served from. For local work the same variable is
`http://localhost:8080/api/v1`. Nothing hardcodes either value: `src/lib/config.ts`
reads the variable and falls back to same-origin `/api/v1`.

### Server-only — never a `VITE_` name

| Name | Production value | Why |
| --- | --- | --- |
| `ENVIRONMENT` | `production` | Selects `config.Validate`'s hardening rules |
| `SUPABASE_URL` | same URL as `VITE_SUPABASE_URL` | The service derives `<SUPABASE_URL>/auth/v1/.well-known/jwks.json` |
| `SUPABASE_PUBLISHABLE_KEY` | same value as `VITE_SUPABASE_PUBLISHABLE_KEY` | Needed **only** by the auth service, which calls the Supabase Auth API. The value is already public, so this is not a secret — it is set twice because the browser and the service read different names |
| `CORS_ALLOWED_ORIGINS` | `https://onemorestartup.vercel.app` | Required in production; `*` is rejected |
| `RATE_LIMIT_ENABLED` | `1` | Cannot be disabled in production |
| `LOG_LEVEL`, `LOG_FORMAT` | `info`, `json` (defaults) | Optional; structured logs are what Vercel captures |
| `SERVICE_NAME` | `gateway` | Optional; appears in log lines |

Deliberately **not** set:

* `SUPABASE_JWT_SECRET` — the deployment verifies tokens against the project's
  JWKS, so no shared HS256 secret exists to leak or rotate. Setting only
  `SUPABASE_URL` is enough; removing the secret is a security improvement, not a
  missing value.
* `SUPABASE_SECRET_KEY` — nothing in the gateway reads it. The API runs with no
  database credentials at all.
* `HTTP_ADDR` — Vercel injects `PORT`; setting `HTTP_ADDR` would override it.
* `SUPABASE_JWKS_URL`, `SUPABASE_JWT_ISSUER` — derived from `SUPABASE_URL`.
* `UPSTREAM_*_URL` — the gateway answers `503` for a group whose upstream is
  unset, which is the intended state until the individual services are deployed.
  `UPSTREAM_AUTH_URL` is the first one that will be needed (see below); no value
  is committed here, because a deployment address is environment-specific.

Vercel environment variables are project-scoped, so the API service can read the
`VITE_` values too — that is harmless in that direction. The rule that matters is
the other one: **only `VITE_`-prefixed names ever reach the browser bundle**, so a
secret never gets that prefix. See
[security/env-and-secrets.md](../security/env-and-secrets.md).

### Preview deployments

Preview deployments share the project's variables. Set the public values for
*Preview* as well (preview URLs are `onemorestartup-<hash>.vercel.app`), and add
those origins to `CORS_ALLOWED_ORIGINS` if the preview is meant to call the API
cross-origin. Leave `ENVIRONMENT=production` scoped to Production so a preview
cannot be mistaken for it; unscoped, a service defaults to `development`, which
relaxes the CORS and auth-material checks instead of loosening production.

## Deploying the auth service

The Auth API (`/api/v1/auth/*`) is implemented and answers real requests, but it
reaches users only when two things exist that this repository cannot create:

1. **A host for `services/auth`.** The service builds as a standalone binary
   (`go build ./auth/cmd/auth`) and serves `/api/v1/auth/*` on its own port. How it
   is hosted is a deployment decision that has not been made here — the current
   `vercel.json` deploys two services (`web`, the Go gateway `api`), and adding a
   third is a topology change.
2. **`UPSTREAM_AUTH_URL` on the API service.** The gateway proxies a group only
   when its upstream is set, so this variable must be set to the address where the
   auth service actually listens. The value is environment-specific; it is
   deliberately absent from this repository (no placeholder, no guess). Until it
   is set, `/api/v1/auth/*` answers `503` with the standard envelope — routed, not
   a `404` — and the web app shows the failure message rather than a fake session.

`SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_URL` must be visible to whichever
process runs the auth service. They are not secrets (the publishable key is
already in the browser bundle), but `SUPABASE_SECRET_KEY` must **not** be given to
it: the service authorizes with the caller's own token, so Row Level Security
remains the boundary.

Once both are in place, verification is three requests:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -X POST \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"a-long-password"}' \
  https://onemorestartup.vercel.app/api/v1/auth/sign-up
# 201 (or 409 if the address already exists) — 503 means UPSTREAM_AUTH_URL is unset
curl -sS -o /dev/null -w '%{http_code}\n' https://onemorestartup.vercel.app/api/v1/auth/session
# 401 — the route exists and demands a token
```

The access token from sign-up or sign-in is what every other endpoint expects in
`Authorization: Bearer …`; tokens are verified against the project's JWKS, so no
`SUPABASE_JWT_SECRET` is involved anywhere in this flow.

## Deploying

1. **Set the framework preset to Services.** Vercel → project → *Settings → Build
   and Deployment → Framework Preset* → **Services**. Without this, Vercel ignores
   the `services` key in `vercel.json` and falls back to its default framework
   detection, so the deployment is not the one this document describes.
2. **Set the environment variables** above (Production scope, plus the public ones
   for Preview).
3. **Deploy a preview first** — push a branch and let Vercel build it — then open
   `https://onemorestartup-<hash>.vercel.app/api/v1/health` and confirm it answers
   `200` with `{"status":"ok",…}` before merging to `main`.
4. **Merge to `main`** and verify production:

   ```bash
   curl -sS https://onemorestartup.vercel.app/api/v1/health
   # {"status":"ok","version":"dev"}
   curl -sS https://onemorestartup.vercel.app/api/v1
   # {"apiVersion":"v1","version":"dev","commit":""}
   curl -sS -o /dev/null -w '%{http_code}\n' https://onemorestartup.vercel.app/api/v1/games
   # 503 while UPSTREAM_GAMES_URL is unset — the gateway routed it, it is not a 404
   curl -sS -o /dev/null -w '%{http_code}\n' https://onemorestartup.vercel.app/
   # 200 — the web app still renders
   ```

### Rolling back

`vercel.json` is committed, so a rollback is a revert. To leave services mode
entirely, set the framework preset back to its previous value and remove the
`services` key; the web app then deploys exactly as it did before this change.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Multiple frameworks detected in project root: TanStack Start, Nitro, Node. Specify "framework" explicitly in services.` | A service has no dashboard preset, and the root matches several detectors | Already fixed: the `web` service pins `"framework": "tanstack-start-lovable"` |
| The `web` service build emits a Cloudflare worker (`.output/nitro.json` with `"preset": "cloudflare-module"`) | `@lovable.dev/vite-tanstack-config` sets that preset as the *default* for local builds; Vercel needs the `vercel` preset | Set `NITRO_PRESET=vercel` in the project's environment variables (Nitro's documented switch; an explicit preset beats the default). Never run that in Lovable's sandbox — the config ignores it there |
| `/api/v1/*` returns the app's HTML 404 | The project is not in services mode, so the rewrites are inert | Set the framework preset to **Services** |
| A group answers `503 This API is not available in this environment yet.` | That group has no `UPSTREAM_<SERVICE>_URL` | Expected until that service is deployed; set the variable then |

## What is verified, and what is not

Verified in the repository (see [development/testing.md](../development/testing.md)):

* `gofmt`, `go vet`, `go build` (every service binary plus `cmd/api`), and
  `go test ./...` in both modules — including the smoke test that boots the real
  gateway wiring and asserts `GET /api/v1/health` is `200`.
* Running the built entrypoint with `PORT` set and the production configuration
  above: it binds the injected port, `GET /api/v1/health` answers
  `200 {"status":"ok","version":"dev"}` (with and without a junk token),
  `/readyz` answers `ready`, and `/api/v1/games` answers `503`.
* `node scripts/check-api-contract.mjs`: the `/health` path is documented in
  `packages/api-contracts/openapi-v1.yaml`.

Verified for the auth service (see [../architecture/api.md](../architecture/api.md)
and [`services/auth/README.md`](../../services/auth/README.md)): `go vet` and
`go test ./...` in both modules, `gofmt -l` clean, all sixteen binaries built
(fifteen services plus `cmd/api`), the endpoints exercised through a test server
table-driven over success, invalid credential, unauthenticated, valid, expired and
forged token, refresh, sign-out and malformed-body cases, and the contract checked
by both `redocly lint` and `scripts/check-api-contract.mjs`.

**Not verified — no Vercel credentials were available to this checkout:**

* The deployment itself. No Vercel CLI, no linked project and no access token,
  so `vercel.json` was never processed by Vercel, the framework preset was never
  changed, and no deployment was created or inspected.
* `https://onemorestartup.vercel.app/api/v1/health` has **not** been requested.
  Until it is, treat the routing above as configured-but-unproven.
* Vercel Services is in Beta. If the platform rejects a `services` configuration
  detail (for example a `root` or `framework` slug), the fix belongs in
  `vercel.json`; nothing in the Go code depends on it.
* If the project has a custom build or install command in the dashboard, Services
  mode invalidates top-level build settings — move them into the `web` service
  object in `vercel.json` (`buildCommand`, `installCommand`, `outputDirectory`).
  The `tanstack-start-lovable` framework already supplies `vite build` and the
  `dist` output directory, which is what this repository's `bun run build` / `npm
  run build` runs.
* **Auth against the live project.** No Supabase credentials or CLI were available
  either, so the hosted project's Auth settings (whether email confirmation is on,
  the password policy) were not inspected and no real sign-up was performed. The
  service handles both sign-up answers — a session, or a user awaiting
  confirmation — and the tests cover each, but the live round trip is unproven.
* **Where the auth service is hosted.** Unset `UPSTREAM_AUTH_URL` means the group is
  `503` in production today. See *Deploying the auth service* above for exactly
  what must be set, and what must not be invented.
