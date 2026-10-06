# Data access and authorization

Two layers guard every exposed table, and they are independent on purpose:

1. **Grants** decide which verbs a role may attempt, at column level where it
   matters. A missing grant is an error (`42501`), not a silent failure.
2. **RLS policies** decide which rows that attempt may touch. A filtered row is
   invisible (`0 rows`), and a rejected write is an error.

A bug in one layer does not open the table. Both are exercised by
`tests/security/rls_test.sql` — see [testing.md](testing.md).

## The roles

| Role | Who holds it | Reaches the database |
| --- | --- | --- |
| `anon` | the publishable key without a session | yes, with no identity |
| `authenticated` | a signed-in user's access token | yes, identity from `auth.uid()` |
| `service_role` | the server (Go services, admin tooling) | yes, bypasses RLS |
| `moderator`, `admin` | not Postgres roles — a `user_roles.role` value | as `authenticated`, with policies that consult it |

Staff status is not a database role. It is a row in `user_roles`, read by the
`security definer` helpers `public.current_role()`, `public.is_staff()` and
`public.is_admin()`, which take **no arguments** and always use `auth.uid()`: a
function parameterised by user id would let anyone probe who is an administrator.

## Matrix

`✓` allowed, `—` no grant, `own` scoped to the caller's row, `staff` requires the
moderator or admin role.

| Table | anon | authenticated | service_role |
| --- | --- | --- | --- |
| `categories` | select | select | all |
| `games` | select (published only) | select (published + own + staff), insert own (draft/review), update own (draft/review), delete own (draft), update staff | all |
| `profiles` | select public columns | select public columns, update own presentation columns | all |
| `user_roles` | — | select own, select staff | all (the only writer) |
| `game_sessions` | — | select own, insert own | all |
| `scores` | select (visible games) | select (visible games) | all (the only writer) |
| `comments` | select (not hidden) | select (not hidden + own + staff), insert own (published games), update own body, delete own or staff | all (hides comments) |
| `likes` | select | select, insert own, delete own | all |
| `follows` | select | select, insert own, delete own | all |
| `reports` | — | insert own, select own, select/update staff | all |
| `moderation_actions` | — | select staff, insert staff (as `auth.uid()`) | all |
| `notifications` | — | select own, update own `read_at` | all |
| `analytics_events` | — | — (no grant at all) | all |
| `storage.objects` | select public buckets | select, insert/update/delete under `<own-user-id>/` in a writable bucket | all |

## Rules the matrix encodes

* **No client-written privilege.** No `INSERT`/`UPDATE` grant on `user_roles` for
  `authenticated`; role changes require the service key.
* **No client-written scores.** No `INSERT` grant on `scores`; the game-sessions
  service writes them after validating the session.
* **No client-written moderation state.** `comments.is_hidden` and
  `profiles.is_suspended` have no `UPDATE` grant for `authenticated`. Postgres
  column grants are additive, so a column granted "for staff" would be granted to
  everyone — hiding a comment or suspending an account is a service action.
* **No client-written lifecycle state.** A creator may hold a game in
  `draft`/`review` only; `published` and `rejected` come from a moderator.
* **Immutable columns.** `games.owner_id` cannot change, for anyone (trigger), so
  moderation cannot silently reassign authorship.
* **Stamped facts.** `games.published_at` and `reports.resolved_by`/`resolved_at`
  are written by database triggers from the database clock and `auth.uid()`, so
  they cannot be forged by a request body.
* **Least data.** `profiles` exposes only public columns to the Data API;
  `analytics_events` is unreachable from the browser; lists are capped.

## Storage

| Bucket | Public read | Write | Limits |
| --- | --- | --- | --- |
| `avatars` | yes | owner folder only | 2 MiB, png/jpeg/webp |
| `game-assets` | yes | owner folder only | 10 MiB, png/jpeg/webp/avif |
| `game-builds` | no | owner folder only | 50 MiB, zip/json/html/js/css |

The folder must be the uploader's user id, so guessing a path does not grant
write access to someone else's object. Objects are served as static bytes; a HTML
file inside a private bucket is never executed by the origin.

## The service_role key

It bypasses RLS. Therefore:

* it exists only in server-side environments (Vercel SSR env, the API's secret
  store) — never in a `VITE_` variable, never in a client bundle, never in a log;
* each use should be justified by "a user cannot be trusted to do this";
* the admin and moderation services are the only intended holders;
* leaking it means a full database compromise: rotate it immediately
  (see [env-and-secrets.md](env-and-secrets.md)).

## Changing the model

1. Add a migration; never edit an applied one.
2. Update the grant and the policy in the same migration, so the table is never
   briefly unreachable or briefly open.
3. Add `allow` and `denied`/`blocked` assertions to `tests/security/rls_test.sql`
   for the new behaviour.
4. Update this matrix and `docs/architecture/data-model.md`.
