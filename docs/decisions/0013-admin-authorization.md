# 0013 — Admin authorization is a database row, checked on every request

- Status: accepted
- Date: 2026-10-13
- Deciders: the platform owner (Workstream: secure admin and real admin data)

## Context

The admin dashboard shipped as a prototype: thirteen screens reading a fixture
module (`src/lib/admin-mock.ts`) with invented users, reports and counts, behind a
route guard and nothing else. `services/admin` was a stub. Two facts forced a
decision:

1. **A frontend guard is not an authorization boundary.** Hiding a screen changes
   what a browser renders, not what the API answers. Every privileged operation
   had to be refused by the server, including a direct `curl` with a hand-written
   body.
2. **A role claim is not the same thing as a role.** The platform's tier
   middleware (`ModeratorFunc`, `AdminFunc`) reads `app_metadata.role` from the
   access token — a claim written by Supabase's admin API. The application's own
   roles live in `public.user_roles`, written by this database. The two can
   disagree, and the token is the one that is stale: it keeps its claim until it
   expires.

Three properties had to survive the solution: the existing per-route tier model
(ADR 0003), the database-authorization model where grants and RLS are the boundary
(ADR 0007), and the refusal to hold a service-role key anywhere in the request
path, because that key bypasses RLS entirely.

## Decision

**Authorization for the admin surface is decided by a row the caller does not
control, and it is re-checked on every request.**

1. **Two checks, and the row wins.** Staff routes keep their tier
   (`ModeratorFunc`/`AdminFunc`) — so a token without a strong enough claim never
   reaches a handler — and then each handler's wrapper asks the database, as the
   caller, what role they hold (`public.admin_identity()`, reading
   `public.user_roles`). A caller whose claim says `admin` but whose row says
   `user` is refused with `403`. Because the row is read per request, revoking a
   role takes effect on the caller's next request, not when their token expires.

2. **Nothing privileged is a table write.** Every admin read is a `security definer`
   function (`admin_overview`, `admin_game_directory`, `admin_user_directory`, …)
   and every moderation write is a function too. Reasons: `profiles.is_suspended`
   and `comments.is_hidden` have no `UPDATE` grant for `authenticated`, and
   Postgres column grants are additive, so "granted for staff" would grant them to
   everyone; a moderation action and its `moderation_actions` audit row must land
   in one transaction; and a `security definer` function can join tables the Data
   API cannot reach (`auth.users` for an email, `profiles` from a foreign key that
   points at `auth.users`).

3. **The caller is never a parameter.** Each function takes the id of the object
   being acted on and derives the actor from `auth.uid()`; there is no
   `p_actor`, `p_moderator` or `p_role` to forge. Refusals raise `42501`, the same
   SQLSTATE a missing grant raises, so a refusal cannot be distinguished from a
   table the caller was never granted.

4. **No service-role key in the admin service.** Every database call carries the
   caller's own access token. The service therefore cannot do anything the person
   holding the token could not do, and a bug in a handler cannot read a table no
   policy allows. This amends the older note in
   [data-access.md](../security/data-access.md) that described admin tooling as an
   intended holder of the service key: that key is now held by no service at all.

5. **No role-writing endpoint.** Roles are granted and revoked by an operator
   against `public.user_roles`, with the procedure below. A dashboard button would
   have to be authorized by the very role it edits, and a privilege-escalation bug
   in it would be a platform compromise rather than a bad request.

6. **A capability the schema cannot back is reported, not faked.** Where the
   prototype had no data model behind it (featured slots, notification campaigns,
   platform settings, category editing) the screen says so and offers no control.
   Invented production data is a defect, not a placeholder.

## Granting and revoking a role

Both halves are required today. The **row** is what authorizes; the **claim** is
what the tier middleware admits. Doing only one produces a clear failure: a row
without the claim is a `403` from the middleware, and a claim without the row is a
`403` from the database check.

```sql
-- 1. The row (Supabase dashboard → SQL editor, or psql with the project's
--    connection string). Service-role/SQL only: authenticated has no write grant
--    on this table, and that is deliberate.

-- grant
insert into public.user_roles (user_id, role, granted_by)
values ('<user-uuid>', 'moderator', '<granting-admin-uuid>')
on conflict (user_id) do update
  set role = excluded.role,
      granted_at = now(),
      granted_by = excluded.granted_by;

-- revoke (demote to a normal account; the row is kept, not deleted)
update public.user_roles
   set role = 'user', granted_at = now(), granted_by = '<granting-admin-uuid>'
 where user_id = '<user-uuid>';

-- audit: who holds what
select ur.user_id, ur.role, ur.granted_at, ur.granted_by
  from public.user_roles ur
 where ur.role <> 'user';
```

2. The claim, in Supabase's dashboard (Authentication → Users → that account →
   **Edit** → _App metadata_): `{ "role": "moderator" }` or `{ "role": "admin" }`.
   This is the value the tier middleware reads; it is written by Supabase's admin
   API, never by this application.

3. The person signs in again (or refreshes their session) so the token carries the
   new claim, then confirms with:

```bash
curl -sS -H "Authorization: Bearer $ACCESS_TOKEN" \
  https://onemorestartup.vercel.app/api/v1/admin/session
# {"userId":"…","role":"moderator","isStaff":true,"isAdmin":false,…}
```

4. Revoking is the same in reverse: demote the row, and remove the app metadata
   claim. The row takes effect immediately; the claim lasts until the token is
   refreshed, which is why the row is the check that decides.

## Consequences

**Easier.** An ordinary user cannot reach administrative data by any route,
including a direct API call with a forged body, because no handler accepts an
actor and every function re-derives the caller. A revoked role stops working on the
next request. A leaked admin deployment gains nothing, because it holds no
database credential beyond the caller's token. Every decision is attributable:
`moderation_actions` records the actor from `auth.uid()` in the same transaction as
the change.

**Harder.** Two systems must be changed to create a moderator (the row and the
claim), which is friction by design but is friction. Each staff request costs one
extra round trip to read the caller's role — a deliberate trade for revocation
that takes effect immediately; if it ever matters, the identity read can be cached
for a few seconds per token without weakening the model much. Role changes leave no
in-application trail (only `granted_at`/`granted_by` on the row), because there is
no role-management UI; an operator doing this by hand should record why.

**Reversing it.** Granting roles through an endpoint, or trusting the token claim
alone, is a small code change and a large semantic one: it would trade immediate
revocation and a single authorization source for one less round trip. The
migrations are additive, so a future decision can layer a role-management surface
on top — it would still have to write `user_roles` and an audit row atomically.
