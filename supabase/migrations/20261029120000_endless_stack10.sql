-- Endless Stack 10 — a deck with no final tile.
--
-- `20261013120000_play_sessions.sql` shipped the game with a sixty-tile deck: a
-- run either filled a column past ten or, if every tile was placed, ended as
-- `cleared`. The deck was the only artificial ending the game had. This migration
-- removes it and deliberately keeps the old rules verifiable:
--
--   - **`stack-10@2` is the new rules version.** There is no deck. A run ends only
--     when a column passes ten — the game's own ending — or at the representable
--     submission bound.
--   - **The first sixty tiles are the retired deck exactly.** The pressure ramp
--     starts on tile sixty-one, so the opening of an endless run is the game that
--     shipped, and a run that never reaches sixty faces the same difficulty it
--     always did.
--   - **The ramp is the difficulty.** From tile sixty-one a draw can arrive
--     promoted: the chance rises one point every four tiles to a 60% ceiling, and
--     a promoted tile gains one more every 240 tiles, without cap (a 1–9 tile is a
--     face value, so the gain is clamped at nine — ten would be unplaceable on a
--     board that clears at ten). Early promotions are rare; late ones are heavy,
--     so clears get rarer and the next overflow comes sooner. The chance ceiling
--     is not where difficulty stops: the weight keeps climbing, so the board keeps
--     receiving the heaviest tiles it can hold.
--   - **`stack-10@1` keeps verifying exactly as it did.** Sessions issued before
--     this migration may still be completed: the same sixty draws, the same
--     scoring, the same `cleared` ending when all sixty tiles fit. Only the
--     session's version string chooses the rules.
--   - **The submission bound is not a level.** A run may carry at most 4096 tiles;
--     that is a request and replay ceiling, far past the point where a session is
--     still open, not a final tile.
--
-- The generator's base draws, the clear rule, the score definition, the ledger and
-- the score table are untouched. See docs/games/README.md for the rules and pinned
-- vectors.

-- ─────────────────────────────────────────────────────────────────────────────
-- The rules, as constants the database owns
-- ─────────────────────────────────────────────────────────────────────────────

-- The version a new session pins. `stack-10@1` remains a literal in the verifier:
-- the old rules are history, not a constant that moves.
create or replace function public.stack10_rules_version()
returns text language sql immutable set search_path = '' as $$ select 'stack-10@2'::text $$;

-- `stack-10@1`'s sixty-tile deck is no longer how a new run is measured, but the
-- legacy branch still needs it and the first sixty tiles of a new run still are
-- it. It is kept, and named for what it is.
create or replace function public.stack10_tiles()
returns integer language sql immutable set search_path = '' as $$ select 60 $$;

-- The most tiles one submission may carry. A request ceiling, not a final tile.
create or replace function public.stack10_max_tiles()
returns integer language sql immutable set search_path = '' as $$ select 4096 $$;

-- The chance a tile arrives promoted: nothing for the retired deck, then one
-- point every four tiles to a 60% ceiling.
create or replace function public.stack10_pressure_percent(p_placed integer)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_placed is null or p_placed < 0 then
    raise exception 'a Stack 10 tile index is zero or more' using errcode = '22023';
  end if;
  if p_placed < public.stack10_tiles() then
    return 0;
  end if;
  return least(60, (p_placed - public.stack10_tiles()) / 4);
end;
$$;

-- The value a promoted tile gains: one for the first 240 tiles past the retired
-- deck, then one more every 240, without cap.
create or replace function public.stack10_heavy_bonus(p_placed integer)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_placed is null or p_placed < 0 then
    raise exception 'a Stack 10 tile index is zero or more' using errcode = '22023';
  end if;
  return 1 + (p_placed / 240);
end;
$$;

comment on function public.stack10_rules_version() is
  'The Stack 10 rules version new sessions pin. stack-10@2 is endless; stack-10@1 runs are still verified. A rules change needs a new version and a new verifier branch.';
comment on function public.stack10_tiles() is
  'The legacy stack-10@1 rules: sixty tiles. stack-10@2 has no deck; see stack10_max_tiles().';
comment on function public.stack10_max_tiles() is
  'The most tiles a Stack 10 submission may carry. A request bound for the endless game, not a final tile.';
comment on function public.stack10_pressure_percent(integer) is
  'The chance a Stack 10 tile arrives promoted: nothing for the retired deck, then one point every four tiles, capped at 60%.';
comment on function public.stack10_heavy_bonus(integer) is
  'The value a promoted Stack 10 tile gains: one, then one more every 240 tiles, without cap.';

-- ─────────────────────────────────────────────────────────────────────────────
-- The draw, as the verifier and the tests read it
-- ─────────────────────────────────────────────────────────────────────────────
--
-- A pure function of the seed and the tile index, so the ramp can be asserted
-- directly instead of being inferred from a whole run's score. It advances the
-- same 32-bit LCG the replay advances, once per tile, and reads the promotion roll
-- from bits 16 and above: this generator's low bits cycle with a period of two to
-- the power of their width, so a roll read from them would repeat whatever the
-- seed.

create or replace function public.stack10_tile(p_seed bigint, p_placed integer)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_state bigint;
  v_tile  int;
  v_roll  int;
  v_index int;
begin
  if p_seed is null then
    raise exception 'a seed is required' using errcode = '22023';
  end if;
  if p_placed is null or p_placed < 0 then
    raise exception 'a Stack 10 tile index is zero or more' using errcode = '22023';
  end if;

  v_state := (p_seed % 4294967296 + 4294967296) % 4294967296;
  if v_state = 0 then
    v_state := 2654435769; -- 0x9E3779B9: a zero state would make the sequence degenerate
  end if;

  for v_index in 0..p_placed loop
    v_state := (v_state * 1664525 + 1013904223) % 4294967296;
  end loop;

  v_tile := (v_state % 9)::int + 1;
  v_roll := ((v_state >> 16) % 100)::int;
  if v_roll < public.stack10_pressure_percent(p_placed) then
    v_tile := least(9, v_tile + public.stack10_heavy_bonus(p_placed));
  end if;
  return v_tile;
end;
$$;

comment on function public.stack10_tile(bigint, integer) is
  'The tile the p_placed-th move of a Stack 10 run draws. Pure, and mirrored by src/lib/games/stack10.ts.';

revoke all on function public.stack10_tile(bigint, integer) from public;

-- ─────────────────────────────────────────────────────────────────────────────
-- Complete a run: replay, verify, then record
-- ─────────────────────────────────────────────────────────────────────────────

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
  v_roll     int;
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
  -- Which of the two rulesets this session pinned, and the tiles it may carry:
  -- 60 for the legacy deck, 4096 for the endless board.
  v_endless  boolean := false;
  v_max      int;
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

  -- The session pins the rules it was issued under. Two versions are implemented:
  -- the legacy sixty-tile deck, and the endless board. The version chooses the
  -- rules; a session under anything else is refused rather than guessed at.
  if v_session.rules_version = 'stack-10@1' then
    v_max := public.stack10_tiles();
  elsif v_session.rules_version = public.stack10_rules_version() then
    v_endless := true;
    v_max := public.stack10_max_tiles();
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
  -- The base tile sequence is a function of the seed alone: a 32-bit LCG, defined
  -- once here and mirrored by the client's engine (seeds and vectors in
  -- docs/games/README.md). Tiles are 1..9. A drop raises its column's sum; a sum
  -- of exactly ten clears the column and scores; a sum above ten ends the run.
  -- Actions after the run ended, or a column that does not exist, make the
  -- submission impossible rather than merely bad.
  --
  -- Under @1 that is the whole game: the sixty-tile deck ends the run.
  -- Under @2 the first sixty tiles are the same deck, and from tile sixty-one a
  -- draw can arrive promoted — heavier, by a chance and a weight that both climb.
  v_state := (v_session.seed % 4294967296 + 4294967296) % 4294967296;
  if v_state = 0 then
    v_state := 2654435769; -- 0x9E3779B9: a zero state would make the sequence degenerate
  end if;

  foreach v_column in array coalesce(p_actions, array[]::integer[]) loop
    if v_over or v_placed >= v_max then
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

    if v_endless then
      v_roll := ((v_state >> 16) % 100)::int;
      if v_roll < public.stack10_pressure_percent(v_placed) then
        v_tile := least(9, v_tile + public.stack10_heavy_bonus(v_placed));
      end if;
    end if;

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

    -- The submission bound ends an endless run: there is no next tile to place.
    if not v_over and v_endless and v_placed >= v_max then
      v_over := true;
    end if;
  end loop;

  -- The run has to be submitted in the state it ended in. Under @1 a list of all
  -- sixty tiles is complete; under @2 a submission that stops while the board can
  -- still take a tile is partial, because the deck no longer ends anything.
  if not v_over and (v_endless or v_placed < public.stack10_tiles()) then
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
  'Replays a submitted Stack 10 run from its session seed, derives the score, and records it. stack-10@1 ends at a sixty-tile deck; stack-10@2 has no deck, and its tiles arrive heavier from tile sixty-one. The claim is compared, never trusted.';

revoke all on function public.complete_stack10_run(uuid, integer[], bigint, integer) from public;
grant execute on function public.complete_stack10_run(uuid, integer[], bigint, integer) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Start a run: the gate accepts the endless version and its legacy
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
     or (v_game.runtime = 'memory-flash' and p_rules_version = public.memory_flash_rules_version())
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
            case when p_rules_version in ('chain@2', 'color-merge@2', 'stack-10@2')
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
                             when 'memory-flash' then public.memory_flash_taps()
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
  'Issues a play session with a server-chosen seed. The caller identity is the verified token, never an argument. Stack 10 accepts stack-10@1 (legacy) and stack-10@2 (endless); Chain accepts chain@1 and chain@2; Color Merge accepts color-merge@1 and color-merge@2; Don''t Touch the Black accepts dont-touch@1 and dont-touch@2; 7 Second also answers already_played once the signed-in player has finished today''s deck.';

revoke all on function public.start_game_session(text, text, text) from public;
grant execute on function public.start_game_session(text, text, text) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- The catalogue tells the truth about the game it offers
-- ─────────────────────────────────────────────────────────────────────────────

-- The game page renders this, so it has to describe the run that now exists: no
-- final tile, and tiles that arrive heavier as the run goes on.
update public.games
   set instructions = 'Place the numbered tile in one of four columns. A column that adds up to exactly ten clears and scores; a column that goes past ten ends the run. There is no final tile: the first sixty tiles are the old deck, and from there tiles arrive with a growing chance of a heavier face, so clears get rarer and the board gets tighter. Keep the sums exact.'
 where slug = 'stack-10'
   and status = 'published';

do $$
begin
  if not exists (
    select 1 from public.games
     where slug = 'stack-10' and playable and runtime = 'stack-10'
  ) then
    raise exception 'stack-10 is not playable: this migration must not have been applied to a catalogue that offers the game';
  end if;
end
$$;
