-- Endless Don't Touch the Black — a conveyor with no final row.
--
-- `20261023120000_dont_touch_sessions.sql` shipped the game as a fixed twenty-row
-- deck: sixty cells, 25% of them black, and a run that simply stopped when the
-- last row passed. This migration makes the conveyor endless and deliberately
-- keeps the old rules verifiable:
--
--   - **`dont-touch@2` is the new rules version.** Rows rise forever, a white
--     tile still scores ten points, and a black tile still ends the run on the
--     spot. What changed is that there is always a next row. Two curves make the
--     game harder as it goes on:
--       · **speed** — the window a row spends at the line starts at 1.6 s, falls
--         45 ms per row for twenty-one rows to 0.7 s, then eases toward 0.65 s
--         without ever reaching it, so the beat never becomes static;
--       · **density** — the share of black cells starts at 25% and rises one
--         percentage point every ten rows, capped at 45%.
--   - **`dont-touch@1` keeps verifying exactly as it did.** Sessions issued
--     before this migration may still be completed: the same flat 25% colour,
--     the same sixty cells, the same scoring, and a partial deck still accepted.
--     Only the session's version string chooses the rules.
--   - **A run can be stopped.** An endless game has no natural last row, so the
--     client offers an explicit end. A @2 submission is allowed to stop on any
--     white; the score is what was cleared, so stopping cannot inflate it. The
--     black-ending tap is still part of the submission and is still replayed.
--   - **The submission bound is not a level.** A run may address at most 4095
--     cells (the cells it could ever name) and carry at most that many taps,
--     because a cell can be tapped once. At the 0.65 s floor that is well over a
--     quarter of an hour of perfect play: a transport and replay bound, not a
--     final stage.
--
-- The generator, the seed handling, the ten-point tile, the ledger and the score
-- table are untouched. See docs/games/README.md for the rules and pinned vectors.

-- ─────────────────────────────────────────────────────────────────────────────
-- The rules, as constants the database owns
-- ─────────────────────────────────────────────────────────────────────────────

-- The version a new session pins. `dont-touch@1` remains a literal in the
-- verifier: the old rules are history, not a constant that moves.
create or replace function public.dont_touch_rules_version()
returns text language sql immutable set search_path = '' as $$ select 'dont-touch@2'::text $$;

-- Three lanes, unchanged, and shared by both versions.
create or replace function public.dont_touch_lanes()
returns integer language sql immutable set search_path = '' as $$ select 3 $$;

-- `dont-touch@1`'s twenty rows and sixty cells are no longer how a new run is
-- measured, but the legacy branch still needs them. They are kept, and named for
-- what they are.
create or replace function public.dont_touch_rows()
returns integer language sql immutable set search_path = '' as $$ select 20 $$;

create or replace function public.dont_touch_cells()
returns integer language sql immutable set search_path = '' as $$ select 60 $$;

-- The endless conveyor's addressable extent. It bounds one submission, not the
-- game: a run has no complete length, and 4095 cells is the most taps it could
-- ever carry (a cell is tapped once).
create or replace function public.dont_touch_max_rows()
returns integer language sql immutable set search_path = '' as $$ select 1365 $$;

create or replace function public.dont_touch_max_cells()
returns integer language sql immutable set search_path = '' as $$ select 4095 $$;

-- Ten points per white tile. Unchanged by both versions.
create or replace function public.dont_touch_tile_score()
returns bigint language sql immutable set search_path = '' as $$ select 10::bigint $$;

-- The share of black tiles in a row: 25% at row zero, one point more every ten
-- rows, capped at 45%. Black density is what keeps the game getting harder after
-- the row window has reached its readable floor.
create or replace function public.dont_touch_black_percent(p_row integer)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_row is null or p_row < 0 or p_row >= public.dont_touch_max_rows() then
    raise exception 'a Don''t Touch the Black row is 0 to %', public.dont_touch_max_rows() - 1
      using errcode = '22023';
  end if;
  return least(45, 25 + (p_row / 10));
end;
$$;

comment on function public.dont_touch_rules_version() is
  'The Don''t Touch the Black rules version new sessions pin. dont-touch@2 is endless; dont-touch@1 runs are still verified. A rules change needs a new version and a new verifier branch.';
comment on function public.dont_touch_rows() is
  'The legacy dont-touch@1 rules: twenty rows. dont-touch@2 has no row count.';
comment on function public.dont_touch_cells() is
  'The legacy dont-touch@1 rules: sixty cells. dont-touch@2 has no complete length; see dont_touch_max_cells().';
comment on function public.dont_touch_max_rows() is
  'The rows a dont-touch@2 run can address. A replay bound, not a final row.';
comment on function public.dont_touch_max_cells() is
  'The cells a dont-touch@2 run can address, and the most taps one submission may carry. A request bound for the endless game, not a final row.';
comment on function public.dont_touch_black_percent(integer) is
  'The share of black tiles in a dont-touch@2 row: 25% at row zero, one point per ten rows, capped at 45%.';

-- ─────────────────────────────────────────────────────────────────────────────
-- The deck, as the generator both sides draw from
-- ─────────────────────────────────────────────────────────────────────────────
--
-- A pure function of the seed and the cell: no rows, no clock, no session. It is
-- an internal, not API surface — the verifier calls it with the session's seed,
-- and no client needs it, because a client already holds its own seed and
-- computes the same colours in TypeScript.

-- The generator's state for one cell, shifted past the bits both rulesets ignore.
--
-- The generator is the same 32-bit LCG the other games use, with the same
-- zero-state fallback: a state that differs by one bit colours a different
-- conveyor, and an honest run would be refused. The shift is 16 bits rather
-- than the low bits, and deliberately so: this LCG's low bits cycle with a
-- period of two to the power of the bit width, so a colour read from them would
-- repeat a fixed pattern regardless of the seed. The higher bits have the full
-- period.
--
-- The caller bounds the cell; this function is the shared draw, so both rulesets
-- read exactly the same number for the same cell. It returns the shifted state
-- itself, not a modulus, because the legacy rules read it modulo four and the
-- endless rules read it modulo one hundred: the draw is shared, the reading is
-- part of each ruleset.
create or replace function public.dont_touch_colour(
  p_seed bigint,
  p_cell integer
)
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_state bigint;
  v_draw  int;
begin
  v_state := ((coalesce(p_seed, 0) % 4294967296) + 4294967296) % 4294967296;
  if v_state = 0 then
    -- 0x9E3779B9. A zero state would otherwise produce a constant sequence.
    v_state := 2654435769;
  end if;

  -- Cell k is drawn after k + 1 advances, so the first cell is the one the client
  -- reads first and neither copy can drift by one draw.
  for v_draw in 1..(p_cell + 1) loop
    v_state := (v_state * 1664525 + 1013904223) % 4294967296;
  end loop;

  return v_state >> 16;
end;
$$;

comment on function public.dont_touch_colour(bigint, integer) is
  'One cell''s generator state from a seed''s Don''t Touch the Black conveyor, shifted right by 16. Pure; read by the verifier only.';

revoke all on function public.dont_touch_colour(bigint, integer) from public;

-- Whether cell `p_cell` is black under the legacy dont-touch@1 rules: a flat 25%
-- of a sixty-cell deck, read as `state >> 16 mod 4 = 0`. Redefined through the
-- shared draw, so the colour of every cell is bit-for-bit the one the original
-- migration produced.
create or replace function public.dont_touch_black(
  p_seed bigint,
  p_cell integer
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_cell is null or p_cell < 0 or p_cell >= public.dont_touch_cells() then
    raise exception 'a dont-touch@1 cell is 0 to %', public.dont_touch_cells() - 1
      using errcode = '22023';
  end if;
  return public.dont_touch_colour(p_seed, p_cell) % 4 = 0;
end;
$$;

comment on function public.dont_touch_black(bigint, integer) is
  'Whether one cell of a seed''s legacy dont-touch@1 deck is black. Pure, and read by the verifier only.';

revoke all on function public.dont_touch_black(bigint, integer) from public;

-- Whether cell `p_cell` is black under the endless rules: the row's density, not
-- a flat share.
create or replace function public.dont_touch_black_endless(
  p_seed bigint,
  p_cell integer
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_cell is null or p_cell < 0 or p_cell >= public.dont_touch_max_cells() then
    raise exception 'a dont-touch@2 cell is 0 to %', public.dont_touch_max_cells() - 1
      using errcode = '22023';
  end if;
  return public.dont_touch_colour(p_seed, p_cell) % 100
         < public.dont_touch_black_percent(p_cell / public.dont_touch_lanes());
end;
$$;

comment on function public.dont_touch_black_endless(bigint, integer) is
  'Whether one cell of a seed''s endless Don''t Touch the Black conveyor is black, at that row''s density. Pure, and read by the verifier only.';

revoke all on function public.dont_touch_black_endless(bigint, integer) from public;

-- ─────────────────────────────────────────────────────────────────────────────
-- Complete a run: replay, verify, then record
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.complete_dont_touch_run(
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
  v_cell     integer;
  v_tapped   integer[] := array[]::integer[];
  v_cleared  int := 0;
  v_score    bigint := 0;
  v_over     boolean := false;
  -- The colour of the cell being replayed, read through the ruleset the session
  -- pinned.
  v_black    boolean;
  -- Which of the two rulesets this session pinned, and the cells it may address:
  -- 60 for the legacy deck, 4095 for the endless conveyor.
  v_endless  boolean := false;
  v_max      int;
  v_digest   text;
  v_elapsed  bigint;
  v_best     bigint;
  v_rank     bigint;
begin
  if p_session_id is null then
    raise exception 'a session id is required' using errcode = '22023';
  end if;
  if p_actions is null or array_position(p_actions, null) is not null then
    raise exception 'actions must be a dense array of cells' using errcode = '22023';
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

  -- The session pins the rules it was issued under. Two versions are implemented:
  -- the legacy twenty-row deck, and the endless conveyor. The version chooses the
  -- rules; a session under anything else is refused rather than guessed at.
  if v_session.rules_version = 'dont-touch@1' then
    v_max := public.dont_touch_cells();
  elsif v_session.rules_version = public.dont_touch_rules_version() then
    v_endless := true;
    v_max := public.dont_touch_max_cells();
  else
    v_result.outcome := 'wrong_rules';
    v_result.session_id := v_session.id;
    v_result.game_slug := v_game.slug;
    return v_result;
  end if;

  if coalesce(array_length(p_actions, 1), 0) > v_max then
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
  -- Every submitted cell is one touch: a white tile scores ten, a black tile
  -- ends the run. A cell outside the deck, touched twice, or touched after the
  -- black tile ended the run is impossible play — the client never records one —
  -- and the whole submission is refused rather than scored partially.
  --
  -- A run that stops on a white is legal under both versions. Whether the player
  -- saw the whole deck is a fact about the conveyor's clock, not about this
  -- array; refusing a stopped run would refuse every honest player who let a row
  -- pass, and for dont-touch@2 — which has no last row — there would be nothing
  -- else to accept.
  foreach v_cell in array coalesce(p_actions, array[]::integer[]) loop
    if v_over then
      v_result.outcome := 'invalid_actions';
      v_result.session_id := v_session.id;
      v_result.game_slug := v_game.slug;
      return v_result;
    end if;

    if v_cell < 0 or v_cell >= v_max then
      v_result.outcome := 'invalid_actions';
      v_result.session_id := v_session.id;
      v_result.game_slug := v_game.slug;
      return v_result;
    end if;

    -- A tile can be touched once. Touching a cleared tile again is not a move.
    if v_cell = any (v_tapped) then
      v_result.outcome := 'invalid_actions';
      v_result.session_id := v_session.id;
      v_result.game_slug := v_game.slug;
      return v_result;
    end if;
    v_tapped := v_tapped || v_cell;

    v_black := case when v_endless
                    then public.dont_touch_black_endless(v_session.seed, v_cell)
                    else public.dont_touch_black(v_session.seed, v_cell)
               end;

    if v_black then
      v_over := true;
    else
      v_cleared := v_cleared + 1;
      v_score := v_score + public.dont_touch_tile_score();
    end if;
  end loop;

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
  v_result.tiles_placed    := coalesce(array_length(p_actions, 1), 0);
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

comment on function public.complete_dont_touch_run(uuid, integer[], bigint, integer) is
  'Replays a submitted Don''t Touch the Black run from its session seed, derives the score, and records it. dont-touch@1 runs end at a sixty-cell deck; dont-touch@2 runs end on a black tile or when the player stops, and have no final row. The claim is compared, never trusted.';

revoke all on function public.complete_dont_touch_run(uuid, integer[], bigint, integer) from public;
grant execute on function public.complete_dont_touch_run(uuid, integer[], bigint, integer) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Start a run: the gate accepts the endless version, and its legacy
-- ─────────────────────────────────────────────────────────────────────────────

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

  -- The gate is a pair: each runtime plays the rules versions its verifier
  -- implements. Chain and Don't Touch the Black have two each — the endless
  -- version new runs pin, and the legacy finite version a session opened before
  -- the endless migrations still holds. Anything else is a version no verifier
  -- owns.
  if (v_game.runtime = 'stack-10' and p_rules_version = public.stack10_rules_version())
     or (v_game.runtime = 'chain'
         and p_rules_version in ('chain@1', public.chain_rules_version()))
     or (v_game.runtime = 'memory-flash' and p_rules_version = public.memory_flash_rules_version())
     or (v_game.runtime = 'one-move' and p_rules_version = public.one_move_rules_version())
     or (v_game.runtime = 'color-merge' and p_rules_version = public.color_merge_rules_version())
     or (v_game.runtime = 'dont-touch'
         and p_rules_version in ('dont-touch@1', public.dont_touch_rules_version()))
     or (v_game.runtime = 'seven-second' and p_rules_version = public.seven_second_rules_version()) then
    -- Allowed: issued below.
    null;
  else
    v_empty.outcome := 'unsupported_runtime';
    return v_empty;
  end if;

  -- A daily game gets one ranked attempt a day. The check is by seed, not by
  -- elapsed time: a run started before UTC midnight and finished after it belongs
  -- to yesterday's deck, and must not consume today's. Guests are not gated —
  -- they have no score to set — so `v_user is not null` is the whole of the rule.
  if v_game.runtime = 'seven-second' and v_user is not null then
    -- The same lock the verifier takes, so a completion cannot slip between the
    -- check below and the session insert.
    perform pg_advisory_xact_lock(
      hashtextextended(v_game.id::text || ':' || v_user::text, 0)
    );

    if exists (
      select 1
        from public.game_sessions s
       where s.game_id = v_game.id
         and s.user_id = v_user
         and s.completed_at is not null
         and s.seed = public.seven_second_seed()
    ) then
      v_empty.outcome := 'already_played';
      return v_empty;
    end if;
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

  if v_game.runtime = 'seven-second' then
    -- The daily deck is chosen by the server, from the date, not by the caller.
    insert into public.game_sessions (game_id, user_id, client, rules_version, seed)
    values (v_game.id, v_user, v_client, p_rules_version, public.seven_second_seed())
    returning * into v_session;
  else
    -- A chain@2 run is endless in principle, so its session lives for twelve
    -- hours instead of the table's two: a marathon should end when a tap breaks
    -- the chain, not when the clock does. Don't Touch the Black is bounded by its
    -- own submission ceiling — well under two hours of play — so it keeps the
    -- ordinary session. Every other game keeps two hours too.
    insert into public.game_sessions (game_id, user_id, client, rules_version, expires_at)
    values (v_game.id, v_user, v_client, p_rules_version,
            case when p_rules_version = 'chain@2' then now() + interval '12 hours'
                 else now() + interval '2 hours' end)
    returning * into v_session;
  end if;

  v_empty.outcome       := 'started';
  v_empty.id            := v_session.id;
  v_empty.game_slug     := v_game.slug;
  v_empty.rules_version := v_session.rules_version;
  v_empty.seed          := v_session.seed;
  -- The moves a session tells the client about: tiles for Stack 10, taps for
  -- Memory Flash, board taps for One Move, slides for Color Merge, rows for
  -- Don't Touch the Black, and answers for 7 Second. The endless games report
  -- their submission bound — there is no complete run to count — while a legacy
  -- session still reports its finite length.
  v_empty.tile_count    := case v_game.runtime
                             when 'chain' then
                               case when p_rules_version = 'chain@1'
                                    then public.chain_taps()
                                    else public.chain_max_actions()
                               end
                             when 'memory-flash' then public.memory_flash_taps()
                             when 'one-move' then public.one_move_taps()
                             when 'color-merge' then public.color_merge_slides()
                             when 'dont-touch' then
                               case when p_rules_version = 'dont-touch@1'
                                    then public.dont_touch_cells()
                                    else public.dont_touch_max_cells()
                               end
                             when 'seven-second' then public.seven_second_answers()
                             else public.stack10_tiles()
                           end;
  v_empty.started_at    := v_session.started_at;
  v_empty.expires_at    := v_session.expires_at;
  v_empty.ranked        := v_session.user_id is not null;
  return v_empty;
end;
$$;

comment on function public.start_game_session(text, text, text) is
  'Issues a play session with a server-chosen seed. The caller identity is the verified token, never an argument. Chain accepts chain@1 (legacy) and chain@2 (endless); Don''t Touch the Black accepts dont-touch@1 (legacy) and dont-touch@2 (endless); 7 Second also answers already_played once the signed-in player has finished today''s deck.';

revoke all on function public.start_game_session(text, text, text) from public;
grant execute on function public.start_game_session(text, text, text) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- The catalogue tells the truth about the game it offers
-- ─────────────────────────────────────────────────────────────────────────────

-- The game page renders this, so it has to describe the run that now exists: no
-- final row, and a conveyor that quickens and darkens as it goes on.
update public.games
   set instructions = 'Rows rise to a line. Tap every white tile in the row at the line, and never touch a black one — one black tap ends the run. There is no final row: the conveyor keeps speeding up and every row grows a little blacker, so keep going until you slip or choose to stop. Each white tile scores ten points, and the tiles you cleared are your score.'
 where slug = 'dont-touch-the-black'
   and status = 'published';

do $$
begin
  if not exists (
    select 1 from public.games
     where slug = 'dont-touch-the-black' and playable and runtime = 'dont-touch'
  ) then
    raise exception 'dont-touch is not playable: this migration must not have been applied to a catalogue that offers the game';
  end if;
end
$$;
