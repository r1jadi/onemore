# Email confirmation (Supabase link flow)

Supabase sends a verification **link**, not a six-digit code. The app implements
that flow end to end; this note records the wiring and the manual dashboard
steps that code cannot perform.

## How it works in code

- `POST /api/v1/auth/sign-up` (Go auth service) forwards the credential to
  Supabase and proposes `options.emailRedirectTo = <SITE>/auth/callback`
  (`services/auth/internal/supabaseauth/client.go`). The site is resolved from
  `PUBLIC_SITE_URL`, `SITE_URL`, then `VITE_PUBLIC_SITE_URL`, defaulting to
  `https://onemorestartup.vercel.app`. An invalid value is omitted rather than
  sent.
- The pending screen is `/verify-email` (link instructions, resend via
  Supabase `/auth/v1/resend`, continue to login). It never asks for a code.
- The callback is `/auth/callback` (`src/routes/auth.callback.tsx`):
  `?token_hash&​type` is verified via `POST <SUPABASE>/auth/v1/verify`,
  `?code` is exchanged via PKCE (`/auth/v1/token?grant_type=pkce` with the
  stored verifier), and `#access_token&refresh_token` fragments are adopted.
  Every token is verified by the backend (`POST /auth/session`) before the app
  treats the caller as authenticated. Callback parameters are stripped from the
  URL immediately; failures show a specific message with a resend path.
- Login (`/login`) keeps the server's message for HTTP responses (unconfirmed
  email, wrong password, rate limit) and reports a connection problem only when
  the fetch itself threw. A `localhost` API URL baked into a production bundle
  is ignored in favour of same-origin (`src/lib/config.ts`), but the deployment
  must still set `VITE_API_BASE_URL` correctly.

## Manual Supabase steps (owner)

1. **Authentication → URL Configuration → Site URL**: `https://onemorestartup.vercel.app`.
2. **Redirect URLs** (allowlist): add
   - `https://onemorestartup.vercel.app/auth/callback`
   - `https://onemorestartup.vercel.app/auth/callback?next=/reset-password`
   - preview origins as needed (`https://onemorestartup-*.vercel.app/auth/callback`).
     Without these, Supabase ignores the proposed `emailRedirectTo`.
3. **Authentication → Email templates → Confirm signup**: ensure the button links
   to `{{ .ConfirmationURL }}` (the Supabase verify URL carrying the redirect).
   Do not replace it with a code template.
4. **Authentication → Providers → Email**: confirm signup confirmation is ON
   (the app handles the pending state; do not disable it to make signup look
   instant).
5. **Vercel env (Production)**: `PUBLIC_SITE_URL=https://onemorestartup.vercel.app`,
   `VITE_API_BASE_URL=https://onemorestartup.vercel.app/api/v1`,
   `CORS_ALLOWED_ORIGINS=https://onemorestartup.vercel.app`.

## Verify without touching production data

- Sign up with a disposable address, expect `201` with `user` and no `tokens`.
- Open the newest link, expect a redirect to `/auth/callback` then `/`.
- Reusing the same link must fail with an invalid/expired message, not a login.
