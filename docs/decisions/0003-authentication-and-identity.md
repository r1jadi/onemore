# 0003 — Supabase Auth is the identity provider; every service verifies tokens

* Status: accepted
* Date: 2026-10-05

## Context

Authentication must be real before any feature that has an owner can be built:
scores, profiles, comments, notifications and the admin dashboard all need a
trustworthy "who is calling".

Three approaches were available: build credential storage ourselves, trust a
gateway-authenticated header between services, or verify the same token at every
hop. The first is a liability (password hashing, reset flows, MFA, email
delivery). The second is convenient but turns the network into the trust boundary:
anything that can reach a service can claim any identity.

The login, sign-up, reset and verification screens already exist in the approved
UI and must not change.

## Decision

Supabase Auth owns credentials, sessions, email verification, password reset and
token issuance. It also publishes the project's JWKS.

Supabase is retiring the legacy `anon`/`service_role` keys in favour of
publishable (`sb_publishable_…`) and secret (`sb_secret_…`) keys, and the legacy
shared JWT secret in favour of rotatable signing keys
([API keys](https://supabase.com/docs/guides/getting-started/api-keys),
[JWT signing keys](https://supabase.com/docs/guides/auth/signing-keys)). The two
changes are independent, and this repository is already shaped for both:

* The web app reads the **publishable** key (`VITE_SUPABASE_PUBLISHABLE_KEY`,
  falling back to the deprecated anon name). Neither key is a JWT, so neither is
  ever verified by our code — they only identify the application to Supabase.
* The Go services never see an API key. They verify the **user's access token**,
  which is still a JWT signed by the project. Only the signing-key system below
  matters to them, which is why no code changes when the API keys are swapped.
* A publishable or secret key is sent on the `apikey` header, not
  `Authorization: Bearer`; the gateway forwards `Authorization` only, so the two
  mechanisms cannot be confused.

The Go services verify the token themselves with `authn.Verifier`:

* ES256/RS256 through the project's JWKS with a cached, rotated key set; HS256 only
  for legacy projects with a ≥32-character secret.
* `exp` and `iat` required; audience and issuer validated with 30s leeway;
  `alg: none`, unknown `kid`, symmetric keys in a JWKS document and off-curve EC
  keys rejected.
* `service_role` tokens refused on every user-facing route, even with a valid
  signature.
* With no verification material configured, a presented token gets `503` rather
  than being treated as anonymous.

`identity.Identity{UserID, Email, Role, Anonymous}` is attached to the request
context. Role comes from `app_metadata.role` on the token and is checked by the
route tier (`authenticated`, `moderator`, `admin`).

The gateway forwards the `Authorization` header unchanged. It does **not** mint an
identity header, and it deletes any client-supplied identity header before
forwarding, so a routing mistake cannot grant a role.

The web app sends the token only in the `Authorization` header, with
`credentials: "omit"`, so a cross-site request carries no authority and CSRF is
removed as an attack path for the API.

## Consequences

* Services are independently secure: a compromised gateway cannot impersonate a
  user, because the token still has to verify.
* Verification cost is per request, amortised by a cached JWKS (30-minute TTL,
  30-second minimum refresh interval) and mitigated further by rate limits.
* Rotating signing keys requires no deployment: the JWKS is fetched and stale keys
  are kept as a fallback while the cache refreshes.
* An HS256 project (legacy) means a shared secret in the API environment; the
  preferred configuration is asymmetric keys, which is why the secret is optional
  and `SUPABASE_JWKS_URL` is preferred (derived from `SUPABASE_URL` when unset).
  Migrating the project to signing keys is a dashboard action that needs no
  redeploy: the verifier picks the new key set up from the JWKS cache.
* Authorization lives in the token for coarse tiers and in `user_roles` for
  fine-grained data access. The two must agree; the RLS policies read
  `user_roles`, so a token with a stale role claim cannot read staff-only rows.
* The UI does not change: the existing screens keep their design, and connecting
  them to Supabase is a later task with its own tests.
