# services/auth

The credential lifecycle for the web app, on top of Supabase Auth.

Supabase is the identity provider: it stores credentials, enforces the password
policy, sends confirmation and recovery email, and issues access and refresh
tokens. This service never stores a password and never holds a Supabase secret
key. What it owns is the *application session* — sign up, sign in, refresh, sign
out, and "who is this and what may they see" — so the browser talks to one origin
and no Supabase key of any kind has to be embedded in a page.

Access tokens are verified with the same JWKS-based verifier every other service
uses ([`packages/go/platform/authn`](../../packages/go/platform/authn)), so there
is exactly one authentication implementation in the platform. `SUPABASE_JWT_SECRET`
is not used anywhere in this flow.

## Endpoints

All paths are relative to the gateway's `/api/v1` base. The contract in
[`packages/api-contracts/openapi-v1.yaml`](../../packages/api-contracts/openapi-v1.yaml)
is authoritative and marks every one of these `x-status: available`.

| Method | Path | Tier | Success | Calls Supabase |
| --- | --- | --- | --- | --- |
| `POST` | `/auth/sign-up` | public | `201` | `POST /auth/v1/signup` |
| `POST` | `/auth/sign-in` | public | `200` | `POST /auth/v1/token?grant_type=password` |
| `POST` | `/auth/refresh` | public | `200` | `POST /auth/v1/token?grant_type=refresh_token` |
| `POST` | `/auth/session` | public (verifies the token in the body) | `200` | `GET /rest/v1/profiles` (onboarding state) |
| `GET` | `/auth/session` | authenticated | `200` | `GET /rest/v1/profiles` (onboarding state) |
| `POST` | `/auth/sign-out` | authenticated | `204` | `POST /auth/v1/logout` |

The three credential endpoints answer with `{ session, tokens?, user? }`. `tokens`
is absent while Supabase still requires email confirmation — that is a success,
not a failure, and the client must not treat it as signed in. The session reads
answer with `{ userId, role, email?, onboarded?, expiresAt? }` and never with a
token.

## How it talks to Supabase

* **Auth API** — `https://<project>.supabase.co/auth/v1/…`, with the publishable
  key in `apikey`. No `Authorization` header: it is the credential being
  verified, not a caller's token.
* **Data API** — `GET /rest/v1/profiles?select=onboarded_at&id=eq.<uuid>&limit=1`
  with the publishable key in `apikey` **and the caller's own access token** in
  `Authorization`. Row Level Security decides what is visible, so the service
  needs no `service_role`/secret key and cannot read another user's profile.
  `onboarded_at` is readable by the `authenticated` role for exactly this reason.
* Every upstream failure is mapped to a platform error code
  (`unauthorized`, `forbidden`, `conflict`, `unprocessable_entity`,
  `rate_limited`, `service_unavailable`). Supabase's own message is never
  forwarded — it can describe the project's configuration — and the response body
  is never logged or echoed, so a password, an access token or a refresh token
  cannot reach a log line or a client.

## Configuration

| Variable | Required | Purpose |
| --- | --- | --- |
| `SUPABASE_URL` | yes | Project URL. The JWKS URL (`<URL>/auth/v1/.well-known/jwks.json`) and issuer (`<URL>/auth/v1`) are derived from it |
| `SUPABASE_PUBLISHABLE_KEY` | yes | Presented to the Auth and Data APIs to identify the project. Not a secret — the browser is given the same value — but only the server needs this copy |
| `SUPABASE_JWT_AUDIENCE` | no | Defaults to `authenticated` |
| `AUTH_RATE_LIMIT_REQUESTS_PER_MINUTE`, `AUTH_RATE_LIMIT_BURST` | no | Credential budget, per client and per account. Defaults `10` and `5` |

Not needed, and deliberately not read: `SUPABASE_SECRET_KEY`,
`SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_JWT_SECRET`. If no publishable key is
configured the service still boots, serves its probes, and answers `503` on the
credential endpoints — a diagnosable state rather than a crash loop.

## Running it

```bash
cd services
SERVICE_NAME=auth HTTP_ADDR=:8082 go run ./auth/cmd/auth
```

`GET /api/v1/health` answers immediately. The credential endpoints need
`SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in the environment.

The gateway reaches it through `UPSTREAM_AUTH_URL`:

```bash
UPSTREAM_AUTH_URL=http://localhost:8082 SERVICE_NAME=gateway HTTP_ADDR=:8080 go run ./gateway/cmd/gateway
```

With that variable unset the gateway answers `503` for `/api/v1/auth/*` — routed,
but not proxied.

## Tests

```bash
cd services && gofmt -l . ../packages/go && go vet ./... && go test ./...
```

`auth_test.go` runs the real HTTP stack (router, middleware, rate limiter, error
envelope) against a fake Supabase, and covers: registration and sign-in,
invalid credentials, an unverified account, refresh rotation, an expired, forged,
`anon`-key or `service_role` token, unauthenticated reads, sign-out and its
idempotent retry, malformed bodies, oversized bodies, the credential throttle, a
Supabase outage, and the absence of passwords or tokens from log output.
`internal/supabaseauth/client_test.go` covers the client itself, including the
two sign-up response shapes and that an upstream error keeps only its
machine-readable code.

## What still has to be configured to deploy

1. **A host for this service.** It builds as a standalone binary
   (`go build ./auth/cmd/auth`) and is not part of the two services in
   `vercel.json`; adding a third service is a topology decision for the deployment
   owner. See [deployment/vercel.md](../../docs/deployment/vercel.md#deploying-the-auth-service).
2. **`UPSTREAM_AUTH_URL`** on the gateway, set to that host's address. The value is
   environment-specific and is intentionally absent from this repository.
3. **`SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`** visible to the process that
   runs this service.
