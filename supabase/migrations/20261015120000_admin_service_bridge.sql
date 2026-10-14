-- 0015 — The privileged admin-data bridge: service_role-only wrappers around
-- the staff-gated functions, so an ADMIN_EMAILS-allowlisted administrator
-- without a `user_roles` row can load the dashboard through the Go API.
--
-- Why this exists
-- ---------------
--
-- The Go admin service authorizes from the verified token email against the
-- server-side ADMIN_EMAILS allowlist and holds no per-user privilege beyond
-- the caller's own token — so its caller-token calls are refused by
-- `admin_guard_staff()` whenever the allowlisted account has no
-- `public.user_roles` row. The dashboard then renders with no data, even
-- though the caller is authorized at the application layer.
--
-- The bridge lets the Go service, and only the Go service, act on an
-- allowlisted decision it already made:
--
--   1. `public.admin_actor()` reads a transaction-local flag
--      (`app.admin_bridge_actor`) holding the verified administrator's uuid.
--      Nothing exposes a setter for it: it can only be set from inside a
--      `*_svc` wrapper, which only `service_role` may execute, and
--      `set_config(..., true)` keeps it inside the calling transaction, so it
--      can never leak across PostgREST requests.
--   2. `public.current_role()` reports `admin` while the flag is set, so every
--      existing guard (`is_staff()`, `is_admin()`, `admin_guard_staff()`,
--      `admin_guard_admin()`) passes for the bridged call — and only for it.
--      With the flag unset the expression is exactly what it was before, so
--      ordinary callers, moderators and direct PostgREST requests behave
--      byte-for-byte as they do today.
--   3. Audit attribution (`moderation_actions.moderator_id`,
--      `reports.resolved_by`, the self-suspension check) prefers the flag over
--      `auth.uid()`, because under a service-role call `auth.uid()` is not the
--      administrator. With the flag unset each statement is exactly what it
--      was before.
--   4. Each `*_svc` wrapper requires a non-null `p_actor` (the verified user
--      id the Go service passes after its allowlist check — never a
--      client-supplied value), sets the flag, and delegates to the existing
--      function, so there is exactly one copy of the dashboard's business
--      logic and it cannot drift from the row-gated path.
--
-- What this does NOT do
-- ---------------------
--
--   * No RLS policy is touched, no grant is widened, and no guard is removed:
--     the existing functions keep `authenticated` EXECUTE plus their row
--     checks for the moderator path and for direct PostgREST calls.
--   * The `*_svc` functions are `REVOKE`d from `public`, `anon` AND
--     `authenticated`, and `GRANT`ed to `service_role` only. A normal user's
--     token answers `permission denied` before any body runs — the grants,
--     enforced by Postgres itself, are the boundary, and they work the same
--     for legacy JWT service keys and for opaque `sb_secret_…` keys.
--   * The database never sees ADMIN_EMAILS and never authorizes from it: the
--     allowlist check stays in Go, per request. A stale `user_roles` row still
--     grants nothing through the Go API, and revoking an email revokes on the
--     next request with no row change.
--   * Anyone holding the secret key already bypasses RLS entirely (see
--     docs/security/threat-model.md: key holders are out of scope for
--     technical controls), so a `p_actor` value in a service-role call is
--     attribution, not a new capability.
--
-- Rollback (manual): drop the `*_svc` functions, then restore the four
-- original bodies (re-apply 0007 and the trigger from 0002, or
-- `git show` this file's inverses). No data is touched by either direction.

-- ─────────────────────────────────────────────────────────────────────────────
-- The bridge flag: the verified administrator for this transaction, if any
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.admin_actor()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select nullif(current_setting('app.admin_bridge_actor', true), '')::uuid;
$$;

comment on function public.admin_actor() is
  'The verified administrator a service_role wrapper is acting for, or NULL for every ordinary call. Set only inside the *_svc wrappers; never from client input.';

-- While the bridge flag is set the caller acts with administrator rights, so
-- the existing staff/admin guards pass for the bridged call. With the flag
-- unset this answers exactly what it always has.
create or replace function public.current_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when public.admin_actor() is not null then 'admin'::public.app_role
    else coalesce(
      (select r.role from public.user_roles r where r.user_id = auth.uid()),
      'user'::public.app_role
    )
  end;
$$;

-- The resolver stamp prefers the bridge actor for the same reason: under a
-- service-role call auth.uid() is not the administrator. Ordinary calls keep
-- stamping the caller from the token.
create or replace function public.stamp_report_resolution()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status in ('resolved', 'dismissed') and old.status not in ('resolved', 'dismissed') then
    -- The resolver is the caller, not a value from the request.
    new.resolved_by := coalesce(public.admin_actor(), auth.uid());
    new.resolved_at := coalesce(new.resolved_at, now());
  end if;
  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Audit attribution through the bridge (flag unset: identical to before)
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.admin_set_game_status(
  p_game_id uuid,
  p_status public.game_status,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous public.game_status;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_action text;
begin
  perform public.admin_guard_staff();

  select g.status into v_previous from public.games g where g.id = p_game_id for update;
  if not found then
    raise exception 'no such game' using errcode = 'P0002';
  end if;
  if v_previous = p_status then
    raise exception 'the game is already %', p_status using errcode = '22023';
  end if;

  -- Transitions are a whitelist rather than a free assignment: staff may decide
  -- publication, and may not quietly move a game the creator is still writing.
  if not (
    (p_status = 'review'    and v_previous in ('draft', 'published', 'rejected', 'archived'))
    or (p_status = 'published' and v_previous in ('review', 'rejected', 'archived'))
    or (p_status = 'rejected'  and v_previous in ('review', 'published'))
    or (p_status = 'archived'  and v_previous in ('published', 'rejected'))
  ) then
    raise exception 'cannot move a game from % to %', v_previous, p_status
      using errcode = '22023';
  end if;

  -- A refusal is a decision about someone's work; it is recorded with its reason.
  if p_status in ('rejected', 'archived') and v_reason is null then
    raise exception 'a reason is required to reject or archive a game'
      using errcode = '22023';
  end if;

  update public.games set status = p_status where id = p_game_id;

  v_action := case p_status
    when 'published' then 'publish_game'
    when 'rejected' then 'reject_game'
    when 'archived' then 'archive_game'
    else 'review_game'
  end;

  insert into public.moderation_actions (moderator_id, target_kind, target_id, action, reason)
  values (coalesce(public.admin_actor(), auth.uid()), 'game', p_game_id, v_action, v_reason);

  return jsonb_build_object(
    'gameId', p_game_id,
    'previousStatus', v_previous,
    'status', p_status,
    'action', v_action
  );
end;
$$;

create or replace function public.admin_set_report_status(
  p_report_id uuid,
  p_status public.report_status,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous public.report_status;
  v_target_kind public.report_target;
  v_target_id uuid;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_action text;
begin
  perform public.admin_guard_staff();

  select r.status, r.target_kind, r.target_id
    into v_previous, v_target_kind, v_target_id
  from public.reports r where r.id = p_report_id for update;
  if not found then
    raise exception 'no such report' using errcode = 'P0002';
  end if;
  if v_previous = p_status then
    raise exception 'the report is already %', p_status using errcode = '22023';
  end if;
  if p_status in ('resolved', 'dismissed') and v_reason is null then
    raise exception 'a reason is required to resolve or dismiss a report'
      using errcode = '22023';
  end if;

  -- `stamp_report_resolution` sets `resolved_by` from the actor on the way in;
  -- reopening has to clear both columns, because the table's own constraint says
  -- an open or reviewing report carries no resolution.
  update public.reports
  set status = p_status,
      resolved_by = case when p_status in ('resolved', 'dismissed') then resolved_by else null end,
      resolved_at = case when p_status in ('resolved', 'dismissed') then resolved_at else null end
  where id = p_report_id;

  v_action := case p_status
    when 'resolved' then 'resolve_report'
    when 'dismissed' then 'dismiss_report'
    when 'reviewing' then 'review_report'
    else 'reopen_report'
  end;

  -- The audit row names what was moderated — the reported game, comment or
  -- profile — because `report_target` has no `report` member and, more usefully,
  -- the effect of the decision lands on the reported object. `v_action` and the
  -- reason record the report decision itself.
  insert into public.moderation_actions (moderator_id, target_kind, target_id, action, reason)
  values (coalesce(public.admin_actor(), auth.uid()), v_target_kind, v_target_id, v_action, v_reason);

  return jsonb_build_object(
    'reportId', p_report_id,
    'previousStatus', v_previous,
    'status', p_status,
    'action', v_action
  );
end;
$$;

create or replace function public.admin_set_comment_hidden(
  p_comment_id uuid,
  p_hidden boolean,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous boolean;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_action text;
begin
  perform public.admin_guard_staff();

  select cm.is_hidden into v_previous from public.comments cm
  where cm.id = p_comment_id for update;
  if not found then
    raise exception 'no such comment' using errcode = 'P0002';
  end if;
  if v_previous = p_hidden then
    raise exception 'the comment is already in that state' using errcode = '22023';
  end if;
  if p_hidden and v_reason is null then
    raise exception 'a reason is required to hide a comment' using errcode = '22023';
  end if;

  update public.comments set is_hidden = p_hidden where id = p_comment_id;

  v_action := case when p_hidden then 'hide_comment' else 'unhide_comment' end;

  insert into public.moderation_actions (moderator_id, target_kind, target_id, action, reason)
  values (coalesce(public.admin_actor(), auth.uid()), 'comment', p_comment_id, v_action, v_reason);

  return jsonb_build_object(
    'commentId', p_comment_id,
    'hidden', p_hidden,
    'action', v_action
  );
end;
$$;

create or replace function public.admin_set_suspension(
  p_user_id uuid,
  p_suspended boolean,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_username text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_action text;
begin
  perform public.admin_guard_admin();

  -- Suspending yourself is refused: the account that locks the platform's
  -- administrators out would be the last one able to undo it. The actor is the
  -- bridge administrator when bridged, else the caller from the token.
  if p_user_id = coalesce(public.admin_actor(), auth.uid()) then
    raise exception 'you cannot suspend your own account' using errcode = '22023';
  end if;

  select pr.username::text into v_username from public.profiles pr where pr.id = p_user_id;
  if not found then
    raise exception 'no such account' using errcode = 'P0002';
  end if;
  if p_suspended and v_reason is null then
    raise exception 'a reason is required to suspend an account' using errcode = '22023';
  end if;

  update public.profiles set is_suspended = p_suspended where id = p_user_id;

  v_action := case when p_suspended then 'suspend_account' else 'restore_account' end;

  insert into public.moderation_actions (moderator_id, target_kind, target_id, action, reason)
  values (coalesce(public.admin_actor(), auth.uid()), 'profile', p_user_id, v_action, v_reason);

  return jsonb_build_object(
    'userId', p_user_id,
    'username', v_username,
    'suspended', p_suspended,
    'action', v_action
  );
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Privileged wrappers: service_role only, one per dashboard operation.
--
-- Each wrapper requires the verified administrator's uuid (passed by the Go
-- service after its ADMIN_EMAILS check — never client input), sets the
-- transaction-local bridge flag, and delegates to the existing function, so
-- the dashboard's logic lives in exactly one place. A null actor is the
-- caller's own mistake (22023); a non-service_role caller never reaches the
-- body (missing EXECUTE grant answers first).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.admin_overview_svc(p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_actor is null then
    raise exception 'a verified actor is required' using errcode = '22023';
  end if;
  perform set_config('app.admin_bridge_actor', p_actor::text, true);
  return public.admin_overview();
end;
$$;

comment on function public.admin_overview_svc(uuid) is
  'Privileged dashboard overview for an allowlisted administrator without a user_roles row. service_role only; the Go service passes the verified actor after its ADMIN_EMAILS check.';

create or replace function public.admin_analytics_svc(p_actor uuid, p_days integer default 28)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_actor is null then
    raise exception 'a verified actor is required' using errcode = '22023';
  end if;
  perform set_config('app.admin_bridge_actor', p_actor::text, true);
  return public.admin_analytics(p_days);
end;
$$;

comment on function public.admin_analytics_svc(uuid, integer) is
  'Privileged activity aggregate for an allowlisted administrator. service_role only.';

create or replace function public.admin_game_directory_svc(
  p_actor uuid,
  p_status text default null,
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  slug text,
  title text,
  tagline text,
  status public.game_status,
  is_official boolean,
  playable boolean,
  runtime text,
  category_slug text,
  category_name text,
  owner_username text,
  plays bigint,
  players bigint,
  best_score bigint,
  comments bigint,
  created_at timestamptz,
  published_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_actor is null then
    raise exception 'a verified actor is required' using errcode = '22023';
  end if;
  perform set_config('app.admin_bridge_actor', p_actor::text, true);
  return query
  select * from public.admin_game_directory(p_status, p_search, p_limit, p_offset);
end;
$$;

comment on function public.admin_game_directory_svc(uuid, text, text, integer, integer) is
  'Privileged game directory for an allowlisted administrator. service_role only.';

create or replace function public.admin_user_directory_svc(
  p_actor uuid,
  p_search text default null,
  p_role text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  username text,
  display_name text,
  email text,
  role public.app_role,
  is_suspended boolean,
  created_at timestamptz,
  last_active_at timestamptz,
  plays bigint,
  best_score bigint,
  reports_against bigint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_actor is null then
    raise exception 'a verified actor is required' using errcode = '22023';
  end if;
  perform set_config('app.admin_bridge_actor', p_actor::text, true);
  return query
  select * from public.admin_user_directory(p_search, p_role, p_limit, p_offset);
end;
$$;

comment on function public.admin_user_directory_svc(uuid, text, text, integer, integer) is
  'Privileged account directory for an allowlisted administrator. service_role only.';

create or replace function public.admin_report_directory_svc(
  p_actor uuid,
  p_status text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  status public.report_status,
  target_kind public.report_target,
  target_id uuid,
  target_label text,
  target_detail text,
  reason text,
  details text,
  reporter_username text,
  resolved_by_username text,
  created_at timestamptz,
  resolved_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_actor is null then
    raise exception 'a verified actor is required' using errcode = '22023';
  end if;
  perform set_config('app.admin_bridge_actor', p_actor::text, true);
  return query
  select * from public.admin_report_directory(p_status, p_limit, p_offset);
end;
$$;

comment on function public.admin_report_directory_svc(uuid, text, integer, integer) is
  'Privileged moderation queue for an allowlisted administrator. service_role only.';

create or replace function public.admin_comment_directory_svc(
  p_actor uuid,
  p_state text default null,
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  body text,
  author_username text,
  game_slug text,
  game_title text,
  is_hidden boolean,
  is_reply boolean,
  likes bigint,
  reports bigint,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_actor is null then
    raise exception 'a verified actor is required' using errcode = '22023';
  end if;
  perform set_config('app.admin_bridge_actor', p_actor::text, true);
  return query
  select * from public.admin_comment_directory(p_state, p_search, p_limit, p_offset);
end;
$$;

comment on function public.admin_comment_directory_svc(uuid, text, text, integer, integer) is
  'Privileged comment list for an allowlisted administrator. service_role only.';

create or replace function public.admin_score_directory_svc(
  p_actor uuid,
  p_game_slug text default null,
  p_username text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  game_slug text,
  game_title text,
  username text,
  score bigint,
  session_started_at timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_actor is null then
    raise exception 'a verified actor is required' using errcode = '22023';
  end if;
  perform set_config('app.admin_bridge_actor', p_actor::text, true);
  return query
  select * from public.admin_score_directory(p_game_slug, p_username, p_limit, p_offset);
end;
$$;

comment on function public.admin_score_directory_svc(uuid, text, text, integer, integer) is
  'Privileged verified-score list for an allowlisted administrator. service_role only.';

create or replace function public.admin_category_directory_svc(p_actor uuid)
returns table (
  slug text,
  name text,
  description text,
  sort_order integer,
  published_games bigint,
  total_games bigint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_actor is null then
    raise exception 'a verified actor is required' using errcode = '22023';
  end if;
  perform set_config('app.admin_bridge_actor', p_actor::text, true);
  return query
  select * from public.admin_category_directory();
end;
$$;

comment on function public.admin_category_directory_svc(uuid) is
  'Privileged category list for an allowlisted administrator. service_role only.';

create or replace function public.admin_moderation_log_svc(
  p_actor uuid,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  moderator_username text,
  target_kind public.report_target,
  target_id uuid,
  action text,
  reason text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_actor is null then
    raise exception 'a verified actor is required' using errcode = '22023';
  end if;
  perform set_config('app.admin_bridge_actor', p_actor::text, true);
  return query
  select * from public.admin_moderation_log(p_limit, p_offset);
end;
$$;

comment on function public.admin_moderation_log_svc(uuid, integer, integer) is
  'Privileged audit trail for an allowlisted administrator. service_role only.';

create or replace function public.admin_set_game_status_svc(
  p_actor uuid,
  p_game_id uuid,
  p_status public.game_status,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_actor is null then
    raise exception 'a verified actor is required' using errcode = '22023';
  end if;
  perform set_config('app.admin_bridge_actor', p_actor::text, true);
  return public.admin_set_game_status(p_game_id, p_status, p_reason);
end;
$$;

comment on function public.admin_set_game_status_svc(uuid, uuid, public.game_status, text) is
  'Privileged game moderation for an allowlisted administrator; the audit row names the verified actor. service_role only.';

create or replace function public.admin_set_report_status_svc(
  p_actor uuid,
  p_report_id uuid,
  p_status public.report_status,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_actor is null then
    raise exception 'a verified actor is required' using errcode = '22023';
  end if;
  perform set_config('app.admin_bridge_actor', p_actor::text, true);
  return public.admin_set_report_status(p_report_id, p_status, p_reason);
end;
$$;

comment on function public.admin_set_report_status_svc(uuid, uuid, public.report_status, text) is
  'Privileged report moderation for an allowlisted administrator; the resolver is the verified actor. service_role only.';

create or replace function public.admin_set_comment_hidden_svc(
  p_actor uuid,
  p_comment_id uuid,
  p_hidden boolean,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_actor is null then
    raise exception 'a verified actor is required' using errcode = '22023';
  end if;
  perform set_config('app.admin_bridge_actor', p_actor::text, true);
  return public.admin_set_comment_hidden(p_comment_id, p_hidden, p_reason);
end;
$$;

comment on function public.admin_set_comment_hidden_svc(uuid, uuid, boolean, text) is
  'Privileged comment moderation for an allowlisted administrator. service_role only.';

create or replace function public.admin_set_suspension_svc(
  p_actor uuid,
  p_user_id uuid,
  p_suspended boolean,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_actor is null then
    raise exception 'a verified actor is required' using errcode = '22023';
  end if;
  perform set_config('app.admin_bridge_actor', p_actor::text, true);
  return public.admin_set_suspension(p_user_id, p_suspended, p_reason);
end;
$$;

comment on function public.admin_set_suspension_svc(uuid, uuid, boolean, text) is
  'Privileged account suspension for an allowlisted administrator (admin-only at the Go layer too). service_role only.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Privileges: closed first, then opened to service_role alone.
--
-- Function EXECUTE defaults to PUBLIC, so every wrapper above is revoked from
-- public, anon AND authenticated before the single grant. An ordinary signed-in
-- caller answers `permission denied` (42501 family) before any body runs —
-- including for the bridge flag, which has no setter they can reach.
-- ─────────────────────────────────────────────────────────────────────────────

revoke all on function public.admin_overview_svc(uuid) from public, anon, authenticated;
revoke all on function public.admin_analytics_svc(uuid, integer) from public, anon, authenticated;
revoke all on function public.admin_game_directory_svc(uuid, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.admin_user_directory_svc(uuid, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.admin_report_directory_svc(uuid, text, integer, integer) from public, anon, authenticated;
revoke all on function public.admin_comment_directory_svc(uuid, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.admin_score_directory_svc(uuid, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.admin_category_directory_svc(uuid) from public, anon, authenticated;
revoke all on function public.admin_moderation_log_svc(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.admin_set_game_status_svc(uuid, uuid, public.game_status, text) from public, anon, authenticated;
revoke all on function public.admin_set_report_status_svc(uuid, uuid, public.report_status, text) from public, anon, authenticated;
revoke all on function public.admin_set_comment_hidden_svc(uuid, uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.admin_set_suspension_svc(uuid, uuid, boolean, text) from public, anon, authenticated;

grant execute on function public.admin_overview_svc(uuid) to service_role;
grant execute on function public.admin_analytics_svc(uuid, integer) to service_role;
grant execute on function public.admin_game_directory_svc(uuid, text, text, integer, integer) to service_role;
grant execute on function public.admin_user_directory_svc(uuid, text, text, integer, integer) to service_role;
grant execute on function public.admin_report_directory_svc(uuid, text, integer, integer) to service_role;
grant execute on function public.admin_comment_directory_svc(uuid, text, text, integer, integer) to service_role;
grant execute on function public.admin_score_directory_svc(uuid, text, text, integer, integer) to service_role;
grant execute on function public.admin_category_directory_svc(uuid) to service_role;
grant execute on function public.admin_moderation_log_svc(uuid, integer, integer) to service_role;
grant execute on function public.admin_set_game_status_svc(uuid, uuid, public.game_status, text) to service_role;
grant execute on function public.admin_set_report_status_svc(uuid, uuid, public.report_status, text) to service_role;
grant execute on function public.admin_set_comment_hidden_svc(uuid, uuid, boolean, text) to service_role;
grant execute on function public.admin_set_suspension_svc(uuid, uuid, boolean, text) to service_role;

-- `admin_actor()` stays executable by every caller, like `current_role()` and
-- its siblings: the `security invoker` report trigger calls it with the
-- caller's own rights, and revoking it would break every moderator write.
-- It reveals nothing — the flag has no setter any of these roles can reach,
-- so it always answers NULL for them.
revoke all on function public.admin_actor() from public;
grant execute on function public.admin_actor() to anon, authenticated, service_role;

-- Verification (throwaway database only; see scripts/test-rls.sh):
--   select has_function_privilege('anon', 'public.admin_overview_svc(uuid)', 'execute');          -- false
--   select has_function_privilege('authenticated', 'public.admin_overview_svc(uuid)', 'execute'); -- false
--   select has_function_privilege('service_role', 'public.admin_overview_svc(uuid)', 'execute');  -- true
