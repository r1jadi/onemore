# supabase/migrations

The schema's only history. Applied in filename order by the Supabase CLI and by
`scripts/test-rls.sh`.

| Migration | Contents |
| --- | --- |
| `20261005120000_core_schema.sql` | Enums, tables, constraints, indexes, `updated_at` and auth triggers. |
| `20261005120100_rls_and_grants.sql` | Role helpers, grants (column level where it matters), RLS policies, integrity triggers. |
| `20261005120200_storage_buckets.sql` | Buckets with size/MIME limits and path-ownership policies. |

## Adding one

```bash
supabase migration new add_whatever
# write the SQL, then:
./scripts/test-rls.sh
```

* Append-only: never edit a migration that has been applied anywhere — add another.
* One concern per file: schema in one, security in another, so a reviewer can see
  the intent.
* Every new table needs RLS enabled, an explicit grant (column level where useful),
  policies for each verb a role may attempt, and `allow` + `denied`/`blocked`
  assertions in `tests/security/rls_test.sql`.
* A destructive change (drop or rewrite a column) is three migrations: expand,
  migrate data, contract — applied across deployments, not in one step.
* The reasoning behind the current model is in
  [../../docs/decisions/0007-database-authorization-model.md](../../docs/decisions/0007-database-authorization-model.md),
  and the access matrix is in
  [../../docs/security/data-access.md](../../docs/security/data-access.md).

`supabase/seed.sql` (parent directory) holds reference data only and is
idempotent — CI applies it three times.
