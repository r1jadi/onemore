-- 0002 — Row Level Security, grants and integrity triggers.
--
-- Two independent layers guard the data:
--   1. GRANTS decide which verbs a role may attempt at all (column level where
--      it matters, e.g. no UPDATE on `profiles.is_suspended`);
--   2. RLS policies decide which rows that attempt may touch.
-- A mistake in one layer does not open the table, which is the point.
--
-- Default posture: deny. Every grant and policy below is additive and explicit.
-- `service_role` keeps full access and is only ever used server-side; it must
-- never reach the browser (see docs/security/data-access.md).

-- ─────────────────────────────────────────────────────────────────────────────
-- Role helpers
--
-- These take no user id on purpose: they always read the caller's identity from
-- the verified JWT (`auth.uid()`). A function parameterised by user id would let
-- anyone probe who is an administrator.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.current_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select r.role from public.user_roles r where r.user_id = auth.uid()),
    'user'::public.app_role
  );
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_role() in ('moderator'::public.app_role, 'admin'::public.app_role);
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_role() = 'admin'::public.app_role;
$$;

-- Integrity helpers -----------------------------------------------------------------

-- Rejects any UPDATE that a policy should not permit but which policies cannot
-- express (policies cannot see the previous row).
create or replace function public.reject_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'column % cannot be changed on %', tg_argv[0], tg_table_name
    using errcode = '42501';
end;
$$;

create or replace function public.stamp_game_publication()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status = 'published' and old.status is distinct from 'published' then
    new.published_at := coalesce(new.published_at, now());
  elsif new.status <> 'published' then
    new.published_at := null;
  end if;
  return new;
end;
$$;

create trigger games_stamp_publication
  before update on public.games
  for each row execute function public.stamp_game_publication();

create trigger games_owner_is_immutable
  before update on public.games
  for each row
  when (new.owner_id is distinct from old.owner_id)
  execute function public.reject_change('owner_id');

create or replace function public.stamp_report_resolution()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status in ('resolved', 'dismissed') and old.status not in ('resolved', 'dismissed') then
    -- The resolver is the caller, not a value from the request.
    new.resolved_by := auth.uid();
    new.resolved_at := coalesce(new.resolved_at, now());
  end if;
  return new;
end;
$$;

create trigger reports_stamp_resolution
  before update on public.reports
  for each row execute function public.stamp_report_resolution();

-- ─────────────────────────────────────────────────────────────────────────────
-- Remove the default grants, then grant the minimum
-- ─────────────────────────────────────────────────────────────────────────────

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;
revoke all on all functions in schema public from public;

-- Future tables start locked too.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

grant usage on schema public to anon, authenticated;
grant select on public.categories to anon, authenticated;

grant select on public.games to anon, authenticated;
grant insert, update, delete on public.games to authenticated;

-- Public profile projection only: `is_suspended` is deliberately excluded, so a
-- moderation flag is not readable from the Data API at all (staff read it
-- through the admin service with the service_role key).
grant select (id, username, display_name, bio, avatar_path, onboarded_at, created_at, updated_at)
  on public.profiles to anon, authenticated;
-- Column-level: a user can edit presentation fields, never `username`,
-- `is_suspended` or timestamps.
grant update (display_name, bio, avatar_path, onboarded_at) on public.profiles to authenticated;

grant select on public.user_roles to authenticated;

grant select on public.scores to anon, authenticated;

grant select on public.game_sessions to authenticated;
-- Insert only. A session is closed by the game-sessions service (service_role)
-- when the run ends, so a client cannot declare its own run finished and have a
-- score accepted for it later.
grant insert on public.game_sessions to authenticated;

grant select on public.comments to anon, authenticated;
grant insert, delete on public.comments to authenticated;
grant update (body) on public.comments to authenticated;
-- Authors may edit their own text. `is_hidden` is deliberately NOT granted to
-- `authenticated`: Postgres column grants are additive, so granting it for
-- staff would also grant it to every user. Hiding is a moderation action and
-- runs through the moderation service with the service_role key.

grant select on public.likes to anon, authenticated;
grant insert, delete on public.likes to authenticated;

grant select on public.follows to anon, authenticated;
grant insert, delete on public.follows to authenticated;

grant insert on public.reports to authenticated;
grant select on public.reports to authenticated;
grant update (status) on public.reports to authenticated;

grant select, insert on public.moderation_actions to authenticated;

grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

-- analytics_events: no grant to anon or authenticated. Events are written by the
-- analytics service (service_role) after server-side validation.

-- The service_role key is the server-side key used by the Go services. It is
-- the only role with full access and it bypasses RLS by design; it must never be
-- shipped to a browser, and it is the reason the browser only ever gets the
-- publishable key (see docs/security/env-and-secrets.md).
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;

grant execute on function public.current_role() to anon, authenticated;
grant execute on function public.is_staff() to anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.categories enable row level security;
alter table public.games enable row level security;
alter table public.game_sessions enable row level security;
alter table public.scores enable row level security;
alter table public.comments enable row level security;
alter table public.likes enable row level security;
alter table public.follows enable row level security;
alter table public.reports enable row level security;
alter table public.moderation_actions enable row level security;
alter table public.notifications enable row level security;
alter table public.analytics_events enable row level security;

-- profiles ---------------------------------------------------------------------
create policy profiles_select_public
  on public.profiles for select to anon, authenticated
  using (true);

create policy profiles_update_self
  on public.profiles for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id and not is_suspended);

-- No insert policy: rows are created by the auth trigger. No delete policy:
-- account deletion is an explicit server-side operation.

-- user_roles -------------------------------------------------------------------
-- Read your own role (the UI needs it) and let staff read the roster. There is
-- no write policy at all: role changes require the service_role key.
create policy user_roles_select_own
  on public.user_roles for select to authenticated
  using (auth.uid() = user_id);

create policy user_roles_select_staff
  on public.user_roles for select to authenticated
  using (public.is_staff());

-- categories -------------------------------------------------------------------
create policy categories_select_public
  on public.categories for select to anon, authenticated
  using (true);

-- games ------------------------------------------------------------------------
create policy games_select_visible
  on public.games for select to anon, authenticated
  using (status = 'published' or owner_id = auth.uid() or public.is_staff());

create policy games_insert_own_draft
  on public.games for insert to authenticated
  with check (owner_id = auth.uid() and status in ('draft', 'review'));

-- An owner may edit their game, but publishing is a moderation decision: the
-- owner can only hold it in draft/review. Unpublishing is allowed.
create policy games_update_own
  on public.games for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid() and status in ('draft', 'review'));

create policy games_delete_own_draft
  on public.games for delete to authenticated
  using (owner_id = auth.uid() and status = 'draft');

create policy games_moderate_staff
  on public.games for update to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- game_sessions ----------------------------------------------------------------
create policy game_sessions_select_own
  on public.game_sessions for select to authenticated
  using (auth.uid() = user_id or public.is_staff());

create policy game_sessions_insert_own
  on public.game_sessions for insert to authenticated
  with check (user_id = auth.uid() and completed_at is null and abandoned_at is null);


-- scores -----------------------------------------------------------------------
-- Readable when the game is visible to the caller; never writable by a client.
create policy scores_select_visible
  on public.scores for select to anon, authenticated
  using (
    exists (
      select 1 from public.games g
      where g.id = game_id
        and (g.status = 'published' or g.owner_id = auth.uid() or public.is_staff())
    )
  );

-- comments ---------------------------------------------------------------------
create policy comments_select_visible
  on public.comments for select to anon, authenticated
  using (not is_hidden or author_id = auth.uid() or public.is_staff());

create policy comments_insert_own
  on public.comments for insert to authenticated
  with check (
    author_id = auth.uid()
    and not is_hidden
    and parent_id is null
    and exists (select 1 from public.games g where g.id = game_id and g.status = 'published')
  );

create policy comments_update_own_body
  on public.comments for update to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid() and not is_hidden);

create policy comments_delete_own_or_staff
  on public.comments for delete to authenticated
  using (author_id = auth.uid() or public.is_staff());

-- likes ------------------------------------------------------------------------
create policy likes_select_public
  on public.likes for select to anon, authenticated
  using (true);

create policy likes_insert_own
  on public.likes for insert to authenticated
  with check (user_id = auth.uid());

create policy likes_delete_own
  on public.likes for delete to authenticated
  using (user_id = auth.uid());

-- follows ----------------------------------------------------------------------
create policy follows_select_public
  on public.follows for select to anon, authenticated
  using (true);

create policy follows_insert_own
  on public.follows for insert to authenticated
  with check (follower_id = auth.uid());

create policy follows_delete_own
  on public.follows for delete to authenticated
  using (follower_id = auth.uid());

-- reports ----------------------------------------------------------------------
-- A reporter may create a report and read their own; only staff read the queue
-- and only staff resolve. `resolved_by` is stamped by a trigger from auth.uid().
create policy reports_insert_own
  on public.reports for insert to authenticated
  with check (
    reporter_id = auth.uid()
    and status = 'open'
    and resolved_by is null
    and resolved_at is null
  );

create policy reports_select_own_or_staff
  on public.reports for select to authenticated
  using (reporter_id = auth.uid() or public.is_staff());

create policy reports_update_staff
  on public.reports for update to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- moderation_actions -----------------------------------------------------------
create policy moderation_actions_select_staff
  on public.moderation_actions for select to authenticated
  using (public.is_staff());

create policy moderation_actions_insert_staff
  on public.moderation_actions for insert to authenticated
  with check (moderator_id = auth.uid() and public.is_staff());

-- notifications ----------------------------------------------------------------
create policy notifications_select_own
  on public.notifications for select to authenticated
  using (auth.uid() = user_id);

create policy notifications_update_own
  on public.notifications for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- analytics_events -------------------------------------------------------------
-- RLS is enabled with no policies: the table is invisible to anon and
-- authenticated even if a grant is added by mistake later.

comment on function public.is_staff() is
  'True when the caller (from auth.uid()) holds the moderator or admin role.';
