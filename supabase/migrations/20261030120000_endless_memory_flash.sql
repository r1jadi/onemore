-- Endless Memory Flash — a pattern with no final round.
--
-- `20261020120000_memory_flash_sessions.sql` shipped the game with ten patterns
-- on a fixed 4×4 board, fifty-five taps and a `cleared` ending. The ten-round deck
-- was the only artificial ending it had. This migration removes it and keeps the
-- old rules verifiable:
--
--   - **`memory-flash@2` is the new rules version.** A run ends only on a tap the
--     pattern does not light, a repeat of a cell already entered, or the
--     representable submission bound. There is no final pattern.
--   - **The first eight rounds are the retired game's patterns exactly.** The
--     board is still 4×4 and the draw is still modulo sixteen, so an endless run
--     opens with the game that shipped and a run that never reaches round nine
--     faces the same challenges it always did.
--   - **Difficulty is a function of the round.** Round `r` lights `r` distinct
--     cells, one more than the round before, without cap. When a pattern needs
--     more cells than the board holds, the board grows: every eight rounds it
--     gains a row and a column (4×4 for rounds 1–8, 5×5 for 9–16, 6×6 for 17–24,
--     …), so `side² ≥ round` always holds and a longer pattern is always possible.
--     The client also shortens the flash from 700 ms to a 400 ms floor; that is
--     presentation, not replayable state, and the verifier neither knows nor
--     needs it.
--   - **The patterns stay deterministic.** The 32-bit LCG and its seed handling
--     are untouched; only the modulus changes with the round's board, because a
--     cell index on a 5×5 board is not a cell index on a 4×4 one. The generator
--     state still carries across rounds.
--   - **`memory-flash@1` keeps verifying exactly as it did.** Sessions issued
--     before this migration may still be completed: ten patterns, a 4×4 board,
--     fifty-five taps, and the same 100-point perfect line. Only the session's
--     version string chooses the rules.
--   - **The submission bound is not a level.** A run may carry at most 4096 taps;
--     that is a request and replay ceiling, far past the point where a session is
--     still open, not a final round. A run that reaches it ends there, the way the
--     other endless games do.
--
-- The clear rule, the score definition, the ledger and the score table are
-- untouched. See docs/games/README.md for the rules and pinned vectors.

-- ─────────────────────────────────────────────────────────────────────────────
-- The rules, as constants the database owns
-- ─────────────────────────────────────────────────────────────────────────────

-- The version a new session pins. `memory-flash@1` remains a literal in the
-- verifier: the old rules are history, not a constant that moves.
create or replace function public.memory_flash_rules_version()
returns text language sql immutable set search_path = '' as $$ select 'memory-flash@2'::text $$;

-- `memory-flash@1`'s shape is no longer how a new run is measured, but the legacy
-- branch still needs it, and the first eight rounds of a new run are still it.
create or replace function public.memory_flash_rounds()
returns integer language sql immutable set search_path = '' as $$ select 10 $$;

create or replace function public.memory_flash_cells()
returns integer language sql immutable set search_path = '' as $$ select 16 $$;

create or replace function public.memory_flash_taps()
returns integer language sql immutable set search_path = '' as $$ select 55 $$;

-- The most taps one submission may carry. A request ceiling, not a final round.
create or replace function public.memory_flash_max_taps()
returns integer language sql immutable set search_path = '' as $$ select 4096 $$;

-- The board a round is played on: 4×4 for the rounds the shipped game played,
-- then one more row and column every eight rounds, without cap.
create or replace function public.memory_flash_side(p_round integer)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_round is null or p_round < 1 then
    raise exception 'a Memory Flash round is one or more' using errcode = '22023';
  end if;
  return 4 + (p_round - 1) / 8;
end;
$$;

create or replace function public.memory_flash_cells_at(p_round integer)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
begin
  return public.memory_flash_side(p_round) * public.memory_flash_side(p_round);
end;
$$;

comment on function public.memory_flash_rules_version() is
  'The Memory Flash rules version new sessions pin. memory-flash@2 is endless; memory-flash@1 runs are still verified. A rules change needs a new version and a new verifier branch.';
comment on function public.memory_flash_rounds() is
  'The legacy memory-flash@1 rules: ten patterns. memory-flash@2 has no final round; see memory_flash_max_taps().';
comment on function public.memory_flash_cells() is
  'The legacy memory-flash@1 board: sixteen cells. memory-flash@2 grows its board; see memory_flash_cells_at(integer).';
comment on function public.memory_flash_taps() is
  'The legacy memory-flash@1 perfect run: fifty-five taps.';
comment on function public.memory_flash_max_taps() is
  'The most taps a Memory Flash submission may carry. A request bound for the endless game, not a final round.';
comment on function public.memory_flash_side(integer) is
  'The side of the board a Memory Flash round is played on: 4, growing by one every eight rounds, without cap.';
comment on function public.memory_flash_cells_at(integer) is
  'The cells of the board a Memory Flash round is played on.';

-- ─────────────────────────────────────────────────────────────────────────────
-- The patterns, as the one generator both sides draw from
-- ─────────────────────────────────────────────────────────────────────────────
--
-- A pure function of the seed and the round: no rows, no clock, no session. The
-- retired `memory_flash_pattern` keeps its fixed 4×4 board; this one reads the
-- round's own board, which is what lets the pattern grow past sixteen cells.
--
-- It is internals, not API surface — the verifier calls it with the session's
-- seed, and no client needs it, because a client already holds its own seed and
-- computes the same list in TypeScript. Execute is therefore not granted to
-- anyone; the definer-owned verifier calls it as the function's owner.

create or replace function public.memory_flash_endless_pattern(
  p_seed  bigint,
  p_round integer
)
returns integer[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_state   bigint;
  v_cells   integer[] := '{}';
  v_cell    integer;
  v_current integer;
  v_board   integer;
begin
  -- 4096 is a guard on a pure helper, not a last round: the submission bound
  -- cannot reach it (clearing that many patterns would take more taps than a
  -- submission may carry).
  if p_round is null or p_round < 1 or p_round > 4096 then
    raise exception 'memory flash round is outside the reachable run' using errcode = '22023';
  end if;

  v_state := (p_seed % 4294967296 + 4294967296) % 4294967296;
  if v_state = 0 then
    v_state := 2654435769; -- 0x9E3779B9: a zero state would make the sequence degenerate
  end if;

  -- Patterns are drawn in order, carrying the generator state from one round to
  -- the next. Each round's cells are reduced modulo that round's board, so round
  -- nine can light a cell that did not exist on the 4×4 board.
  for v_current in 1..p_round loop
    v_board := public.memory_flash_cells_at(v_current);
    v_cells := '{}';
    while coalesce(array_length(v_cells, 1), 0) < v_current loop
      v_state := (v_state * 1664525 + 1013904223) % 4294967296;
      v_cell := ((v_state >> 16) % v_board)::integer;
      if not (v_cell = any(v_cells)) then
        v_cells := v_cells || v_cell;
      end if;
    end loop;
  end loop;

  return v_cells;
end;
$$;

comment on function public.memory_flash_endless_pattern(bigint, integer) is
  'Round r of an endless Memory Flash seed, as r distinct cells on that round''s board, in draw order. Mirrored by src/lib/games/memory-flash.ts.';

revoke all on function public.memory_flash_endless_pattern(bigint, integer) from public;

-- ─────────────────────────────────────────────────────────────────────────────
-- Complete a run: replay, verify, then record
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.complete_memory_flash_run(
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
  v_pattern  integer[] := '{}';
  v_entered  integer[] := '{}';
  v_round    int := 1;
  v_placed   int := 0;
  v_cleared  int := 0;
  v_score    bigint := 0;
  v_over     boolean := false;
  v_cell     int;
  v_cells    int;
  v_digest   text;
  v_elapsed  bigint;
  v_best     bigint;
  v_rank     bigint;
  -- Which of the two rulesets this session pinned, and the taps it may carry:
  -- 55 for the legacy ten-pattern game, 4096 for the endless board.
  v_endless  boolean := false;
  v_max      int;
begin
  if p_session_id is null then
    raise exception 'a session id is required' using errcode = '22023';
  end if;
  if p_actions is null or array_position(p_actions, null) is not null then
    raise exception 'actions must be a dense array of cell indexes' using errcode = '22023';
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
  -- the legacy ten-pattern game, and the endless board. The version chooses the
  -- rules; a session under anything else is refused rather than guessed at.
  if v_session.rules_version = 'memory-flash@1' then
    v_max := public.memory_flash_taps();
  elsif v_session.rules_version = public.memory_flash_rules_version() then
    v_endless := true;
    v_max := public.memory_flash_max_taps();
  else
    v_result.outcome := 'wrong_rules';
    v_result.session_id := v_session.id;
    v_result.game_slug := v_game.slug;
    return v_result;
  end if;

  if array_length(p_actions, 1) > v_max then
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
  -- Round r lights r cells, drawn from the seed by the generator above and
  -- mirrored by the client's engine (src/lib/games/memory-flash.ts, seeds and
  -- vectors in docs/games/README.md). A pattern is a set: a correct tap is one of
  -- its cells that has not been entered yet, in any order. A tap outside the
  -- pattern, or a repeat, ends the run and is still part of the submission;
  -- actions after that, or a cell that does not exist on the round's board, make
  -- the submission impossible rather than merely bad.
  --
  -- Under @1 the board is 4×4 and the tenth cleared pattern is the whole game.
  -- Under @2 the board grows with the pattern and there is no last round: the run
  -- ends on a mistake, or when the submission bound leaves no room for another
  -- tap.
  if v_endless then
    v_cells := public.memory_flash_cells_at(1);
    v_pattern := public.memory_flash_endless_pattern(v_session.seed, 1);
  else
    v_cells := public.memory_flash_cells();
    v_pattern := public.memory_flash_pattern(v_session.seed, 1);
  end if;

  foreach v_cell in array coalesce(p_actions, array[]::integer[]) loop
    if v_over or v_placed >= v_max then
      v_result.outcome := 'invalid_actions';
      v_result.session_id := v_session.id;
      v_result.game_slug := v_game.slug;
      return v_result;
    end if;

    if v_cell < 0 or v_cell >= v_cells then
      v_result.outcome := 'invalid_actions';
      v_result.session_id := v_session.id;
      v_result.game_slug := v_game.slug;
      return v_result;
    end if;

    v_placed := v_placed + 1;

    if v_cell = any(v_pattern) and not (v_cell = any(v_entered)) then
      v_entered := v_entered || v_cell;
      if coalesce(array_length(v_entered, 1), 0) >= v_round then
        -- The pattern is rebuilt: it clears, and the next one is one cell larger
        -- on a board that has grown if the pattern needs it.
        v_cleared := v_cleared + 1;
        v_entered := '{}';
        if v_endless then
          v_round := v_round + 1;
          v_cells := public.memory_flash_cells_at(v_round);
          v_pattern := public.memory_flash_endless_pattern(v_session.seed, v_round);
        elsif v_round < public.memory_flash_rounds() then
          v_round := v_round + 1;
          v_pattern := public.memory_flash_pattern(v_session.seed, v_round);
        end if;
      end if;
    else
      v_over := true;
    end if;

    -- The submission bound ends an endless run: there is no next tap to carry.
    if not v_over and v_endless and v_placed >= v_max then
      v_over := true;
    end if;
  end loop;

  -- The run has to be submitted in the state it ended in: a submission that
  -- stops early is a partial run, and scoring it would let a player discard the
  -- tap that broke the pattern.
  if not v_over and v_placed < v_max then
    v_result.outcome := 'invalid_actions';
    v_result.session_id := v_session.id;
    v_result.game_slug := v_game.slug;
    return v_result;
  end if;

  v_score := v_cleared * 10;

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

comment on function public.complete_memory_flash_run(uuid, integer[], bigint, integer) is
  'Replays a submitted Memory Flash run from its session seed, derives the score, and records it. memory-flash@1 ends after ten patterns on a 4×4 board; memory-flash@2 has no final round, grows the board with the pattern, and ends only on a mistake or the submission bound. The claim is compared, never trusted.';

revoke all on function public.complete_memory_flash_run(uuid, integer[], bigint, integer) from public;
grant execute on function public.complete_memory_flash_run(uuid, integer[], bigint, integer) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Start a run: the gate learns the endless version and keeps the legacy one
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
  -- implements. Stack 10, Chain, Don't Touch the Black and Color Merge have two
  -- each — the endless version new runs pin, and the legacy finite version a
  -- session opened before the endless migrations still holds. Anything else is a
  -- version no verifier owns.
  if (v_game.runtime = 'stack-10'
      and p_rules_version in ('stack-10@1', public.stack10_rules_version()))
     or (v_game.runtime = 'chain'
         and p_rules_version in ('chain@1', public.chain_rules_version()))
     or (v_game.runtime = 'memory-flash'
         and p_rules_version in ('memory-flash@1', public.memory_flash_rules_version()))
     or (v_game.runtime = 'one-move' and p_rules_version = public.one_move_rules_version())
     or (v_game.runtime = 'color-merge'
         and p_rules_version in ('color-merge@1', public.color_merge_rules_version()))
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
    -- An endless run is a marathon, so its session lives for twelve hours instead
    -- of the table's two: it should end when the board ends it, not when the clock
    -- does. Every finite game keeps two hours.
    insert into public.game_sessions (game_id, user_id, client, rules_version, expires_at)
    values (v_game.id, v_user, v_client, p_rules_version,
            case when p_rules_version in ('chain@2', 'color-merge@2', 'stack-10@2', 'memory-flash@2')
                 then now() + interval '12 hours'
                 else now() + interval '2 hours' end)
    returning * into v_session;
  end if;

  v_empty.outcome       := 'started';
  v_empty.id            := v_session.id;
  v_empty.game_slug     := v_game.slug;
  v_empty.rules_version := v_session.rules_version;
  v_empty.seed          := v_session.seed;
  -- The moves a session tells the client about: tiles for Stack 10, taps for
  -- Memory Flash, board taps for One Move, rows for Don't Touch the Black, and
  -- answers for 7 Second. The endless games report their submission bound — there
  -- is no complete run to count — while a legacy session still reports its finite
  -- length.
  v_empty.tile_count    := case v_game.runtime
                             when 'stack-10' then
                               case when p_rules_version = 'stack-10@1'
                                    then public.stack10_tiles()
                                    else public.stack10_max_tiles()
                               end
                             when 'chain' then
                               case when p_rules_version = 'chain@1'
                                    then public.chain_taps()
                                    else public.chain_max_actions()
                               end
                             when 'memory-flash' then
                               case when p_rules_version = 'memory-flash@1'
                                    then public.memory_flash_taps()
                                    else public.memory_flash_max_taps()
                               end
                             when 'one-move' then public.one_move_taps()
                             when 'color-merge' then
                               case when p_rules_version = 'color-merge@1'
                                    then public.color_merge_slides()
                                    else public.color_merge_max_slides()
                               end
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
  'Issues a play session with a server-chosen seed. The caller identity is the verified token, never an argument. Stack 10 accepts stack-10@1 (legacy) and stack-10@2 (endless); Chain accepts chain@1 and chain@2; Memory Flash accepts memory-flash@1 (legacy) and memory-flash@2 (endless); Color Merge accepts color-merge@1 and color-merge@2; Don''t Touch the Black accepts dont-touch@1 and dont-touch@2; 7 Second also answers already_played once the signed-in player has finished today''s deck.';

revoke all on function public.start_game_session(text, text, text) from public;
grant execute on function public.start_game_session(text, text, text) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- The catalogue tells the truth about the game it offers
-- ─────────────────────────────────────────────────────────────────────────────

-- The game page renders this, so it has to describe the run that now exists: no
-- final pattern, a board that grows, and a flash that shortens.
update public.games
   set instructions = 'Watch the pattern, then rebuild it in any order. One wrong or repeated cell ends the run. There is no final pattern: every round adds a cell, the board grows when the pattern outgrows it, and the flash gets shorter. Ten points a round.'
 where slug = 'memory-flash';
