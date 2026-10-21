-- 0018 — Color Merge sessions: the verifier for the fifth shipped runtime.
--
-- What this migration changes, and why each piece is here:
--
--   1. The rules Color Merge plays under, as constants the database owns:
--      `color-merge@1` and a deck of forty-eight slides. A 2048-style board can
--      be kept alive indefinitely, so the deck is what ends a run: two scores
--      always measure the same number of slides. A board that locks first ends
--      the run earlier.
--
--   2. The board, as the generator both sides draw from. Two functions, because
--      the seed decides two things: `color_merge_board` deals the opening two
--      tiles, and `color_merge_spawn` deals the tile after slide `k` from the
--      seed and `k` alone. Keying a spawn to its index rather than to a mutable
--      generator means the verifier can reach spawn twenty without replaying
--      nineteen, and the client cannot drift by one draw.
--
--   3. `public.complete_color_merge_run`, the verifier. It replays the submitted
--      directions from the session's seed exactly the way the other four
--      verifiers replay theirs: same outcome vocabulary (`recorded`, `duplicate`,
--      `score_mismatch`, …) and the same ledger behaviour. Only the replay
--      differs, because the game does: a direction compacts every line in that
--      direction, equal neighbours merge into the next shade, a tile is dealt,
--      and the run ends when the board locks or the deck runs out. The score is
--      the value the board gained, which is exactly the tiles the merges created
--      — the same definition the client engine uses.
--
--   4. `public.start_game_session` learns the fifth runtime it may issue. The
--      gate is a pair — (runtime, rules version) — so the earlier four games keep
--      exactly the sessions they had and Color Merge gets its own; anything else
--      is still `unsupported_runtime`. A Color Merge session's `tile_count` is
--      48: the field counts the moves a complete run holds, and its moves are
--      slides.
--
-- Nothing here flips the catalogue: `color-merge` stays unplayable until its own
-- flip migration, applied after the deployment carrying the runtime is live — the
-- same ordering the other four games used.
--
-- The rules themselves are documented in docs/games/README.md. Bumping them means
-- a new rules version and a new verifier function; this one keeps verifying the
-- runs whose sessions pinned it.

-- ─────────────────────────────────────────────────────────────────────────────
-- The rules, as constants the database owns
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.color_merge_rules_version()
returns text language sql immutable set search_path = '' as $$ select 'color-merge@1'::text $$;

-- Forty-eight slides: the run is bounded, so it always ends and two players'
-- scores measure the same thing.
create or replace function public.color_merge_slides()
returns integer language sql immutable set search_path = '' as $$ select 48 $$;

comment on function public.color_merge_rules_version() is
  'The Color Merge rules version the database can verify. A rules change needs a new version and a new verifier.';

comment on function public.color_merge_slides() is
  'The slides a Color Merge run holds. The deck is what guarantees a run ends.';

-- ─────────────────────────────────────────────────────────────────────────────
-- The board, as the generator both sides draw from
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Pure functions of the seed: no rows, no clock, no session. They are internals,
-- not API surface — the verifier calls them with the session's seed, and no
-- client needs them, because a client already holds its own seed and computes
-- the same board in TypeScript. Execute is therefore not granted to anyone; the
-- definer-owned verifier calls them as the function's owner.

-- One line, slid toward its leading edge: compact, merge each pair of equal
-- neighbours once, then pad with empty cells. A tile merges at most once per
-- slide, which is the rule that makes the board a puzzle rather than a cascade.
-- It returns the line and the points the line earned together, because a merge is
-- one event with two answers: the board it leaves and the tile it created. The
-- score is that tile's value — merging preserves the board's total value (two 2s
-- are worth the 4 they become), so a difference would score zero and quietly pay
-- out for the tile that is dealt instead. Splitting the merge rule into two
-- functions would be two copies of it, and copies drift.
create or replace function public.color_merge_line(
  p_line integer[],
  out merged integer[],
  out gain   bigint
)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_values integer[] := array[]::integer[];
  v_width  int := coalesce(array_length(p_line, 1), 0);
  v_index  int;
  v_shade  int;
begin
  merged := array[]::integer[];
  gain := 0;

  foreach v_shade in array coalesce(p_line, array[]::integer[]) loop
    if v_shade <> 0 then
      v_values := v_values || v_shade;
    end if;
  end loop;

  v_index := 1;
  while v_index <= coalesce(array_length(v_values, 1), 0) loop
    if v_index < array_length(v_values, 1) and v_values[v_index] = v_values[v_index + 1] then
      merged := merged || (v_values[v_index] + 1);
      gain := gain + ((1::bigint) << (v_values[v_index] + 1));
      v_index := v_index + 2;
    else
      merged := merged || v_values[v_index];
      v_index := v_index + 1;
    end if;
  end loop;

  while coalesce(array_length(merged, 1), 0) < v_width loop
    merged := merged || 0;
  end loop;
end;
$$;

-- The whole board after one slide. Directions are 0 up, 1 right, 2 down, 3 left,
-- and each line is read in the direction of travel so a merge always happens
-- against the edge the player slid toward.
create or replace function public.color_merge_slide(
  p_board     integer[],
  p_direction integer
)
returns integer[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_out     integer[] := array_fill(0, array[16]);
  v_line    integer[];
  v_merged  integer[];
  v_gain    bigint;
  v_line_no int;
  v_step    int;
  v_index   int;
begin
  if p_board is null or array_length(p_board, 1) is distinct from 16 then
    raise exception 'a Color Merge board has sixteen cells' using errcode = '22023';
  end if;
  if p_direction is null or p_direction < 0 or p_direction > 3 then
    raise exception 'a Color Merge direction is 0 to 3' using errcode = '22023';
  end if;

  for v_line_no in 0..3 loop
    v_line := array[]::integer[];
    for v_step in 0..3 loop
      v_index := case p_direction
                   when 0 then v_step * 4 + v_line_no
                   when 2 then (3 - v_step) * 4 + v_line_no
                   when 3 then v_line_no * 4 + v_step
                   else v_line_no * 4 + (3 - v_step)
                 end;
      v_line := v_line || p_board[v_index + 1];
    end loop;

    select * into v_merged, v_gain from public.color_merge_line(v_line);

    for v_step in 0..3 loop
      v_index := case p_direction
                   when 0 then v_step * 4 + v_line_no
                   when 2 then (3 - v_step) * 4 + v_line_no
                   when 3 then v_line_no * 4 + v_step
                   else v_line_no * 4 + (3 - v_step)
                 end;
      v_out[v_index + 1] := v_merged[v_step + 1];
    end loop;
  end loop;
  return v_out;
end;
$$;

-- Spawn `p_index` (1-based), as a pure function of the seed, the index and the
-- board it lands on. The generator is advanced `p_index` times to choose a cell
-- among the empties (in board order) and once more to choose the shade: one draw
-- in ten opens at shade two. A board with no empty cell comes back unchanged.
create or replace function public.color_merge_spawn(
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
  p_board[v_cell] := case when v_state % 10 = 0 then 2 else 1 end;
  return p_board;
end;
$$;

-- The board a run opens with: two tiles, drawn from the seed.
create or replace function public.color_merge_board(p_seed bigint)
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
    v_board := public.color_merge_spawn(p_seed, v_index, v_board);
  end loop;
  return v_board;
end;
$$;

-- Whether the board still has a move: an empty cell, or two equal neighbours.
create or replace function public.color_merge_can_move(p_board integer[])
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_row   int;
  v_col   int;
  v_shade int;
begin
  if p_board is null or array_length(p_board, 1) is distinct from 16 then
    raise exception 'a Color Merge board has sixteen cells' using errcode = '22023';
  end if;

  if exists (select 1 from unnest(p_board) as shade where shade = 0) then
    return true;
  end if;

  for v_row in 0..3 loop
    for v_col in 0..3 loop
      v_shade := p_board[v_row * 4 + v_col + 1];
      if v_col < 3 and p_board[v_row * 4 + v_col + 2] = v_shade then
        return true;
      end if;
      if v_row < 3 and p_board[(v_row + 1) * 4 + v_col + 1] = v_shade then
        return true;
      end if;
    end loop;
  end loop;
  return false;
end;
$$;

-- The points a slide earns: the sum of the tiles the merges created, line by
-- line. The verifier adds this and never counts a dealt tile, which is the same
-- rule the client engine applies.
create or replace function public.color_merge_gain(
  p_board     integer[],
  p_direction integer
)
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_line      integer[];
  v_merged    integer[];
  v_gain      bigint;
  v_total     bigint := 0;
  v_line_no   int;
  v_step      int;
  v_index     int;
begin
  if p_board is null or array_length(p_board, 1) is distinct from 16 then
    raise exception 'a Color Merge board has sixteen cells' using errcode = '22023';
  end if;
  if p_direction is null or p_direction < 0 or p_direction > 3 then
    raise exception 'a Color Merge direction is 0 to 3' using errcode = '22023';
  end if;

  for v_line_no in 0..3 loop
    v_line := array[]::integer[];
    for v_step in 0..3 loop
      v_index := case p_direction
                   when 0 then v_step * 4 + v_line_no
                   when 2 then (3 - v_step) * 4 + v_line_no
                   when 3 then v_line_no * 4 + v_step
                   else v_line_no * 4 + (3 - v_step)
                 end;
      v_line := v_line || p_board[v_index + 1];
    end loop;
    select * into v_merged, v_gain from public.color_merge_line(v_line);
    v_total := v_total + v_gain;
  end loop;
  return v_total;
end;
$$;

comment on function public.color_merge_board(bigint) is
  'The two tiles a Color Merge run opens with. Mirrored by src/lib/games/color-merge.ts.';

revoke all on function public.color_merge_line(integer[]) from public;
revoke all on function public.color_merge_slide(integer[], integer) from public;
revoke all on function public.color_merge_gain(integer[], integer) from public;
revoke all on function public.color_merge_spawn(bigint, integer, integer[]) from public;
revoke all on function public.color_merge_board(bigint) from public;
revoke all on function public.color_merge_can_move(integer[]) from public;

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

  -- The session pins the rules it was issued under; this verifier implements one
  -- version, and says so rather than guessing at the other.
  if v_session.rules_version is distinct from public.color_merge_rules_version() then
    v_result.outcome := 'wrong_rules';
    v_result.session_id := v_session.id;
    v_result.game_slug := v_game.slug;
    return v_result;
  end if;

  if array_length(p_actions, 1) > public.color_merge_slides() then
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
  -- 0 to 3, or a run submitted before it ended.
  v_board := public.color_merge_board(v_session.seed);
  foreach v_direction in array coalesce(p_actions, array[]::integer[]) loop
    if v_over or v_slides >= public.color_merge_slides() then
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

    -- The deck ends the run, and the last slide deals no tile: there is no next
    -- move to make with it.
    if v_slides >= public.color_merge_slides() then
      v_over := true;
    else
      v_board := public.color_merge_spawn(v_session.seed, v_slides + 2, v_board);
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
  'Replays a submitted Color Merge run from its session seed, derives the score, and records it. The claim is compared, never trusted.';

revoke all on function public.complete_color_merge_run(uuid, integer[], bigint, integer) from public;
grant execute on function public.complete_color_merge_run(uuid, integer[], bigint, integer) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Start a run: the gate learns Color Merge's (runtime, rules version) pair
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
     or (v_game.runtime = 'color-merge' and p_rules_version = public.color_merge_rules_version()) then
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
  -- Memory Flash, board taps for One Move, slides for Color Merge.
  v_empty.tile_count    := case v_game.runtime
                             when 'chain' then public.chain_taps()
                             when 'memory-flash' then public.memory_flash_taps()
                             when 'one-move' then public.one_move_taps()
                             when 'color-merge' then public.color_merge_slides()
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
