-- Rebrand: the two pieces of text the database still exposes under the old name.
--
-- The application was renamed to Unbored. Nothing here changes a
-- table, column, type, policy or row: the schema and every stored identifier stay
-- exactly as they are, so existing accounts, play sessions, scores and
-- leaderboards keep working. Only text moves:
--
--   * the `games.is_official` column comment, and
--   * the first-party actor label in `admin_overview()`'s activity feed.
--
-- Migrations are append-only, so the earlier files that introduced these strings
-- are not edited. `admin_overview()` is restated in full because a plpgsql body
-- cannot be patched in place; the body below is the 20261013130000 definition
-- with one literal changed, and `create or replace` preserves its owner, grants
-- and security settings.

comment on column public.games.is_official is
  'First-party Unbored content. Immutable through the Data API; only the service role may set it.';

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
             coalesce(p.username, 'Unbored') as "actor",
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
