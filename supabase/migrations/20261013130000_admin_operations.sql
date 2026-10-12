-- 0007 — The admin operations surface: staff-gated reads, and the audits that
-- make a moderation action a fact rather than a claim.
--
-- Why these are functions and not grants or policies
-- --------------------------------------------------
--
-- The dashboard needs three things the Data API cannot express as a grant:
--
--   1. **Restricted columns.** `profiles.is_suspended` and `comments.is_hidden`
--      have no `UPDATE` grant for `authenticated`, and `profiles` exposes only
--      public columns, because Postgres column grants are *additive*: a column
--      granted "for staff" is granted to everyone who holds the role
--      (docs/decisions/0007-database-authorization-model.md). A
--      `security definer` function that checks the caller's role itself is the
--      only place a staff-only read or write of such a column can live.
--
--   2. **Aggregates and joins.** A moderation queue needs counts per status, a
--      game row joined to its owner's username and its real play count, and a
--      report joined to its target's text. PostgREST cannot GROUP BY, and it
--      cannot embed `profiles` from `comments`/`reports` because those foreign
--      keys point at `auth.users`, not at `public.profiles`. One function is one
--      round trip and one query plan instead of N queries and an N+1 join in Go.
--
--   3. **Atomicity.** Hiding a comment and recording *who* hid it must land
--      together or not at all. A policy cannot write two tables.
--
-- The two invariants every function here holds to
-- ----------------------------------------------
--
--   * **The caller is never a parameter.** Each function derives the caller from
--     `auth.uid()` (through `public.current_role()`) and takes only the id of the
--     object being acted on. There is no `p_moderator`, no `p_actor` and no
--     `p_role`, so a request body cannot name an actor. The one id a caller may
--     pass is the *target*, which is exactly the thing authorization is about.
--
--   * **Definer means the check is the gate.** A `security definer` function runs
--     with the owner's rights and therefore *bypasses Row Level Security*, so the
--     role check inside each function is the only thing standing between a
--     signed-in stranger and the whole platform. Every read checks
--     `public.is_staff()`, every suspension checks `public.is_admin()`, and each
--     raises `42501` — the same SQLSTATE a missing grant raises — so a refusal is
--     indistinguishable from a table that a caller was never granted.
--
-- EXECUTE is granted to `authenticated` only (never `anon`, and `public` is
-- revoked first, because Postgres grants EXECUTE to PUBLIC by default). Being
-- signed in is the *precondition* for calling these, not the authorization.
--
-- These functions are not policies and do not replace them: the tables they read
-- keep every policy they had, and the policy tests in tests/security/rls_test.sql
-- still exercise the Data API path a browser could take directly.

-- ─────────────────────────────────────────────────────────────────────────────
-- Guards
-- ─────────────────────────────────────────────────────────────────────────────

-- The message a refusal carries. It names no column and no row, so a probe
-- learns only that it is not allowed.
create or replace function public.admin_guard_staff()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_staff() then
    raise exception 'this operation requires a moderator or administrator role'
      using errcode = '42501';
  end if;
end;
$$;

create or replace function public.admin_guard_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'this operation requires an administrator role'
      using errcode = '42501';
  end if;
end;
$$;

comment on function public.admin_guard_staff() is
  'Raises 42501 unless the caller holds the moderator or administrator role. Used by the admin read and moderation functions, which run as the definer and so bypass RLS.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Reads: the dashboard's real numbers
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Every number here is a count of persisted rows. Nothing is estimated, sampled
-- or rounded up, and a value that cannot be computed is `null` rather than `0` —
-- `avgRunSeconds` is null until a run has been completed, because "no completed
-- run" is not the same answer as "an average run lasts zero seconds".

create or replace function public.admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_series jsonb;
  v_activity jsonb;
  v_top_games jsonb;
  v_avg_seconds numeric;
  v_measured bigint;
begin
  perform public.admin_guard_staff();

  -- Fourteen days, always fourteen rows: a day with no activity is present with
  -- zeros so the chart shows a real quiet day instead of a gap that reads as
  -- missing data.
  select coalesce(jsonb_agg(row_to_json(d)::jsonb order by d.day), '[]'::jsonb)
    into v_series
  from (
    select
      to_char(g, 'YYYY-MM-DD') as "day",
      (select count(*) from public.game_sessions s
        where s.completed_at is not null
          and s.completed_at >= g and s.completed_at < g + interval '1 day') as "runs",
      (select count(*) from public.scores sc
        where sc.created_at >= g and sc.created_at < g + interval '1 day') as "scores",
      (select count(*) from public.profiles p
        where p.created_at >= g and p.created_at < g + interval '1 day') as "signups",
      (select count(distinct s.user_id) from public.game_sessions s
        where s.started_at >= g and s.started_at < g + interval '1 day'
          and s.user_id is not null) as "players"
    from generate_series(
      date_trunc('day', now()) - interval '13 days',
      date_trunc('day', now()),
      interval '1 day'
    ) as g
  ) d;

  -- The activity feed is built from rows that exist: moderation decisions staff
  -- actually made, games actually published, scores actually verified. There is
  -- no "user liked a game" line here because nothing records likes yet — an
  -- invented feed is worse than a short one.
  select coalesce(jsonb_agg(row_to_json(a)::jsonb order by a."at" desc), '[]'::jsonb)
    into v_activity
  from (
    (
      select 'moderation' as "kind", ma.created_at as "at",
             coalesce(p.username, 'unknown') as "actor",
             ma.action as "action",
             ma.target_kind::text as "subjectKind",
             coalesce(ma.reason, '') as "subject",
             null::text as "href"
      from public.moderation_actions ma
      left join public.profiles p on p.id = ma.moderator_id
    )
    union all
    (
      select 'game' as "kind", g.published_at as "at",
             coalesce(p.username, 'onemore') as "actor",
             'published' as "action",
             'game' as "subjectKind",
             g.title as "subject",
             '/games/' || g.slug::text as "href"
      from public.games g
      left join public.profiles p on p.id = g.owner_id
      where g.published_at is not null
    )
    union all
    (
      select 'score' as "kind", sc.created_at as "at",
             coalesce(p.username, 'player') as "actor",
             'scored' as "action",
             'game' as "subjectKind",
             coalesce(g.title, 'a game') as "subject",
             null::text as "href"
      from public.scores sc
      join public.games g on g.id = sc.game_id
      left join public.profiles p on p.id = sc.user_id
    )
    order by "at" desc
    limit 8
  ) a
  -- The feed is a window on real decisions and real runs; it is not a projection
  -- of everything the platform has ever done, which is why it is capped here.
  where a."at" is not null;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
    into v_top_games
  from (
    select
      g.slug::text as "slug",
      g.title as "title",
      count(s.id) as "runs"
    from public.games g
    left join public.game_sessions s
      on s.game_id = g.id and s.completed_at is not null
    group by g.id, g.slug, g.title
    having count(s.id) > 0
    order by count(s.id) desc, g.title asc
    limit 5
  ) t;

  select
    round(avg(extract(epoch from (s.completed_at - s.started_at)))),
    count(*)
    into v_avg_seconds, v_measured
  from public.game_sessions s
  where s.completed_at is not null;

  return jsonb_build_object(
    'totalUsers',      (select count(*) from public.profiles),
    'activeUsers',     (select count(distinct s.user_id) from public.game_sessions s
                         where s.started_at >= now() - interval '24 hours'
                           and s.user_id is not null),
    'games',           (select count(*) from public.games),
    'publishedGames',  (select count(*) from public.games where status = 'published'),
    'playableGames',   (select count(*) from public.games where playable),
    'gamesPlayed',     (select count(*) from public.game_sessions where completed_at is not null),
    'runsOpen',        (select count(*) from public.game_sessions
                         where completed_at is null and abandoned_at is null and expires_at > now()),
    'scoresRecorded',  (select count(*) from public.scores),
    'players',         (select count(distinct user_id) from public.scores),
    'openReports',     (select count(*) from public.reports where status = 'open'),
    'pendingReview',   (select count(*) from public.games where status = 'review'),
    'reviewingReports',(select count(*) from public.reports where status = 'reviewing'),
    'comments',        (select count(*) from public.comments),
    'hiddenComments',  (select count(*) from public.comments where is_hidden),
    'newUsersToday',   (select count(*) from public.profiles where created_at >= date_trunc('day', now())),
    -- Null, not zero, when no run has been completed: an unmeasured average and a
    -- zero-second average are different statements and only one of them is true.
    'avgRunSeconds',   v_avg_seconds,
    'runsMeasured',    v_measured,
    'series',          v_series,
    'activity',        v_activity,
    'topGames',        v_top_games
  );
end;
$$;

comment on function public.admin_overview() is
  'The dashboard overview: real counts, a fourteen-day series and a feed built only from moderation decisions, published games and verified scores. Requires staff.';

create or replace function public.admin_analytics(p_days integer default 28)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days integer := greatest(7, least(coalesce(p_days, 28), 90));
  v_series jsonb;
  v_top_games jsonb;
  v_top_players jsonb;
begin
  perform public.admin_guard_staff();

  select coalesce(jsonb_agg(row_to_json(d)::jsonb order by d.day), '[]'::jsonb)
    into v_series
  from (
    select
      to_char(g, 'YYYY-MM-DD') as "day",
      (select count(*) from public.game_sessions s
        where s.completed_at is not null
          and s.completed_at >= g and s.completed_at < g + interval '1 day') as "runs",
      (select count(distinct s.user_id) from public.game_sessions s
        where s.started_at >= g and s.started_at < g + interval '1 day'
          and s.user_id is not null) as "players",
      (select count(*) from public.scores sc
        where sc.created_at >= g and sc.created_at < g + interval '1 day') as "scores",
      (select count(*) from public.profiles p
        where p.created_at >= g and p.created_at < g + interval '1 day') as "signups"
    from generate_series(
      date_trunc('day', now()) - make_interval(days => v_days - 1),
      date_trunc('day', now()),
      interval '1 day'
    ) as g
  ) d;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
    into v_top_games
  from (
    select
      g.slug::text as "slug",
      g.title as "title",
      count(s.id) as "runs",
      count(distinct s.user_id) as "players",
      max(s.verified_score) as "bestScore"
    from public.games g
    left join public.game_sessions s
      on s.game_id = g.id and s.completed_at is not null
    group by g.id, g.slug, g.title
    having count(s.id) > 0
    order by count(s.id) desc, g.title asc
    limit 10
  ) t;

  -- "Best score" and "runs" are both measured per player; the board itself is the
  -- per-game ranking the public API already serves, and this list is the
  -- platform-wide view of the same records.
  select coalesce(jsonb_agg(row_to_json(p)::jsonb), '[]'::jsonb)
    into v_top_players
  from (
    select
      pr.username::text as "username",
      max(sc.score) as "bestScore",
      count(sc.id) as "scores",
      max(sc.created_at) as "lastScoredAt"
    from public.scores sc
    join public.profiles pr on pr.id = sc.user_id
    group by pr.id, pr.username
    order by max(sc.score) desc, count(sc.id) desc
    limit 10
  ) p;

  return jsonb_build_object(
    'days',         v_days,
    'totalUsers',   (select count(*) from public.profiles),
    'newUsers',     (select count(*) from public.profiles
                      where created_at >= now() - make_interval(days => v_days)),
    'runs',         (select count(*) from public.game_sessions where completed_at is not null),
    'players',      (select count(distinct user_id) from public.scores),
    'scores',       (select count(*) from public.scores),
    'comments',     (select count(*) from public.comments),
    'avgRunSeconds',(select round(avg(extract(epoch from (s.completed_at - s.started_at))))
                      from public.game_sessions s where s.completed_at is not null),
    'series',       v_series,
    'topGames',     v_top_games,
    'topPlayers',   v_top_players
  );
end;
$$;

comment on function public.admin_analytics(integer) is
  'Real activity aggregates over the last 7 to 90 days: signups, players, completed runs, verified scores and per-game and per-player leaders. Requires staff.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Reads: the directories
-- ─────────────────────────────────────────────────────────────────────────────
--
-- These return `setof` rows so the API can page them, and every one of them
-- filters in SQL rather than in the service: a page of fifty rows cannot be
-- assembled in Go without reading the rest of the table first.

create or replace function public.admin_game_directory(
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
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_status public.game_status;
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
begin
  perform public.admin_guard_staff();

  -- An unknown status is refused rather than ignored: silently returning every
  -- game for a filter the caller mistyped would look like a correct answer.
  if p_status is not null and btrim(p_status) <> '' then
    begin
      v_status := btrim(p_status)::public.game_status;
    exception when invalid_text_representation then
      raise exception 'unknown game status' using errcode = '22023';
    end;
  end if;

  return query
  select
    g.id,
    g.slug::text,
    g.title,
    g.tagline,
    g.status,
    g.is_official,
    g.playable,
    g.runtime,
    c.slug::text,
    c.name,
    p.username::text,
    (select count(*) from public.game_sessions s
      where s.game_id = g.id and s.completed_at is not null),
    (select count(distinct s.user_id) from public.game_sessions s
      where s.game_id = g.id and s.completed_at is not null and s.user_id is not null),
    (select max(s.verified_score) from public.game_sessions s
      where s.game_id = g.id and s.completed_at is not null),
    (select count(*) from public.comments cm where cm.game_id = g.id),
    g.created_at,
    g.published_at,
    g.updated_at
  from public.games g
  left join public.categories c on c.id = g.category_id
  left join public.profiles p on p.id = g.owner_id
  where (v_status is null or g.status = v_status)
    and (v_search is null or g.title ilike '%' || v_search || '%' or g.slug::text ilike '%' || v_search || '%')
  order by g.updated_at desc, g.id desc
  limit v_limit offset v_offset;
end;
$$;

comment on function public.admin_game_directory(text, text, integer, integer) is
  'Every game, including unpublished ones, with its real completed-run count, distinct players, best verified score and comment count. Requires staff.';

create or replace function public.admin_user_directory(
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
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_role public.app_role;
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
begin
  perform public.admin_guard_staff();

  if p_role is not null and btrim(p_role) <> '' then
    begin
      v_role := btrim(p_role)::public.app_role;
    exception when invalid_text_representation then
      raise exception 'unknown role' using errcode = '22023';
    end;
  end if;

  -- The email lives in `auth.users`, which only the definer may read, and
  -- `is_suspended` is a column the API roles are deliberately not granted. This
  -- function is the whole reason an administrator can see either.
  return query
  select
    pr.id,
    pr.username::text,
    pr.display_name,
    u.email::text,
    coalesce(ur.role, 'user'::public.app_role),
    pr.is_suspended,
    pr.created_at,
    (select max(s.started_at) from public.game_sessions s where s.user_id = pr.id),
    (select count(*) from public.game_sessions s
      where s.user_id = pr.id and s.completed_at is not null),
    (select max(sc.score) from public.scores sc where sc.user_id = pr.id),
    (select count(*) from public.reports r
      where r.target_kind = 'profile' and r.target_id = pr.id)
  from public.profiles pr
  left join auth.users u on u.id = pr.id
  left join public.user_roles ur on ur.user_id = pr.id
  where (v_search is null
          or pr.username::text ilike '%' || v_search || '%'
          or pr.display_name ilike '%' || v_search || '%'
          or u.email ilike '%' || v_search || '%')
    and (v_role is null or coalesce(ur.role, 'user'::public.app_role) = v_role)
  order by pr.created_at desc, pr.id desc
  limit v_limit offset v_offset;
end;
$$;

comment on function public.admin_user_directory(text, text, integer, integer) is
  'The account directory: profile, email, role, suspension state and real activity counts. Requires staff; the suspension write is administrator-only.';

create or replace function public.admin_report_directory(
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
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_status public.report_status;
begin
  perform public.admin_guard_staff();

  if p_status is not null and btrim(p_status) <> '' then
    begin
      v_status := btrim(p_status)::public.report_status;
    exception when invalid_text_representation then
      raise exception 'unknown report status' using errcode = '22023';
    end;
  end if;

  -- A report is read together with what it points at, so a moderator can judge it
  -- without opening three other screens. The target's identity is resolved here
  -- rather than in the service, which cannot join `comments` to `profiles`.
  return query
  select
    r.id,
    r.status,
    r.target_kind,
    r.target_id,
    case r.target_kind
      when 'profile' then coalesce(tp.username::text, 'a deleted account')
      when 'game' then coalesce(tg.title, 'a deleted game')
      when 'comment' then coalesce('@' || cp.username::text, 'a deleted comment')
    end,
    case r.target_kind
      when 'profile' then coalesce(tp.display_name, '')
      when 'game' then coalesce(tg.slug::text, '')
      when 'comment' then left(coalesce(tc.body, ''), 140)
    end,
    r.reason,
    r.details,
    coalesce(rp.username::text, 'deleted account'),
    rm.username::text,
    r.created_at,
    r.resolved_at
  from public.reports r
  left join public.profiles rp on rp.id = r.reporter_id
  left join public.profiles rm on rm.id = r.resolved_by
  left join public.profiles tp on r.target_kind = 'profile' and tp.id = r.target_id
  left join public.games tg on r.target_kind = 'game' and tg.id = r.target_id
  left join public.comments tc on r.target_kind = 'comment' and tc.id = r.target_id
  left join public.profiles cp on r.target_kind = 'comment' and cp.id = tc.author_id
  where (v_status is null or r.status = v_status)
  order by
    case r.status when 'open' then 0 when 'reviewing' then 1 else 2 end,
    r.created_at desc,
    r.id desc
  limit v_limit offset v_offset;
end;
$$;

comment on function public.admin_report_directory(text, integer, integer) is
  'The moderation queue: every report with its target resolved to a username, title or excerpt. Requires staff.';

create or replace function public.admin_comment_directory(
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
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_hidden boolean;
begin
  perform public.admin_guard_staff();

  -- `p_state` is one of visible, hidden or all. A missing value means "all", so
  -- the default view of the moderation screen is the whole record, not a filter
  -- the caller did not ask for.
  if p_state is not null and btrim(p_state) <> '' then
    case btrim(p_state)
      when 'visible' then v_hidden := false;
      when 'hidden' then v_hidden := true;
      when 'all' then v_hidden := null;
      else raise exception 'unknown comment state' using errcode = '22023';
    end case;
  end if;

  return query
  select
    cm.id,
    cm.body,
    coalesce(au.username::text, 'deleted account'),
    g.slug::text,
    g.title,
    cm.is_hidden,
    cm.parent_id is not null,
    (select count(*) from public.likes l where l.target_kind = 'comment' and l.target_id = cm.id),
    (select count(*) from public.reports r where r.target_kind = 'comment' and r.target_id = cm.id),
    cm.created_at
  from public.comments cm
  join public.games g on g.id = cm.game_id
  left join public.profiles au on au.id = cm.author_id
  where (v_hidden is null or cm.is_hidden = v_hidden)
    and (v_search is null or cm.body ilike '%' || v_search || '%')
  order by cm.created_at desc, cm.id desc
  limit v_limit offset v_offset;
end;
$$;

comment on function public.admin_comment_directory(text, text, integer, integer) is
  'Every comment, hidden ones included, with its author, game, real like and report counts. Requires staff.';

create or replace function public.admin_score_directory(
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
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_slug text := nullif(btrim(coalesce(p_game_slug, '')), '');
  v_user text := nullif(btrim(coalesce(p_username, '')), '');
begin
  perform public.admin_guard_staff();

  -- Scores are read with the session they were verified against, which is the
  -- evidence that a score came from a real run: `scores` alone carries only the
  -- number, and a number without its run is what an inflated score would look
  -- like.
  return query
  select
    sc.id,
    g.slug::text,
    g.title,
    coalesce(pr.username::text, 'deleted account'),
    sc.score,
    s.started_at,
    sc.created_at
  from public.scores sc
  join public.games g on g.id = sc.game_id
  left join public.game_sessions s on s.id = sc.session_id
  left join public.profiles pr on pr.id = sc.user_id
  where (v_slug is null or g.slug::text = v_slug)
    and (v_user is null or pr.username::text ilike '%' || v_user || '%')
  order by sc.created_at desc, sc.id desc
  limit v_limit offset v_offset;
end;
$$;

comment on function public.admin_score_directory(text, text, integer, integer) is
  'Verified scores with the game, the player and the run they came from. Requires staff.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Writes: moderation decisions, each with its audit row
-- ─────────────────────────────────────────────────────────────────────────────
--
-- A decision and its audit are written in the same transaction, by the same
-- function, so "who did this and why" cannot be lost while the effect survives —
-- an outcome the API could produce by writing two tables from two requests.

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
  values (auth.uid(), 'game', p_game_id, v_action, v_reason);

  return jsonb_build_object(
    'gameId', p_game_id,
    'previousStatus', v_previous,
    'status', p_status,
    'action', v_action
  );
end;
$$;

comment on function public.admin_set_game_status(uuid, public.game_status, text) is
  'Publishes, rejects, archives or returns a game to review, and records the decision as a moderation action. Requires staff.';

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

  -- `stamp_report_resolution` sets `resolved_by` from `auth.uid()` on the way in;
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
  values (auth.uid(), v_target_kind, v_target_id, v_action, v_reason);

  return jsonb_build_object(
    'reportId', p_report_id,
    'previousStatus', v_previous,
    'status', p_status,
    'action', v_action
  );
end;
$$;

comment on function public.admin_set_report_status(uuid, public.report_status, text) is
  'Moves a report through its workflow and records the decision. The resolver is stamped from the token, never from the request. Requires staff.';

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
  values (auth.uid(), 'comment', p_comment_id, v_action, v_reason);

  return jsonb_build_object(
    'commentId', p_comment_id,
    'hidden', p_hidden,
    'action', v_action
  );
end;
$$;

comment on function public.admin_set_comment_hidden(uuid, boolean, text) is
  'Hides or restores a comment and records the decision. `is_hidden` has no UPDATE grant, so this function is the only path. Requires staff.';

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
  -- administrators out would be the last one able to undo it.
  if p_user_id = auth.uid() then
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
  values (auth.uid(), 'profile', p_user_id, v_action, v_reason);

  return jsonb_build_object(
    'userId', p_user_id,
    'username', v_username,
    'suspended', p_suspended,
    'action', v_action
  );
end;
$$;

comment on function public.admin_set_suspension(uuid, boolean, text) is
  'Suspends or restores an account and records the decision. Administrator-only, and refused for the caller''s own account.';

create or replace function public.admin_moderation_log(
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
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
begin
  perform public.admin_guard_staff();

  return query
  select
    ma.id,
    coalesce(p.username::text, 'deleted account'),
    ma.target_kind,
    ma.target_id,
    ma.action,
    ma.reason,
    ma.created_at
  from public.moderation_actions ma
  left join public.profiles p on p.id = ma.moderator_id
  order by ma.created_at desc, ma.id desc
  limit v_limit offset v_offset;
end;
$$;

comment on function public.admin_moderation_log(integer, integer) is
  'The audit trail of moderation decisions, newest first. Requires staff.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Privileges
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Function EXECUTE is granted to PUBLIC by default, so every function above is
-- closed first and then opened to `authenticated` alone. `anon` is never granted:
-- an anonymous caller has no role to check, and the guard would refuse anyway —
-- this makes the refusal a grant error, before the function has run at all.

revoke all on function public.admin_guard_staff() from public, anon;
revoke all on function public.admin_guard_admin() from public, anon;
revoke all on function public.admin_overview() from public, anon;
revoke all on function public.admin_analytics(integer) from public, anon;
revoke all on function public.admin_game_directory(text, text, integer, integer) from public, anon;
revoke all on function public.admin_user_directory(text, text, integer, integer) from public, anon;
revoke all on function public.admin_report_directory(text, integer, integer) from public, anon;
revoke all on function public.admin_comment_directory(text, text, integer, integer) from public, anon;
revoke all on function public.admin_score_directory(text, text, integer, integer) from public, anon;
revoke all on function public.admin_moderation_log(integer, integer) from public, anon;
revoke all on function public.admin_set_game_status(uuid, public.game_status, text) from public, anon;
revoke all on function public.admin_set_report_status(uuid, public.report_status, text) from public, anon;
revoke all on function public.admin_set_comment_hidden(uuid, boolean, text) from public, anon;
revoke all on function public.admin_set_suspension(uuid, boolean, text) from public, anon;

grant execute on function public.admin_guard_staff() to authenticated;
grant execute on function public.admin_guard_admin() to authenticated;
grant execute on function public.admin_overview() to authenticated;
grant execute on function public.admin_analytics(integer) to authenticated;
grant execute on function public.admin_game_directory(text, text, integer, integer) to authenticated;
grant execute on function public.admin_user_directory(text, text, integer, integer) to authenticated;
grant execute on function public.admin_report_directory(text, integer, integer) to authenticated;
grant execute on function public.admin_comment_directory(text, text, integer, integer) to authenticated;
grant execute on function public.admin_score_directory(text, text, integer, integer) to authenticated;
grant execute on function public.admin_moderation_log(integer, integer) to authenticated;
grant execute on function public.admin_set_game_status(uuid, public.game_status, text) to authenticated;
grant execute on function public.admin_set_report_status(uuid, public.report_status, text) to authenticated;
grant execute on function public.admin_set_comment_hidden(uuid, boolean, text) to authenticated;
grant execute on function public.admin_set_suspension(uuid, boolean, text) to authenticated;
