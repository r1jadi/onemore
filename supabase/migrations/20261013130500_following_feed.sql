-- 0012 — following feed: published creator games for the accounts one follows.
--
-- APPLY ORDER: after 20261013130400_follow_notifications.sql. Manual application
-- only (Supabase SQL Editor). DO NOT PUSH via CLI.
--
-- Why an RPC function and not a client-side IN list:
--   * A followee list of any real size does not fit in a URL (`owner_id=in.(…)`
--     grows 37 chars per follow and breaks past ~200 follows), and chunked
--     client-side merges cannot keep a stable keyset cursor.
--   * The join belongs in the database: one round trip, one query plan, stable
--     `(published_at desc, id desc)` ordering identical to the catalogue cursor.
--
-- Security properties (all load-bearing, all tested in tests/security/rls_test.sql):
--   * `security invoker`: the function runs with the caller's rights, so RLS
--     still decides every row. Published games are public; drafts are invisible.
--   * The follower id is supplied by the Go handler from the verified JWT, never
--     from a query parameter the browser controls. Calling this function directly
--     with another user's id reveals nothing private: follows are public and the
--     output is published games only.
--   * Official first-party games (`is_official`, ownerless) are excluded by the
--     `not g.is_official` predicate: the Following feed is creator games, and
--     official content stays in For You / Explore.
--   * Search uses `strpos` (substring), not LIKE, so `%`/`_` in a term cannot
--     widen the match.
--
-- Rollback (manual, only if undepended):
--   drop function if exists public.following_feed(uuid, int, timestamptz, uuid, text);
--   drop index if exists public.games_following_idx;

-- Covering index for the feed's access path: one owner's published games in
-- catalogue order. Partial so drafts never enter it.
create index if not exists games_following_idx
  on public.games (owner_id, published_at desc nulls last, id desc)
  where status = 'published' and not is_official;

create or replace function public.following_feed(
  p_follower uuid,
  p_limit integer default 20,
  p_after_published_at timestamptz default null,
  p_after_id uuid default null,
  p_search text default null
)
returns table (
  id uuid,
  slug extensions.citext,
  title text,
  tagline text,
  description text,
  instructions text,
  cover_path text,
  runtime text,
  playable boolean,
  is_official boolean,
  published_at timestamptz,
  updated_at timestamptz,
  category_slug extensions.citext,
  category_name text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    g.id, g.slug, g.title, g.tagline, g.description, g.instructions,
    g.cover_path, g.runtime, g.playable, g.is_official,
    g.published_at, g.updated_at,
    c.slug, c.name
  from public.games g
  left join public.categories c on c.id = g.category_id
  where g.status = 'published'
    and not g.is_official
    and g.owner_id in (
      select f.followee_id from public.follows f where f.follower_id = p_follower
    )
    and (
      p_after_published_at is null or p_after_id is null
      or g.published_at < p_after_published_at
      or (g.published_at = p_after_published_at and g.id < p_after_id)
      -- A published row that somehow carries no timestamp sorts last; once a
      -- cursor exists such rows are past the end and never reappear.
    )
    and (
      p_search is null or p_search = ''
      or strpos(lower(coalesce(g.title, '') || ' ' || coalesce(g.tagline, '') || ' ' || coalesce(g.description, '')), lower(p_search)) > 0
    )
  order by g.published_at desc nulls last, g.id desc
  limit greatest(1, least(coalesce(p_limit, 20), 101));
$$;

-- The feed reads public rows only, so both roles may execute it. RLS inside
-- still filters every row; the grant confers no visibility by itself.
revoke all on function public.following_feed(uuid, integer, timestamptz, uuid, text) from anon, authenticated, public;
grant execute on function public.following_feed(uuid, integer, timestamptz, uuid, text) to anon, authenticated;

comment on function public.following_feed(uuid, integer, timestamptz, uuid, text) is
  'Published creator-owned games for the accounts p_follower follows, newest first. p_follower is filled server-side from the verified JWT.';

-- Verification (run after applying, in order):
--   select count(*) from public.following_feed('00000000-0000-0000-0000-000000000000', 5);
--     → 0 rows (unknown follower follows nobody; proves empty-follow is empty, not an error).
--   insert test follows + creator games in a DEV project, then:
--     select slug from public.following_feed('<follower>', 50) order by 1;
--     → only slugs owned by followees, all status='published', none is_official.
--   As anon with a real follower id: same rows (public data, no leak either way).
--   Delete all test rows afterwards; never seed production follows or games.
