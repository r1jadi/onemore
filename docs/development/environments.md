# Environments and configuration

## The four environments

| Environment | Purpose | Web | API | Database |
| --- | --- | --- | --- | --- |
| **development** | a developer's machine | `npm run dev` on `:8081` | `go run ./gateway/cmd/gateway` on `:8080` | local Supabase (`supabase start`) or the Docker harness |
| **preview** | one per pull request | Vercel preview | Vercel preview (same deployment, `development`-like config) | staging project (read-only data) |
| **staging** | pre-production verification | Vercel preview of `main` | same deployment as production, separate config | separate Supabase project |
| **production** | users | `https://onemorestartup.vercel.app` | `https://onemorestartup.vercel.app/api/v1` (a service of the same Vercel project) | hosted Supabase project |

`ENVIRONMENT` drives the hardening rules: a wildcard CORS origin, an empty CORS
allowlist, missing auth material, a non-HTTPS JWKS URL and a disabled rate limiter
are all rejected at startup outside development (`config.Validate`).

## The public/secret split

Two classes, and a value never moves between them.

### Public — safe in the browser bundle

| Variable | Meaning |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Publishable key (`sb_publishable_…`), the current name for the anon key. RLS is the security boundary, not secrecy. |
| `VITE_PUBLIC_SITE_URL` | Canonical origin for SEO |
| `VITE_API_BASE_URL` | API base, empty means same-origin `/api/v1` |

Supabase is retiring the legacy `anon` and `service_role` keys in favour of
**publishable** (`sb_publishable_…`) and **secret** (`sb_secret_…`) keys — see
[API keys](https://supabase.com/docs/guides/getting-started/api-keys). Both key
systems work side by side during the migration, so nothing breaks if one surface
is updated before another. `VITE_SUPABASE_ANON_KEY` is still read as a fallback by
`src/lib/config.ts`, but a new environment uses the publishable name.

### Server-only — never in a `VITE_` variable

| Variable | Read by | Why it is secret |
| --- | --- | --- |
| `SUPABASE_SECRET_KEY` | web SSR, Go services (reserved — no code reads it yet) | bypasses RLS; the current name for the service role key |
| `SUPABASE_JWT_SECRET` | Go services | forges tokens in legacy HS256 projects |
| `SUPABASE_JWKS_URL`, `SUPABASE_URL`, `SUPABASE_JWT_AUDIENCE`, `SUPABASE_JWT_ISSUER` | Go services | project metadata, not secret, but server-side |
| `SUPABASE_PUBLISHABLE_KEY` | the auth service | the browser is given the same value, so it is not secret — but only the server needs to make Auth API calls |
| `CORS_ALLOWED_ORIGINS`, `RATE_LIMIT_*`, `LOG_*`, `HTTP_ADDR`, `ENVIRONMENT`, `SERVICE_NAME` | Go services | service configuration |
| `UPSTREAM_*_URL` | gateway | internal addresses |
| `RAIACCEPT_*` | payments service (later) | payment credentials |

`Vite` inlines every `VITE_`-prefixed value into the client bundle. If a secret
ever needs a `VITE_` name, the design is wrong — put it behind the API instead.

`.env.example` documents every variable and is the only committed env file.
`.env`, `.env.local` and `.env.*.local` are gitignored. `gitleaks` runs in CI over
the full history, so a secret that was committed and deleted is still treated as
leaked — see [security/env-and-secrets.md](../security/env-and-secrets.md).

## Where values are set

| Environment | Mechanism |
| --- | --- |
| development | `.env.local` (web), shell environment or a `direnv`-style loader (Go) |
| preview / production (web and API) | Vercel → Project → Settings → Environment Variables, scoped per environment. Variables are project-scoped, so the web service and the API service read the same set; only `VITE_*` names reach the browser bundle. The required set and exact values are in [deployment/vercel.md](../deployment/vercel.md). |
| any other API host | the platform's secret store (e.g. a mounted env file or container secrets) — never a committed file |

Vercel scoping matters: a preview deployment must not receive production
secrets. Set public values for all environments and secrets only for Production.

## How to find each value

The dashboard paths below are the ones that exist today; Supabase has moved keys
from *Settings → API* to *Settings → API Keys*, and both the Connect dialog and
the API Keys page show the same values.

### Supabase — the same source for both the web and the API

| Value | Where a human gets it |
| --- | --- |
| `VITE_SUPABASE_URL` / `SUPABASE_URL` | Dashboard → **Project Settings → API Keys → Project URL**, or the project's **Connect** dialog. Self-hosted or local: `supabase status` → *APIs* → Project URL. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Dashboard → **Project Settings → API Keys → Publishable and secret API keys** tab → the publishable key (`sb_publishable_…`). If the tab offers *Create new API keys*, create them; the anon key keeps working meanwhile. Local: `supabase status` → *Authentication Keys* → **Publishable**. |
| `SUPABASE_SECRET_KEY` | Same tab → **secret** key (`sb_secret_…`); create one per backend component so a leak forces a single rotation. Local: `supabase status` → *Authentication Keys* → **Secret**. |
| `SUPABASE_PUBLISHABLE_KEY` | The same publishable key as `VITE_SUPABASE_PUBLISHABLE_KEY` — one value, two names, because the browser reads the `VITE_` copy and the auth service reads this one. |
| `SUPABASE_JWKS_URL` | Leave empty. `config.go` derives `<SUPABASE_URL>/auth/v1/.well-known/jwks.json`, which is public — paste it into a browser to confirm it returns JSON. |
| `SUPABASE_JWT_ISSUER` | Leave empty; derived as `<SUPABASE_URL>/auth/v1`. |
| `SUPABASE_JWT_AUDIENCE` | Fixed: `authenticated`. |
| `SUPABASE_JWT_SECRET` | **Legacy only.** Dashboard → **Project Settings → API Keys → JWT signing keys**; *Migrate JWT secret* imports the old secret into the signing-keys system and creates a rotatable ES256 key. `supabase gen signing-key --algorithm ES256` generates a key you can import instead. |

`supabase status -o env` prints the local values as `KEY=value` lines
(`PUBLISHABLE_KEY`, `SECRET_KEY`, `API_URL`, `DB_URL`); `npm run env:supabase`
([scripts/env-from-supabase.mjs](../../scripts/env-from-supabase.mjs)) maps them
onto the names in this repository.

### Everything else

| Value | Where a human gets it |
| --- | --- |
| `VITE_PUBLIC_SITE_URL` | The origin the app is actually served from: the custom domain, otherwise the Vercel production domain. |
| `VITE_API_BASE_URL` | The deployed gateway's origin: `https://onemorestartup.vercel.app/api/v1` in production, `http://localhost:8080/api/v1` locally. Empty means same-origin `/api/v1`, which is also correct in production now that the gateway is part of the same deployment. |
| `ENVIRONMENT` | Chosen, not found: `development` locally, `production` on Vercel, `staging` on a staging host. It selects the hardening rules in `config.Validate`. |
| `SERVICE_NAME` | Chosen: the service being run (`gateway`, `auth`, …), used in logs. |
| `HTTP_ADDR` | Chosen: the port the service listens on. Set `:8080` locally; on Vercel leave it unset, because the platform injects `PORT` and `config.Load` prefers `HTTP_ADDR`, then `PORT_HTTP`, then `PORT`. |
| `LOG_LEVEL`, `LOG_FORMAT` | Chosen: `debug`/`info`/`warn`/`error` and `json`/`text`. |
| `CORS_ALLOWED_ORIGINS` | The exact browser origins the web app is served from — dev server, Vercel production and preview domains. Comma-separated, no wildcard outside development. |
| `RATE_LIMIT_*` | Tuned from observed traffic, not discovered. Defaults suit a single instance; raise them deliberately. |
| `AUTH_RATE_LIMIT_*` | The credential budget for the auth endpoints, metered per client and per account. Defaults to 10/minute with a burst of 5, deliberately far tighter than `RATE_LIMIT_*` because every attempt can verify a password. |
| `UPSTREAM_*_URL` | The private address of each deployed service. Unset means the gateway answers `503` for that route group, which is the intended state before an API host exists. |
| `RAIACCEPT_*` | The RaiAccept merchant dashboard, once payments start. Not read by any service today. |
| Database password / connection string | Supabase dashboard → **Project Settings → Database → Connection string** (or `supabase status` → *Database* → URL locally). Nothing in this repository stores it: migrations run through the CLI, which keeps its own session. |

## Local API configuration

A minimal `.env.local` for a developer running the API locally:

```dotenv
ENVIRONMENT=development
SERVICE_NAME=gateway
HTTP_ADDR=:8080
LOG_LEVEL=debug
LOG_FORMAT=text
CORS_ALLOWED_ORIGINS=http://localhost:8081
RATE_LIMIT_REQUESTS_PER_MINUTE=6000
RATE_LIMIT_BURST=600
```

In development a service starts without Supabase auth material; protected routes
then answer `503` with a log line explaining what to set, rather than pretending
to authenticate. To exercise real token verification locally, set
`SUPABASE_URL` (the service derives the JWKS URL) or `SUPABASE_JWT_SECRET`.

To exercise the auth endpoints locally, add `SUPABASE_PUBLISHABLE_KEY` (the
auth service calls Supabase Auth with it) and run that service too:

```bash
SERVICE_NAME=auth HTTP_ADDR=:8082 go run ./auth/cmd/auth   # from services/
UPSTREAM_AUTH_URL=http://localhost:8082 SERVICE_NAME=gateway HTTP_ADDR=:8080 go run ./gateway/cmd/gateway
```

The gateway proxies `/api/v1/auth/*` to `UPSTREAM_AUTH_URL`; with the variable
unset it answers `503` for that group, which is the intended state until the
service is deployed. `services/auth/README.md` lists the endpoints and what each
one calls at Supabase.

## Configuration is fail-fast

A service refuses to start on an invalid configuration instead of running with a
weakened default: unknown `LOG_LEVEL`, a body limit outside the supported range,
a CORS origin that is not an absolute http(s) origin, `*` outside development, an
empty CORS allowlist in production, missing auth material in production, a
non-HTTPS JWKS URL in production, and `RATE_LIMIT_ENABLED=0` in production. The
error message names the variable to change.

## Blockers and manual actions

These are outside what a repository change can do — they need a human with
dashboard access:

1. **Supabase project.** No CLI, no credentials and no MCP access were available,
   so the hosted project could not be inspected. The audit of existing tables,
   policies, indexes and buckets is therefore **not done**: the migrations in
   `supabase/migrations` are written for a project without those objects and must
   be reconciled before they are applied to a project that already has data.
   Run `supabase link` and `supabase db pull` to compare.
2. **Vercel services mode.** `vercel.json` declares the two services, but Vercel
   only builds them as services when the project's framework preset is set to
   **Services**, which needs dashboard access. Until then the configuration is
   inert and `/api/v1` is still served by the web app. Steps, exact environment
   variables and the verification commands are in
   [deployment/vercel.md](../deployment/vercel.md).
3. **Vercel environment variables.** `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_PUBLISHABLE_KEY` must be set in Vercel for auth to work; the app
   reports a clear configuration error until they are. Set them for all
   environments; keep `SUPABASE_SECRET_KEY` scoped to Production only. The
   gateway's own variables (`ENVIRONMENT`, `SUPABASE_URL`, `CORS_ALLOWED_ORIGINS`,
   `RATE_LIMIT_ENABLED`) are listed in the same document — it must never be given
   `SUPABASE_JWT_SECRET` or `SUPABASE_SECRET_KEY`.
4. **Custom domain.** When one is chosen, set `VITE_PUBLIC_SITE_URL`, regenerate
   the sitemap (`npm run sitemap`), update the `Sitemap:` line in `robots.txt`,
   and add the origin to `CORS_ALLOWED_ORIGINS`. Nothing else changes.
5. **The auth service needs a host and one upstream variable.** The binary builds
   and its tests pass, but `/api/v1/auth/*` is only reachable once the service is
   deployed and `UPSTREAM_AUTH_URL` points at it. That address is
   environment-specific and is deliberately not committed — set it in the API
   host's environment, and set `SUPABASE_PUBLISHABLE_KEY` next to `SUPABASE_URL`
   so the service can reach Supabase Auth. Until both are set, the group answers
   `503`, and the web app's Log in form reports the failure instead of pretending
   to sign anyone in. No `UPSTREAM_*` value appears anywhere in this repository.
