-- Endless Color Merge — a board with no final slide.
--
-- `20261022120000_color_merge_sessions.sql` shipped the game with a forty-eight
-- slide deck: a 2048-style board can be kept alive indefinitely, so the deck was
-- the rule that ended a run and made two scores comparable. This migration removes
-- that artificial end and deliberately keeps the old rules verifiable:
--
--   - **`color-merge@2` is the new rules version.** There is no deck. A run ends
--     when the board locks — every cell full and no two neighbours equal — or at
--     the representable submission bound. That is the game's own ending, and it
--     is the only one.
--   - **The spawn ramp is the difficulty.** A dealt tile is promoted with a chance
--     that rises one point every five spawns from 10% to a 60% ceiling, and the
--     promoted shade climbs by one every 120 spawns with no cap. Early play feels
--     like the old game (10% shade two); later play fills the board with higher
--     tiles that are harder to pair, so the space a run can keep free shrinks and
--     the next lock arrives sooner. The shade ramp keeps climbing after the
--     chance has reached its ceiling, so difficulty never becomes static.
--   - **`color-merge@1` keeps verifying exactly as it did.** Sessions issued
--     before this migration may still be completed: the same forty-eight-slide
--     deck, the same opening board, the same 10% shade-two spawn, the same
--     `deck` ending. Only the session's version string chooses the rules.
--   - **The submission bound is not a level.** A run may carry at most 4096
--     slides; that is a request and replay ceiling, far past the point where a
--     session is still open, not a final slide.
--
-- The slide rule, the merge rule, the score definition, the ledger and the score
-- table are untouched. See docs/games/README.md for the rules and pinned vectors.

-- ─────────────────────────────────────────────────────────────────────────────
-- The rules, as constants the database owns
-- ─────────────────────────────────────────────────────────────────────────────

-- The version a new session pins. `color-merge@1` remains a literal in the
-- verifier: the old rules are history, not a constant that moves.
create or replace function public.color_merge_rules_version()
returns text language sql immutable set search_path = '' as $$ select 'color-merge@2'::text $$;

-- `color-merge@1`'s forty-eight-slide deck is no longer how a new run is
-- measured, but the legacy branch still needs it. It is kept, and named for what
-- it is.
create or replace function public.color_merge_slides()
returns integer language sql immutable set search_path = '' as $$ select 48 $$;

-- The most slides one submission may carry. A request ceiling, not a final slide.
create or replace function public.color_merge_max_slides()
returns integer language sql immutable set search_path = '' as $$ select 4096 $$;

-- The share of spawns that arrive promoted: 10% at the first spawn, one point
-- more every five spawns, capped at 60%.
create or replace function public.color_merge_spawn_percent(p_index integer)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_index is null or p_index < 1 then
    raise exception 'a Color Merge spawn index starts at one' using errcode = '22023';
  end if;
  return least(60, 10 + (p_index / 5));
end;
$$;

-- The shade a promoted spawn arrives at: two for the first hundred and twenty
-- spawns, then one higher every hundred and twenty, with no cap.
create or replace function public.color_merge_spawn_shade(p_index integer)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_index is null or p_index < 1 then
    raise exception 'a Color Merge spawn index starts at one' using errcode = '22023';
  end if;
  return 2 + (p_index / 120);
end;
$$;

comment on function public.color_merge_rules_version() is
  'The Color Merge rules version new sessions pin. color-merge@2 is endless; color-merge@1 runs are still verified. A rules change needs a new version and a new verifier branch.';
comment on function public.color_merge_slides() is
  'The legacy color-merge@1 rules: forty-eight slides. color-merge@2 has no deck; see color_merge_max_slides().';
comment on function public.color_merge_max_slides() is
  'The most slides a Color Merge submission may carry. A request bound for the endless game, not a final slide.';
comment on function public.color_merge_spawn_percent(integer) is
  'The chance a Color Merge spawn is promoted: 10% at spawn one, one point per five spawns, capped at 60%.';
comment on function public.color_merge_spawn_shade(integer) is
  'The shade a promoted Color Merge spawn arrives at: two, then one higher every 120 spawns, without cap.';

-- ─────────────────────────────────────────────────────────────────────────────
-- The endless spawn, as the generator both sides draw from
-- ─────────────────────────────────────────────────────────────────────────────
--
-- The cell is chosen exactly as the legacy spawn chooses it: the generator is
-- advanced `p_index` times to pick among the empty cells, then once more for the
-- shade. Only the shade rule differs, so a board and its legacy twin agree on
-- where tiles land even after their colours have diverged.

create or replace function public.color_merge_spawn_endless(
  p_seed  bigint,
  p_index integer,
  p_board integer[]
)
returns integer[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_state   bigint;
  v_empties integer[] := array[]::integer[];
  v_cell    int;
  v_draw    int;
begin
  if p_seed is null then
    raise exception 'a seed is required' using errcode = '22023';
  end if;
  if p_index is null or p_index < 1 then
    raise exception 'a Color Merge spawn index starts at one' using errcode = '22023';
  end if;
  if p_board is null or array_length(p_board, 1) is distinct from 16 then
    raise exception 'a Color Merge board has sixteen cells' using errcode = '22023';
  end if;

  for v_draw in 1..16 loop
    if p_board[v_draw] = 0 then
      v_empties := v_empties || v_draw;
    end if;
  end loop;
  if coalesce(array_length(v_empties, 1), 0) = 0 then
    return p_board;
  end if;

  v_state := (p_seed % 4294967296 + 4294967296) % 4294967296;
  if v_state = 0 then
    v_state := 2654435769; -- 0x9E3779B9: a zero state would make the sequence degenerate
  end if;

  for v_draw in 1..p_index loop
    v_state := (v_state * 1664525 + 1013904223) % 4294967296;
  end loop;

  v_cell := v_empties[((v_state % array_length(v_empties, 1))::int) + 1];

  v_state := (v_state * 1664525 + 1013904223) % 4294967296;
  p_board[v_cell] := case
    when v_state % 100 < public.color_merge_spawn_percent(p_index)
      then public.color_merge_spawn_shade(p_index)
    else 1
  end;
  return p_board;
end;
$$;

-- The board an endless run opens with: two tiles, drawn from the same spawn
-- indices the legacy board used, but through the endless shade rule.
create or replace function public.color_merge_board_endless(p_seed bigint)
returns integer[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_board integer[] := array_fill(0, array[16]);
  v_index int;
begin
  if p_seed is null then
    raise exception 'a seed is required' using errcode = '22023';
  end if;
  for v_index in 1..2 loop
    v_board := public.color_merge_spawn_endless(p_seed, v_index, v_board);
  end loop;
  return v_board;
end;
$$;

comment on function public.color_merge_spawn_endless(bigint, integer, integer[]) is
  'Spawn `p_index` on the endless Color Merge ramp. Pure, and read by the verifier only.';
comment on function public.color_merge_board_endless(bigint) is
  'The two tiles an endless Color Merge run opens with. Mirrored by src/lib/games/color-merge.ts.';

revoke all on function public.color_merge_spawn_endless(bigint, integer, integer[]) from public;
revoke all on function public.color_merge_board_endless(bigint) from public;

-- ─────────────────────────────────────────────────────────────────────────────
-- Complete a run: replay, verify, then record
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.complete_color_merge_run(
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
  v_board    integer[];
  v_next     integer[];
  v_gain     bigint;
  v_slides   int := 0;
  v_score    bigint := 0;
  v_over     boolean := false;
  -- Which of the two rulesets this session pinned, and the slides it may carry:
  -- 48 for the legacy deck, 4096 for the endless board.
  v_endless  boolean := false;
  v_max      int;
  v_direction int;
  v_digest   text;
  v_elapsed  bigint;
  v_best     bigint;
  v_rank     bigint;
begin
  if p_session_id is null then
    raise exception 'a session id is required' using errcode = '22023';
  end if;
  if p_actions is null or array_position(p_actions, null) is not null then
    raise exception 'actions must be a dense array of directions' using errcode = '22023';
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
  -- the legacy forty-eight-slide deck, and the endless board. The version chooses
  -- the rules; a session under anything else is refused rather than guessed at.
  if v_session.rules_version = 'color-merge@1' then
    v_max := public.color_merge_slides();
  elsif v_session.rules_version = public.color_merge_rules_version() then
    v_endless := true;
    v_max := public.color_merge_max_slides();
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
  -- The board opens at two tiles from the seed, and each submitted direction is
  -- one slide: every line compacts toward that edge, equal neighbours merge into
  -- the next shade, a tile is dealt, and the score grows by the value the board
  -- gained. A slide that changes nothing is impossible play — the client never
  -- records one — and so is a slide after the run ended, a direction that is not
  -- 0 to 3, or a submission that stops before the board locks.
  --
  -- Under @1 the forty-eighth slide ends the run. Under @2 only the board's own
  -- lock (or the submission bound) does.
  if v_endless then
    v_board := public.color_merge_board_endless(v_session.seed);
  else
    v_board := public.color_merge_board(v_session.seed);
  end if;

  foreach v_direction in array coalesce(p_actions, array[]::integer[]) loop
    if v_over or v_slides >= v_max then
      v_result.outcome := 'invalid_actions';
      v_result.session_id := v_session.id;
      v_result.game_slug := v_game.slug;
      return v_result;
    end if;

    if v_direction < 0 or v_direction > 3 then
      v_result.outcome := 'invalid_actions';
      v_result.session_id := v_session.id;
      v_result.game_slug := v_game.slug;
      return v_result;
    end if;

    v_next := public.color_merge_slide(v_board, v_direction);
    if v_next = v_board then
      v_result.outcome := 'invalid_actions';
      v_result.session_id := v_session.id;
      v_result.game_slug := v_game.slug;
      return v_result;
    end if;

    v_gain := public.color_merge_gain(v_board, v_direction);
    v_score := v_score + v_gain;
    v_board := v_next;
    v_slides := v_slides + 1;

    -- The bound and the legacy deck both end the run without dealing a tile:
    -- there is no next move to make with it.
    if v_slides >= v_max then
      v_over := true;
    else
      if v_endless then
        v_board := public.color_merge_spawn_endless(v_session.seed, v_slides + 2, v_board);
      else
        v_board := public.color_merge_spawn(v_session.seed, v_slides + 2, v_board);
      end if;
      if not public.color_merge_can_move(v_board) then
        v_over := true;
      end if;
    end if;
  end loop;

  -- The run has to be submitted in the state it ended in: a submission that
  -- stops early is a partial run, and scoring it would let a player discard the
  -- slide that locked theirs.
  if not v_over then
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
  v_result.tiles_placed    := v_slides;
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

comment on function public.complete_color_merge_run(uuid, integer[], bigint, integer) is
  'Replays a submitted Color Merge run from its session seed, derives the score, and records it. color-merge@1 ends at a forty-eight-slide deck; color-merge@2 has no deck and ends only when the board locks or the submission bound is reached. The claim is compared, never trusted.';

revoke all on function public.complete_color_merge_run(uuid, integer[], bigint, integer) from public;
grant execute on function public.complete_color_merge_run(uuid, integer[], bigint, integer) to anon, authenticated;

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
  -- implements. Chain, Don't Touch the Black and Color Merge have two each — the
  -- endless version new runs pin, and the legacy finite version a session opened
  -- before the endless migrations still holds. Anything else is a version no
  -- verifier owns.
  if (v_game.runtime = 'stack-10' and p_rules_version = public.stack10_rules_version())
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
    -- A chain@2 run is endless in principle, so its session lives for twelve
    -- hours instead of the table's two: a marathon should end when a tap breaks
    -- the chain, not when the clock does. Color Merge is endless too, and a long
    -- board can take hours of slides, so it gets the same window. Every other
    -- game keeps two hours.
    insert into public.game_sessions (game_id, user_id, client, rules_version, expires_at)
    values (v_game.id, v_user, v_client, p_rules_version,
            case when p_rules_version in ('chain@2', 'color-merge@2')
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
  'Issues a play session with a server-chosen seed. The caller identity is the verified token, never an argument. Chain accepts chain@1 (legacy) and chain@2 (endless); Color Merge accepts color-merge@1 (legacy) and color-merge@2 (endless); Don''t Touch the Black accepts dont-touch@1 (legacy) and dont-touch@2 (endless); 7 Second also answers already_played once the signed-in player has finished today''s deck.';

revoke all on function public.start_game_session(text, text, text) from public;
grant execute on function public.start_game_session(text, text, text) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- The catalogue tells the truth about the game it offers
-- ─────────────────────────────────────────────────────────────────────────────

-- The game page renders this, so it has to describe the run that now exists: no
-- final slide, and a spawn ramp that tightens the board as the run goes on.
update public.games
   set instructions = 'Slide the whole board with the arrow keys, WASD or a swipe. Equal neighbours merge into the next shade, and each tile merges once per slide. There is no final slide: the run ends only when the board locks, with every cell full and no matching neighbours. New tiles arrive with a growing chance of a higher shade, so the space you have keeps shrinking — keep merging to survive.'
 where slug = 'color-merge'
   and status = 'published';

do $$
begin
  if not exists (
    select 1 from public.games
     where slug = 'color-merge' and playable and runtime = 'color-merge'
  ) then
    raise exception 'color-merge is not playable: this migration must not have been applied to a catalogue that offers the game';
  end if;
end
$$;
