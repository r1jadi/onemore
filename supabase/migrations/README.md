# supabase/migrations

The schema's only history. Applied in filename order by the Supabase CLI and by
`scripts/test-rls.sh`.

| Migration                                          | Contents                                                                                                                                                                                                                                       |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20261005120000_core_schema.sql`                   | Enums, tables, constraints, indexes, `updated_at` and auth triggers.                                                                                                                                                                           |
| `20261005120100_rls_and_grants.sql`                | Role helpers, grants (column level where it matters), RLS policies, integrity triggers.                                                                                                                                                        |
| `20261005120200_storage_buckets.sql`               | Buckets with size/MIME limits and path-ownership policies.                                                                                                                                                                                     |
| `20261012120000_games_catalog.sql`                 | The `games`/`categories` catalogue, its playable-implies-runtime constraint, and the seeded catalogue.                                                                                                                                         |
| `20261013120000_play_sessions.sql`                 | Server-issued sessions, the Stack 10 verifier, the public activity view and the board functions. Replaces client-written sessions and scores with server-issued ones.                                                                          |
| `20261013120100_stack10_playable.sql`              | Flips Stack 10 to `playable` and names its runtime. Apply **last**, after the play schema and the deployment carrying the runtime are live.                                                                                                    |
| `20261013130000_admin_operations.sql`              | The admin operations surface: `admin_guard_staff()`/`admin_guard_admin()`, the overview/analytics aggregates, the game, account, report, comment, score and audit directories, and the four moderation writes that record their own audit row. |
| `20261013130100_admin_identity_and_categories.sql` | `admin_identity()` (the caller's own role, read from `user_roles`) and `admin_category_directory()` (categories with published **and** total game counts).                                                                                     |

Two migrations exist for one feature — the play schema and the catalogue flip — because
the flip is a claim about shipped code. Applying it before the service that answers
`/api/v1/sessions` is deployed would offer a Play button whose only endpoint answers
`503`. See [docs/games](../../docs/games/README.md).

## Adding one

```bash
supabase migration new add_whatever
# write the SQL, then:
./scripts/test-rls.sh
```

- Append-only: never edit a migration that has been applied anywhere — add another.
- One concern per file: schema in one, security in another, so a reviewer can see
  the intent.
- Every new table needs RLS enabled, an explicit grant (column level where useful),
  policies for each verb a role may attempt, and `allow` + `denied`/`blocked`
  assertions in `tests/security/rls_test.sql`.
- A destructive change (drop or rewrite a column) is three migrations: expand,
  migrate data, contract — applied across deployments, not in one step.
- The reasoning behind the current model is in
  [../../docs/decisions/0007-database-authorization-model.md](../../docs/decisions/0007-database-authorization-model.md),
  and the access matrix is in
  [../../docs/security/data-access.md](../../docs/security/data-access.md).

`supabase/seed.sql` (parent directory) holds reference data only and is
idempotent — CI applies it three times.
