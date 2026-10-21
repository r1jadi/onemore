-- 0020 — Don't Touch the Black sessions: the verifier for the sixth runtime.
--
-- What this migration changes, and why each piece is here:
--
--   1. The rules the game plays under, as constants the database owns:
--      `dont-touch@1`, twenty rows of three lanes, and a tile worth ten points.
--      The deck is fixed in size so two scores measure the same board: a run that
--      ends early (a black tap) and a run that sees the whole deck are scored on
--      the same sixty cells.
--
--   2. The deck's colour, as a pure function of the seed and a cell index —
--      `public.dont_touch_black`. Keying the draw to its index rather than to a
--      mutable generator means the verifier can reach cell fifty without
--      replaying forty-nine, and the client cannot drift by one draw.
--
--   3. `public.complete_dont_touch_run`, the verifier. It replays the submitted
--      taps from the session's seed exactly the way the other five verifiers
--      replay theirs: same outcome vocabulary (`recorded`, `duplicate`,
--      `score_mismatch`, …) and the same ledger behaviour. Only the replay
--      differs, because the game does: a white tile scores ten and may be
--      cleared once; a black tile ends the run, and the tap that touched it is
--      part of the submission so the ending can be replayed rather than claimed.
--      Taps are cell numbers, never timestamps: the conveyor decides *when* a
--      tile is in reach, the rules decide what touching it is worth.
--
--   4. `public.start_game_session` learns the sixth runtime it may issue. The
--      gate is a pair — (runtime, rules version) — so the earlier five games keep
--      exactly the sessions they had and this one gets its own; anything else is
--      still `unsupported_runtime`. Its `tile_count` is 60: the field counts the
--      moves a complete run can hold, and its moves are cell taps.
--
-- Nothing here flips the catalogue: `dont-touch-the-black` stays unplayable until
-- its own flip migration, applied after the deployment carrying the runtime is
-- live — the same ordering the other five games used.
--
-- The rules themselves are documented in docs/games/README.md. Bumping them means
-- a new rules version and a new verifier function; this one keeps verifying the
-- runs whose sessions pinned it.

-- ─────────────────────────────────────────────────────────────────────────────
-- The rules, as constants the database owns
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.dont_touch_rules_version()
returns text language sql immutable set search_path = '' as $$ select 'dont-touch@1'::text $$;

create or replace function public.dont_touch_rows()
returns integer language sql immutable set search_path = '' as $$ select 20 $$;

create or replace function public.dont_touch_lanes()
returns integer language sql immutable set search_path = '' as $$ select 3 $$;

create or replace function public.dont_touch_cells()
returns integer language sql immutable set search_path = ''
as $$ select public.dont_touch_rows() * public.dont_touch_lanes() $$;

-- Ten points per white tile. A black tile is worth nothing: its cost is the run.
create or replace function public.dont_touch_tile_score()
returns bigint language sql immutable set search_path = '' as $$ select 10::bigint $$;

comment on function public.dont_touch_rules_version() is
  'The Don''t Touch the Black rules version the database can verify. A rules change needs a new version and a new verifier.';

comment on function public.dont_touch_rows() is
  'The rows a Don''t Touch the Black deck holds.';

comment on function public.dont_touch_lanes() is
  'The lanes in a Don''t Touch the Black row.';

comment on function public.dont_touch_cells() is
  'The cells a Don''t Touch the Black run can address.';

-- ─────────────────────────────────────────────────────────────────────────────
-- The deck, as the generator both sides draw from
-- ─────────────────────────────────────────────────────────────────────────────
--
-- A pure function of the seed and the cell: no rows, no clock, no session. It is
-- an internal, not API surface — the verifier calls it with the session's seed,
-- and no client needs it, because a client already holds its own seed and
-- computes the same colours in TypeScript. Execute is therefore not granted to
-- anyone; the definer-owned verifier calls it as the function's owner.

-- Whether cell `p_cell` is black on seed `p_seed`'s deck.
--
-- The generator is the same 32-bit LCG the other games use, with the same
-- zero-state fallback: a state that differs by one bit colours a different deck,
-- and an honest run would be refused. The colour is read from bits 16–17 rather
-- than the low bits, and deliberately so: this LCG's low bits cycle with a period
-- of two to the power of the bit width, so a colour read from them would repeat a
-- fixed pattern regardless of the seed. The higher bits have the full period.
create or replace function public.dont_touch_black(
  p_seed bigint,
  p_cell integer
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_state bigint;
  v_draw  int;
begin
  if p_cell is null or p_cell < 0 or p_cell >= public.dont_touch_cells() then
    raise exception 'a Don''t Touch the Black cell is 0 to %', public.dont_touch_cells() - 1
      using errcode = '22023';
  end if;

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

  return (v_state >> 16) % 4 = 0;
end;
$$;

comment on function public.dont_touch_black(bigint, integer) is
  'Whether one cell of a seed''s Don''t Touch the Black deck is black. Pure, and read by the verifier only.';

revoke all on function public.dont_touch_black(bigint, integer) from public;

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

  -- The session pins the rules it was issued under; this verifier implements one
  -- version, and says so rather than guessing at the other.
  if v_session.rules_version is distinct from public.dont_touch_rules_version() then
    v_result.outcome := 'wrong_rules';
    v_result.session_id := v_session.id;
    v_result.game_slug := v_game.slug;
    return v_result;
  end if;

  if coalesce(array_length(p_actions, 1), 0) > public.dont_touch_cells() then
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
  -- ends the run. A cell that is off the deck, touched twice, or touched after
  -- the black tile ended the run is impossible play — the client never records
  -- one — and the whole submission is refused rather than scored partially.
  --
  -- A run that never touched a black tile is legal however many whites it
  -- cleared: whether the player saw the whole deck is a fact about the conveyor's
  -- clock, not about this array, and refusing a short run would refuse every
  -- honest player who let a row pass.
  foreach v_cell in array coalesce(p_actions, array[]::integer[]) loop
    if v_over then
      v_result.outcome := 'invalid_actions';
      v_result.session_id := v_session.id;
      v_result.game_slug := v_game.slug;
      return v_result;
    end if;

    if v_cell < 0 or v_cell >= public.dont_touch_cells() then
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

    if public.dont_touch_black(v_session.seed, v_cell) then
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
  'Replays a submitted Don''t Touch the Black run from its session seed, derives the score, and records it. The claim is compared, never trusted.';

revoke all on function public.complete_dont_touch_run(uuid, integer[], bigint, integer) from public;
grant execute on function public.complete_dont_touch_run(uuid, integer[], bigint, integer) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Start a run: the gate learns Don't Touch the Black's (runtime, rules) pair
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

  -- The gate is a pair: each runtime plays exactly the rules version its
  -- verifier implements. Anything else is a version no verifier owns.
  if (v_game.runtime = 'stack-10' and p_rules_version = public.stack10_rules_version())
     or (v_game.runtime = 'chain' and p_rules_version = public.chain_rules_version())
     or (v_game.runtime = 'memory-flash' and p_rules_version = public.memory_flash_rules_version())
     or (v_game.runtime = 'one-move' and p_rules_version = public.one_move_rules_version())
     or (v_game.runtime = 'color-merge' and p_rules_version = public.color_merge_rules_version())
     or (v_game.runtime = 'dont-touch' and p_rules_version = public.dont_touch_rules_version()) then
    -- Allowed: issued below.
    null;
  else
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
  -- The moves a complete run holds: tiles for Stack 10, taps for Chain and
  -- Memory Flash, board taps for One Move, slides for Color Merge, cell taps for
  -- Don't Touch the Black.
  v_empty.tile_count    := case v_game.runtime
                             when 'chain' then public.chain_taps()
                             when 'memory-flash' then public.memory_flash_taps()
                             when 'one-move' then public.one_move_taps()
                             when 'color-merge' then public.color_merge_slides()
                             when 'dont-touch' then public.dont_touch_cells()
                             else public.stack10_tiles()
                           end;
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
