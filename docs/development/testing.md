# Testing

## What runs today

| Suite | Command | Covers |
| --- | --- | --- |
| Web unit tests | `bun run test` | SEO indexability rules and metadata, the API client's envelope/auth/URL behaviour, app routing |
| Web type check | `bun run typecheck` | The whole app and the scripts' TypeScript surface |
| Web lint | `bun run lint` | ESLint + Prettier |
| Web build | `bun run build` | The production bundle Vercel ships |
| Sitemap drift | `bun run sitemap:check` | `public/sitemap.xml` matches the SEO allowlist |
| Contract drift | `node scripts/check-api-contract.mjs` | OpenAPI paths vs the gateway routing table |
| Go unit + integration | `cd services && go test ./...` | JWT verification (14 cases), the wired service (probes, tiers, CORS, headers, rate limits, fail-closed config), the gateway proxy (routing, header stripping, SSRF safety) |
| Go platform tests | `cd packages/go/platform && go test ./...` | Token verification and JWKS key handling |
| Go static checks | `go vet ./...`, `gofmt -l` (both modules) | Correctness and formatting |
| Database security | `./scripts/test-rls.sh` | Migrations, seed idempotency and 50+ RLS assertions (allowed **and** denied) across six roles |
| Go vulnerabilities | `govulncheck ./...` (CI) | Known CVEs in the dependency graph |
| Secret scanning | `gitleaks` (CI) | No credential in the working tree or history |

CI mirrors all of it: `.github/workflows/web.yml`, `go.yml`, `database.yml`,
`api-contract.yml`, `security.yml`.

## The database suite in detail

`tests/security/rls_test.sql` runs in one transaction and rolls back, so it is
safe to run repeatedly. Each assertion is one of:

* `ok(condition, message)` — a boolean that must hold;
* `allow(statement, message)` — the statement must succeed and affect ≥1 row;
* `denied(statement, message)` — the statement must be rejected (`42501`);
* `rejected(statement, message)` — the statement must fail on a constraint;
* `blocked(statement, message)` — the statement must silently affect 0 rows;
* `visible(statement, expected, message)` — the statement must return exactly
  `expected` rows.

It asserts, among others: anon sees only published games; a hidden comment is
invisible to anon but visible to its author; a player cannot read another player's
sessions, notifications, reports or storage folder; roles cannot be granted or
self-promoted through the Data API; scores cannot be written by a client; a game's
ownership is immutable; a creator cannot publish their own game; a suspended
account cannot write; staff can triage and resolve reports, and the resolver is
stamped from the token; the `service_role` can write scores, hide comments and
grant roles.

Run it before and after any change to `supabase/migrations`.

## Adding tests

* **Frontend logic** → a `*.test.ts` next to the code. Tests assert behaviour
  (what a function returns for given input), not markup snapshots.
* **A new endpoint** → a Go test that boots the service through `servicekit.New`
  and exercises the tier boundary: no token is `401`, wrong role is `403`, valid
  caller is allowed. The helpers in `services/internal/servicekit/servicekit_test.go`
  are the template.
* **A new policy or table** → at least one `allow` and one `denied`/`blocked`
  assertion in `tests/security/rls_test.sql`.
* **A new public route** → add it to `INDEXABLE_PATHS` in `src/lib/seo.ts`, run
  `bun run sitemap`, and extend the indexability tests in `src/lib/seo.test.ts`.

## Not covered yet

Stated plainly so nobody assumes otherwise:

* **No end-to-end browser tests.** `tests/e2e/` is empty; Playwright is the
  intended tool when the first real feature lands.
* **No load or performance tests.** `tests/load/` is empty.
* **No contract tests against a running service.** The drift check compares
  documents, not responses; a generated client from the OpenAPI spec plus a
  response-shape test is the next step.
* **No fuzzing.** `go test -fuzz` is a good fit for the token and JSON decoders
  once they gain more parsing surface.
* **No dependency scanning for the Go modules beyond govulncheck**, and no SBOM.
* **`-race` cannot run on a Windows/Git Bash checkout** (it needs cgo); CI runs it
  on Linux in `go.yml`.
* **Retries, timeouts and upstream failure modes** for the proxy are tested for
  error mapping, not for sustained flakiness.
