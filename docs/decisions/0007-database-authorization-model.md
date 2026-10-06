# 0007 — Grants plus RLS, with privileges held in a separate table

* Status: accepted
* Date: 2026-10-05

## Context

Supabase exposes Postgres through a Data API, so "the table is reachable" is a
property of the schema, not of the application. Ordinary mistakes — forgetting to
filter by owner, trusting an id from the request, adding a role field to a profile
update handler — become data breaches if authorization is only enforced in
application code.

Three specific traps drove the design:

1. **`authenticated` is a single role.** Policies can distinguish staff from
   players, but *column* grants cannot: Postgres grants are additive, so granting
   `UPDATE (is_hidden)` "for moderators" grants it to every signed-in user.
2. **Roles are attractive to store on the profile row**, where a profile update
   (or a mass-assignment bug) can escalate them.
3. **Client-written scores** destroy the meaning of every leaderboard.

## Decision

Two independent layers on every exposed table, plus three rules about where
privilege lives:

* **Grants decide verbs, at column level where it matters.** `anon` and
  `authenticated` start from `REVOKE ALL`, then receive the minimum. A missing
  grant is an error, not a silent no-op.
* **RLS decides rows.** Every table has RLS enabled; tables with no legitimate
  browser access (`analytics_events`) have RLS and *no policies at all*, so they
  are unreachable even if a grant is added by mistake later.
* **Roles live in `public.user_roles`, never on `profiles`.** No write grant for
  `authenticated` exists on that table, so role changes require the `service_role`
  key. Staff checks go through `security definer` helpers
  (`current_role()`, `is_staff()`, `is_admin()`) that take **no user id** — a
  parameterised helper would let anyone probe who is an administrator.
* **Privileged columns are not granted to `authenticated` at all.**
  `profiles.is_suspended` and `comments.is_hidden` are written by services with
  `service_role`. `profiles.username` is likewise not updatable through the Data
  API.
* **`scores` has no client `INSERT`.** The game-sessions service writes a score
  only after validating a session it owns; the session carries the server-chosen
  seed and start time.
* **Facts are stamped by the database.** `games.published_at` and
  `reports.resolved_by`/`resolved_at` come from triggers reading the database clock
  and `auth.uid()`, so a request body cannot forge them.
* **Immutable where it matters.** A trigger rejects any change to `games.owner_id`,
  for every role.
* **The model is tested.** `tests/security/rls_test.sql` asserts 50+ allowed and
  denied operations across `anon`, a player, a suspended account, a moderator, an
  administrator and `service_role`.

## Consequences

* A bug in a service does not automatically become a data breach: the database
  refuses the write, and the failure is loud (`42501`) rather than silent.
* Some legitimate operations need the service key, which means they cannot be done
  from the browser at all (hiding a comment, suspending an account, granting a
  role, publishing a game). That is intentional; the admin and moderation services
  own those paths and record who did what.
* Every new table carries a checklist: RLS, explicit grants, policies per verb,
  tests for the denied cases, and a row in `docs/security/data-access.md`.
* Column-level grants make some future features awkward (a "staff-only column" is
  not expressible), so those features are designed as separate tables or service
  actions from the start.
* Migrations must be reviewed as security code. CI applies them to an empty
  database and runs the suite, so a policy that silently widens access fails the
  build.
