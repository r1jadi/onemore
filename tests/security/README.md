# tests/security

## `rls_test.sql`

The database authorization suite: 50+ assertions across `anon`, a player, a
suspended account, a moderator, an administrator and `service_role`, covering both
the allowed and the denied direction. It runs in one transaction and rolls back, so
it leaves no data behind, and it refuses to run against a hosted project (it checks
for the `supabase_admin` role).

Assertion helpers, so a new test says what it means:

| Helper | Meaning |
| --- | --- |
| `ok(condition, msg)` | a boolean must hold |
| `allow(stmt, msg)` | must succeed, affecting ≥ 1 row |
| `denied(stmt, msg)` | must be rejected with `42501` (grant or RLS) |
| `rejected(stmt, msg)` | must fail on a constraint |
| `blocked(stmt, msg)` | must silently affect 0 rows |
| `visible(stmt, expected, msg)` | must return exactly `expected` rows |

## `supabase_stub.sql`

The `auth` helpers, Data API roles and `storage` objects a hosted project
provides, so the migrations and the suite run on plain Postgres in CI and locally.
It is never applied to a real project.

## Running it

```bash
./scripts/test-rls.sh                              # ephemeral Docker Postgres
DATABASE_URL=postgres://... ./scripts/test-rls.sh   # an existing disposable database
```

CI runs it on every change under `supabase/**`, plus twice more to prove the seed
is idempotent. See [../../docs/security/testing.md](../../docs/security/testing.md).

## Not here yet

Contract tests against a running service, fuzzing of the Go token and JSON
decoders, and a load profile are listed as gaps in
[../../docs/development/testing.md](../../docs/development/testing.md).
