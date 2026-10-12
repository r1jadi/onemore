-- 0005 — Play sessions, and server-verified Stack 10 scores.
--
-- What this migration changes, and why each piece is here:
--
--   1. A session becomes a *server-issued* run. `public.start_game_session`
--      creates the row, chooses the seed and fixes the rules version; the client
--      never inserts one. The `authenticated` insert grant and its policy are
--      revoked because a client-writable session row would let a client pick its
--      own deck, and every "verified" score would then be verified against a deck
--      the player chose.
--
--   2. A score becomes the database's own arithmetic. `public.complete_stack10_run`
--      replays the submitted actions from the session's seed, rejects a sequence
--      the rules cannot produce, derives the score itself, and only then closes
--      the session and records the score. The client's claimed score is compared,
--      never trusted. This is why the verification lives in SQL at all: the
--      alternative is a Go service holding the service_role key, a credential
--      that bypasses every policy in the project, to write a number a client
--      sent it. Here nothing holds a master key, the rules and the ledger share
--      one boundary, and a direct Data API call with the public key is verified
--      exactly as the API's call is. The 30-line replay is verified twice: by
--      tests/security/rls_test.sql and by the client's own engine.
--
--   3. Identity is the token's. Both write functions read `auth.uid()`, so a
--      caller cannot name a user, and a session opened anonymously stays
--      unranked: `scores.user_id` is NOT NULL, so a guest run closes with a
--      verified score on the session and no score row. A guest run can never be
--      completed by a signed-in caller to become a ranked score.
--
--   4. Public reads stay aggregate-only. `public.game_stats` exposes counts, not
--      rows, and a play is a *completed* session — the database counts it, and
--      nothing else may claim a play happened.
--
-- The rules themselves are documented in docs/games/README.md. Bumping them
-- means a new rules version and a new verifier function; this one keeps
-- verifying the runs whose sessions pinned it.

-- ─────────────────────────────────────────────────────────────────────────────
-- The rules, as constants the database owns
-- ─────────────────────────────────────────────────────────────────────────────

-- The version string a session pins. A run is always verified with the rules its
-- session was started under, so a rules change cannot retroactively accept or
-- reject a run that was played under the old ones.
create or replace function public.stack10_rules_version()
returns text language sql immutable set search_path = '' as $$ select 'stack-10@1'::text $$;

-- Four columns, and a run is 60 tiles: the board is bounded, so a run always
-- ends and two players' scores measure the same thing.
create or replace function public.stack10_columns()
returns integer language sql immutable set search_path = '' as $$ select 4 $$;

create or replace function public.stack10_tiles()
returns integer language sql immutable set search_path = '' as $$ select 60 $$;

comment on function public.stack10_rules_version() is
  'The Stack 10 rules version the database can verify. A rules change needs a new version and a new verifier.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Sessions: server-issued, with the state a replay needs
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.game_sessions
  add column if not exists rules_version  text,
  add column if not exists expires_at     timestamptz,
  add column if not exists verified_score bigint,
  add column if not exists verified_digest text;

-- Existing rows predate expiry; give them the same window a new session gets.
update public.game_sessions set expires_at = started_at + interval '2 hours' where expires_at is null;

alter table public.game_sessions alter column expires_at set default (now() + interval '2 hours');
alter table public.game_sessions alter column expires_at set not null;

alter table public.game_sessions drop constraint if exists game_sessions_rules_version_format;
alter table public.game_sessions add constraint game_sessions_rules_version_format
  check (rules_version is null or rules_version ~ '^[a-z0-9-]{2,32}@[0-9]{1,4}$');

alter table public.game_sessions drop constraint if exists game_sessions_expiry_after_start;
alter table public.game_sessions add constraint game_sessions_expiry_after_start
  check (expires_at > started_at);

alter table public.game_sessions drop constraint if exists game_sessions_verified_score_range;
alter table public.game_sessions add constraint game_sessions_verified_score_range
  check (verified_score is null or verified_score >= 0);

-- The digest is a retry fingerprint, not a signature: it holds no secret and is
-- never the whole reason a score is accepted. md5 is enough for that and needs no
-- extension, which matters in a function that runs with an empty search path.
alter table public.game_sessions drop constraint if exists game_sessions_verified_digest_format;
alter table public.game_sessions add constraint game_sessions_verified_digest_format
  check (verified_digest is null or verified_digest ~ '^[0-9a-f]{32}$');

-- A closed session always carries what closed it: the verified score and the
-- fingerprint of the run that produced it. Both, or neither.
alter table public.game_sessions drop constraint if exists game_sessions_completion_is_complete;
alter table public.game_sessions add constraint game_sessions_completion_is_complete
  check ((completed_at is null) = (verified_score is null)
     and (completed_at is null) = (verified_digest is null));

comment on column public.game_sessions.rules_version is
  'The game rules the run is played and verified under, pinned when the session is issued.';
comment on column public.game_sessions.verified_score is
  'The score the database derived by replaying the submitted actions. Null until the session closes.';
comment on column public.game_sessions.verified_digest is
  'Fingerprint of the verified submission, so a retry of the same run is recognised as the same run.';
comment on column public.game_sessions.expires_at is
  'When the run stops being completable. An abandoned tab must not leave an open run forever.';

-- Finding the caller's open runs for one game is what starting a session does
-- first, and it is the only query that filters on an open session.
create index if not exists game_sessions_open_idx
  on public.game_sessions (game_id, user_id)
  where completed_at is null and abandoned_at is null;

-- Windowed boards ("today", "this week") read scores newest-first per game.
create index if not exists scores_game_recent_idx
  on public.scores (game_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- Sessions are issued by the server, never by a client
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `start_game_session` is the only way a session comes into existence, and it
-- ignores anything a caller might send about its own identity or seed. Allowing
-- a direct insert as well would leave a client able to write `seed` itself —
-- harmless-looking, and fatal: the verifier replays whatever seed the row holds,
-- so a chosen seed is a chosen deck, and every score would be legitimate for a
-- game the player stacked.

revoke insert on public.game_sessions from authenticated;
drop policy if exists game_sessions_insert_own on public.game_sessions;

-- Reading your own sessions is unchanged: `game_sessions_select_own` and the
-- select grant stay exactly as they were.

-- ─────────────────────────────────────────────────────────────────────────────
-- Start a run
-- ─────────────────────────────────────────────────────────────────────────────

create type public.session_start as (
  outcome       text,
  id            uuid,
  game_slug     text,
  rules_version text,
  seed          bigint,
  tile_count    integer,
  started_at    timestamptz,
  expires_at    timestamptz,
  -- Ranked is the database's own answer to "can this run ever hold a score?"
  -- (it is answered by the caller's token at insert time), not something a
  -- service re-derives from the request it received.
  ranked        boolean
);

comment on type public.session_start is
  'The result of asking for a session. `outcome` is `started`, `not_playable` or `unsupported_runtime`.';

create or replace function public.start_game_session(
  p_game_slug     text,
  p_rules_version text,
  p_client        text
)
returns public.session_start
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_empty   public.session_start;
  v_game    public.games;
  v_user    uuid := auth.uid();
  v_client  text := nullif(btrim(coalesce(p_client, '')), '');
  v_session public.game_sessions;
begin
  if p_game_slug is null or p_game_slug !~ '^[a-z0-9-]{2,48}$' then
    raise exception 'invalid game slug' using errcode = '22023';
  end if;
  if p_rules_version is null or p_rules_version !~ '^[a-z0-9-]{2,32}@[0-9]{1,4}$' then
    raise exception 'invalid rules version' using errcode = '22023';
  end if;
  if v_client is not null and char_length(v_client) > 40 then
    raise exception 'client is longer than 40 characters' using errcode = '22023';
  end if;

  -- Only published, playable, first-party-or-not games can be started. A draft
  -- and a published-but-unplayable game answer the same way, so the difference
  -- between them is not something a stranger can probe.
  select * into v_game
    from public.games g
   where g.slug = p_game_slug
     and g.status = 'published'
     and g.playable
     and g.runtime is not null;

  if not found then
    v_empty.outcome := 'not_playable';
    return v_empty;
  end if;

  if v_game.runtime <> 'stack-10' or p_rules_version <> public.stack10_rules_version() then
    v_empty.outcome := 'unsupported_runtime';
    return v_empty;
  end if;

  -- One open run per signed-in player per game. Starting again replaces the
  -- previous one rather than leaving a row that can still be completed later.
  -- Anonymous runs are not replaced: two visitors are not the same person, and
  -- guessing that they are would cancel a stranger's run.
  if v_user is not null then
    update public.game_sessions s
       set abandoned_at = now()
     where s.game_id = v_game.id
       and s.user_id = v_user
       and s.completed_at is null
       and s.abandoned_at is null;
  end if;

  insert into public.game_sessions (game_id, user_id, client, rules_version)
  values (v_game.id, v_user, v_client, p_rules_version)
  returning * into v_session;

  v_empty.outcome       := 'started';
  v_empty.id            := v_session.id;
  v_empty.game_slug     := v_game.slug;
  v_empty.rules_version := v_session.rules_version;
  v_empty.seed          := v_session.seed;
  v_empty.tile_count    := public.stack10_tiles();
  v_empty.started_at    := v_session.started_at;
  v_empty.expires_at    := v_session.expires_at;
  v_empty.ranked        := v_session.user_id is not null;
  return v_empty;
end;
$$;

comment on function public.start_game_session(text, text, text) is
  'Issues a play session with a server-chosen seed. The caller identity is the verified token, never an argument.';

revoke all on function public.start_game_session(text, text, text) from public;
grant execute on function public.start_game_session(text, text, text) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Complete a run: replay, verify, then record
-- ─────────────────────────────────────────────────────────────────────────────

create type public.play_result as (
  outcome         text,
  session_id      uuid,
  game_slug       text,
  score           bigint,
  cleared_columns integer,
  tiles_placed    integer,
  duration_ms     integer,
  ranked          boolean,
  recorded_at     timestamptz,
  personal_best   bigint,
  board_rank      bigint
);

comment on type public.play_result is
  'The outcome of completing a run. `outcome` is `recorded`, `duplicate`, `expired`, `abandoned`, `closed`, '
  '`anonymous_session`, `wrong_rules`, `invalid_actions`, `invalid_duration` or `score_mismatch`; '
  '`not_found` covers a session that is missing or belongs to somebody else.';

create or replace function public.complete_stack10_run(
  p_session_id  uuid,
  p_actions     integer[],
  p_score       bigint,
  p_duration_ms integer
)
returns public.play_result
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result   public.play_result;
  v_session  public.game_sessions;
  v_game     public.games;
  v_user     uuid := auth.uid();
  v_state    bigint;
  v_tile     int;
  v_column   int;
  v_index    int;
  v_placed   int := 0;
  v_score    bigint := 0;
  v_cleared  int := 0;
  v_over     boolean := false;
  v_sums     integer[] := array[0, 0, 0, 0];
  v_stacks   integer[] := array[0, 0, 0, 0];
  v_digest   text;
  v_elapsed  bigint;
  v_best     bigint;
  v_rank     bigint;
begin
  if p_session_id is null then
    raise exception 'a session id is required' using errcode = '22023';
  end if;
  if p_actions is null or array_position(p_actions, null) is not null then
    raise exception 'actions must be a dense array of column indexes' using errcode = '22023';
  end if;
  if p_duration_ms is null or p_duration_ms < 1 then
    raise exception 'duration must be a positive number of milliseconds' using errcode = '22023';
  end if;

  -- Locked: two completions racing for one session must meet here, not both pass
  -- the "already closed" check and then both insert.
  select * into v_session from public.game_sessions s where s.id = p_session_id for update;

  -- A missing session and somebody else's session answer identically: telling
  -- them apart would let a caller enumerate other people's run ids.
  if not found
     or (v_session.user_id is not null and v_session.user_id is distinct from v_user)
     or (v_session.user_id is null and v_user is not null) then
    v_result.outcome := 'not_found';
    v_result.session_id := p_session_id;
    return v_result;
  end if;

  select * into v_game from public.games g where g.id = v_session.game_id;

  -- The fingerprint of *this* submission. A retry of the same run produces the
  -- same string; anything else does not.
  v_digest := md5(concat_ws('|',
    v_session.rules_version,
    v_session.seed::text,
    array_to_string(p_actions, ','),
    p_score::text
  ));

  if v_session.completed_at is not null then
    -- A retry must be recognised as a retry, not punished and not recorded
    -- twice: an interrupted network should be safe to repeat.
    if v_session.verified_digest = v_digest then
      v_result.outcome       := 'duplicate';
      v_result.session_id    := v_session.id;
      v_result.game_slug     := v_game.slug;
      v_result.score         := v_session.verified_score;
      v_result.duration_ms   := p_duration_ms;
      v_result.ranked        := v_session.user_id is not null;
      v_result.recorded_at   := v_session.completed_at;
      if v_session.user_id is not null then
        select max(s.score) into v_best from public.scores s
         where s.game_id = v_session.game_id and s.user_id = v_session.user_id;
        select count(*) + 1 into v_rank from (
          select s.user_id, max(s.score) as best
            from public.scores s
           where s.game_id = v_session.game_id and s.user_id is not null
           group by s.user_id
        ) t where t.best > coalesce(v_best, 0) and t.user_id <> v_session.user_id;
        v_result.personal_best := v_best;
        v_result.board_rank    := v_rank;
      end if;
      return v_result;
    end if;

    -- Same session, different run: refuse rather than replace. The first result
    -- is the one that was verified.
    v_result.outcome := 'closed';
    v_result.session_id := v_session.id;
    v_result.game_slug := v_game.slug;
    v_result.score := v_session.verified_score;
    return v_result;
  end if;

  if v_session.abandoned_at is not null then
    v_result.outcome := 'abandoned';
    v_result.session_id := v_session.id;
    v_result.game_slug := v_game.slug;
    return v_result;
  end if;

  if now() >= v_session.expires_at then
    v_result.outcome := 'expired';
    v_result.session_id := v_session.id;
    v_result.game_slug := v_game.slug;
    return v_result;
  end if;

  -- The session pins the rules it was issued under; this verifier implements one
  -- version, and says so rather than guessing at the other.
  if v_session.rules_version is distinct from public.stack10_rules_version() then
    v_result.outcome := 'wrong_rules';
    v_result.session_id := v_session.id;
    v_result.game_slug := v_game.slug;
    return v_result;
  end if;

  if array_length(p_actions, 1) > public.stack10_tiles() then
    v_result.outcome := 'invalid_actions';
    v_result.session_id := v_session.id;
    v_result.game_slug := v_game.slug;
    return v_result;
  end if;

  -- A claimed duration longer than the session has existed is impossible: the
  -- run cannot have taken longer than the time since it started. Two seconds of
  -- slack covers the round trip and a client clock that is slightly ahead.
  v_elapsed := (extract(epoch from (now() - v_session.started_at)) * 1000)::bigint;
  if p_duration_ms > v_elapsed + 2000 then
    v_result.outcome := 'invalid_duration';
    v_result.session_id := v_session.id;
    v_result.game_slug := v_game.slug;
    return v_result;
  end if;

  -- ── The replay ───────────────────────────────────────────────────────────
  -- The tile sequence is a function of the seed alone: a 32-bit LCG, defined
  -- once here and mirrored by the client's engine (apps/web, seeds and vectors
  -- in docs/games/README.md). Tiles are 1..9. A drop raises its column's sum; a
  -- sum of exactly ten clears the column and scores; a sum above ten ends the
  -- run. Actions after the run ended, or a column that does not exist, make the
  -- submission impossible rather than merely bad.
  v_state := (v_session.seed % 4294967296 + 4294967296) % 4294967296;
  if v_state = 0 then
    v_state := 2654435769; -- 0x9E3779B9: a zero state would make the sequence degenerate
  end if;

  foreach v_column in array coalesce(p_actions, array[]::integer[]) loop
    if v_over or v_placed >= public.stack10_tiles() then
      v_result.outcome := 'invalid_actions';
      v_result.session_id := v_session.id;
      v_result.game_slug := v_game.slug;
      return v_result;
    end if;

    if v_column < 0 or v_column >= public.stack10_columns() then
      v_result.outcome := 'invalid_actions';
      v_result.session_id := v_session.id;
      v_result.game_slug := v_game.slug;
      return v_result;
    end if;

    v_state := (v_state * 1664525 + 1013904223) % 4294967296;
    v_tile := (v_state % 9)::int + 1;

    v_index := v_column + 1; -- Postgres arrays are 1-based; the API's indexes are 0-based
    v_stacks[v_index] := v_stacks[v_index] + 1;
    v_sums[v_index] := v_sums[v_index] + v_tile;
    v_placed := v_placed + 1;

    if v_sums[v_index] = 10 then
      -- Stacking more tiles into a column before it clears is the riskier play —
      -- fewer free columns, less room for the next tile — so it is what scores.
      v_score := v_score + 10 + 5 * (v_stacks[v_index] - 1);
      v_cleared := v_cleared + 1;
      v_sums[v_index] := 0;
      v_stacks[v_index] := 0;
    elsif v_sums[v_index] > 10 then
      v_over := true;
    end if;
  end loop;

  -- The run has to be submitted in the state it ended in: a submission that
  -- stops early is a partial run, and scoring it would let a player discard the
  -- move that ended theirs.
  if not v_over and v_placed < public.stack10_tiles() then
    v_result.outcome := 'invalid_actions';
    v_result.session_id := v_session.id;
    v_result.game_slug := v_game.slug;
    return v_result;
  end if;

  -- The client's number is a claim. The database's replay is the score.
  if p_score is distinct from v_score then
    v_result.outcome := 'score_mismatch';
    v_result.session_id := v_session.id;
    v_result.game_slug := v_game.slug;
    v_result.score := v_score;
    return v_result;
  end if;

  update public.game_sessions s
     set completed_at    = now(),
         verified_score  = v_score,
         verified_digest = v_digest
   where s.id = v_session.id
  returning * into v_session;

  -- Only a signed-in run becomes a ranked score. A guest run is verified and
  -- closed, and its score exists on the session alone: `scores.user_id` is NOT
  -- NULL precisely so an anonymous run cannot become somebody's personal best.
  if v_session.user_id is not null then
    insert into public.scores (session_id, game_id, user_id, score, duration_ms)
    values (v_session.id, v_session.game_id, v_session.user_id, v_score, p_duration_ms);
  end if;

  v_result.outcome         := 'recorded';
  v_result.session_id      := v_session.id;
  v_result.game_slug       := v_game.slug;
  v_result.score           := v_score;
  v_result.cleared_columns := v_cleared;
  v_result.tiles_placed    := v_placed;
  v_result.duration_ms     := p_duration_ms;
  v_result.ranked          := v_session.user_id is not null;
  v_result.recorded_at     := v_session.completed_at;

  if v_session.user_id is not null then
    select max(s.score) into v_best from public.scores s
     where s.game_id = v_session.game_id and s.user_id = v_session.user_id;
    select count(*) + 1 into v_rank from (
      select s.user_id, max(s.score) as best
        from public.scores s
       where s.game_id = v_session.game_id and s.user_id is not null
       group by s.user_id
    ) t where t.best > coalesce(v_best, 0) and t.user_id <> v_session.user_id;
    v_result.personal_best := v_best;
    v_result.board_rank    := v_rank;
  end if;

  return v_result;
end;
$$;

comment on function public.complete_stack10_run(uuid, integer[], bigint, integer) is
  'Replays a submitted Stack 10 run from its session seed, derives the score, and records it. The claim is compared, never trusted.';

revoke all on function public.complete_stack10_run(uuid, integer[], bigint, integer) from public;
grant execute on function public.complete_stack10_run(uuid, integer[], bigint, integer) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Public reads: aggregate activity, and the ranking it produces
-- ─────────────────────────────────────────────────────────────────────────────

-- Plays are counted, not claimed: one play is one *completed* session. An opened
-- tab that never finished is not a play, a guest's finished run is, and a retry
-- of a completion cannot add a second one — the session closes once.
--
-- The view is deliberately definer-owned: `game_sessions` is readable only by its
-- owner, and this is the one shape of that table the public may see — counts. A
-- `security_invoker` view would instead force every count to zero for a visitor
-- RLS does not let read the rows, which is the same as reporting no plays.
create or replace view public.game_stats
with (security_invoker = false) as
select
  g.id as game_id,
  g.slug,
  coalesce(plays.completed, 0)::bigint as plays,
  coalesce(plays.players, 0)::bigint as players,
  best.best_score,
  plays.last_completed_at
from public.games g
left join (
  select
    s.game_id,
    count(*) as completed,
    count(distinct s.user_id) as players,
    max(s.completed_at) as last_completed_at
  from public.game_sessions s
  where s.completed_at is not null
  group by s.game_id
) plays on plays.game_id = g.id
left join (
  select sc.game_id, max(sc.score) as best_score
  from public.scores sc
  group by sc.game_id
) best on best.game_id = g.id
where g.status = 'published';

comment on view public.game_stats is
  'Public aggregate activity per published game: completed runs, distinct players, best score. Counts only — never rows.';

revoke all on public.game_stats from public, anon, authenticated;
-- `game_id` is not granted: the uuid is internal, and a caller addresses a game
-- by its slug everywhere else in the API.
grant select (slug, plays, players, best_score, last_completed_at) on public.game_stats to anon, authenticated;

-- A ranking is public information, and it is derived entirely from recorded
-- scores. `security_invoker` keeps Row Level Security in charge: the caller can
-- only ever see scores for a game they could read, plus the public profile rows
-- that name them.
create or replace function public.game_leaderboard(
  p_game_slug text,
  p_since     timestamptz,
  p_limit     integer,
  p_offset    integer
)
returns table (
  rank        bigint,
  user_id     uuid,
  username    text,
  score       bigint,
  achieved_at timestamptz,
  plays       bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with selected_game as (
    select g.id from public.games g
     where g.slug = p_game_slug and g.status = 'published'
  ),
  windowed as (
    select s.user_id, s.score, s.created_at
      from public.scores s
      join selected_game sg on sg.id = s.game_id
     where p_since is null or s.created_at >= p_since
  ),
  best as (
    -- One row per player: their best score, and the first time they reached it.
    select distinct on (w.user_id) w.user_id, w.score, w.created_at as achieved_at
      from windowed w
     order by w.user_id, w.score desc, w.created_at asc
  ),
  played as (
    select w.user_id, count(*) as plays from windowed w group by w.user_id
  )
  select
    -- Ties share a rank, which is what "1st equal" should mean on a board.
    rank() over (order by b.score desc),
    b.user_id,
    p.username,
    b.score,
    b.achieved_at,
    played.plays
  from best b
  left join public.profiles p on p.id = b.user_id
  left join played on played.user_id = b.user_id
  order by b.score desc, b.achieved_at asc
  limit greatest(1, least(coalesce(p_limit, 25), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;

comment on function public.game_leaderboard(text, timestamptz, integer, integer) is
  'The public ranking for one published game: best score per player, newest-first tie-break, real play counts.';

revoke all on function public.game_leaderboard(text, timestamptz, integer, integer) from public;
grant execute on function public.game_leaderboard(text, timestamptz, integer, integer) to anon, authenticated;

-- One player's standing on one board, so the UI can show "your best" and "your
-- rank" without fetching and searching the whole ranking.
create or replace function public.game_standing(
  p_game_slug text,
  p_user_id   uuid,
  p_since     timestamptz
)
returns table (
  rank        bigint,
  score       bigint,
  achieved_at timestamptz,
  plays       bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with selected_game as (
    select g.id from public.games g
     where g.slug = p_game_slug and g.status = 'published'
  ),
  windowed as (
    select s.user_id, s.score, s.created_at
      from public.scores s
      join selected_game sg on sg.id = s.game_id
     where p_since is null or s.created_at >= p_since
  ),
  best as (
    select distinct on (w.user_id) w.user_id, w.score, w.created_at as achieved_at
      from windowed w
     order by w.user_id, w.score desc, w.created_at asc
  ),
  ranked as (
    select rank() over (order by b.score desc) as rank, b.user_id, b.score, b.achieved_at
      from best b
  ),
  played as (
    select w.user_id, count(*) as plays from windowed w group by w.user_id
  )
  select r.rank, r.score, r.achieved_at, played.plays
    from ranked r
    join played on played.user_id = r.user_id
   where r.user_id = p_user_id;
$$;

comment on function public.game_standing(text, uuid, timestamptz) is
  'One player''s rank, best score and play count on one published game''s board.';

revoke all on function public.game_standing(text, uuid, timestamptz) from public;
grant execute on function public.game_standing(text, uuid, timestamptz) to anon, authenticated;
