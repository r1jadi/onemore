# Environments and configuration

## The four environments

| Environment | Purpose | Web | API | Database |
| --- | --- | --- | --- | --- |
| **development** | a developer's machine | `npm run dev` on `:8081` | `go run ./gateway/cmd/gateway` on `:8080` | local Supabase (`supabase start`) or the Docker harness |
| **preview** | one per pull request | Vercel preview | not deployed — an unconfigured API answers `503` | staging project (read-only data) |
| **staging** | pre-production verification | Vercel preview of `main` | same image as production, separate config | separate Supabase project |
| **production** | users | `https://onemorestartup.vercel.app` | to be provisioned | hosted Supabase project |

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
| preview / production (web) | Vercel → Project → Settings → Environment Variables, scoped per environment |
| staging / production (API) | the platform's secret store (e.g. Fly/Render/Railway secrets, or a mounted env file) — never a committed file |

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
| `VITE_API_BASE_URL` | The deployed gateway's origin. Empty until an API host exists. |
| `ENVIRONMENT` | Chosen, not found: `development` locally, `staging` or `production` on a host. It selects the hardening rules in `config.Validate`. |
| `SERVICE_NAME` | Chosen: the service being run (`gateway`, `auth`, …), used in logs. |
| `HTTP_ADDR` | Chosen: the port the service listens on. Most hosts inject `PORT`; set `:8080` locally. |
| `LOG_LEVEL`, `LOG_FORMAT` | Chosen: `debug`/`info`/`warn`/`error` and `json`/`text`. |
| `CORS_ALLOWED_ORIGINS` | The exact browser origins the web app is served from — dev server, Vercel production and preview domains. Comma-separated, no wildcard outside development. |
| `RATE_LIMIT_*` | Tuned from observed traffic, not discovered. Defaults suit a single instance; raise them deliberately. |
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
2. **API deployment.** The Go services have no host yet. Until one exists,
   `VITE_API_BASE_URL` should stay empty so the web app calls the same origin and
   fails predictably with `503` rather than pointing at a host that is not there.
3. **Vercel environment variables.** `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_PUBLISHABLE_KEY` must be set in Vercel for auth to work; the app
   reports a clear configuration error until they are. Set them for all
   environments; keep `SUPABASE_SECRET_KEY` scoped to Production only.
4. **Custom domain.** When one is chosen, set `VITE_PUBLIC_SITE_URL`, regenerate
   the sitemap (`npm run sitemap`), update the `Sitemap:` line in `robots.txt`,
   and add the origin to `CORS_ALLOWED_ORIGINS`. Nothing else changes.
