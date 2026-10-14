-- 0008 — Chain sessions: the verifier for Don't Break the Chain.
--
-- What this migration changes, and why each piece is here:
--
--   1. The rules Chain plays under, as constants the database owns:
--      `chain@1`, four pads, ten rounds, and the fifty-five taps of a perfect
--      run (1 + 2 + … + 10). A run always ends — ten rounds is the whole game —
--      so two players' scores measure the same thing.
--
--   2. `public.complete_chain_run`, the verifier. It replays the submitted taps
--      from the session's seed exactly the way `public.complete_stack10_run`
--      replays Stack 10's columns: same LCG, same seed handling, same outcome
--      vocabulary (`recorded`, `duplicate`, `score_mismatch`, …) and the same
--      ledger behaviour. Only the replay differs, because the game does: the
--      ten symbols are drawn once from the seed, round r shows the first r of
--      them, and a tap is checked against the symbol at its position within
--      its round. The first wrong tap ends the run with a loss — it is still
--      part of the submission, the way Stack 10's overflowing tile is — and
--      anything tapped after it, or a run that stops before the tenth round is
--      cleared, is refused.
--
--   3. The symbols come from the generator's high bits: `(state >> 16) % 4`. The
--      low two bits of this LCG advance by a constant, so they cycle with period
--      four — every seed would deal one of four rotations of the same pattern,
--      and round five would teach nothing round one had not. The high bits have
--      the full period, so each seed deals its own sequence. The client's engine
--      (`src/lib/games/chain.ts`) mirrors this expression digit for digit.
--
--   4. `public.start_game_session` learns the second runtime it may issue. The
--      gate is a pair — (runtime, rules version) — so Stack 10 keeps exactly the
--      sessions it had and Chain gets its own; anything else is still
--      `unsupported_runtime`. The `tile_count` of a Chain session is the taps of
--      a perfect run (55): the field counts the moves a complete run holds, and
--      Chain's moves are taps rather than tiles.
--
-- Nothing here flips the catalogue: `dont-break-the-chain` stays unplayable
-- until its own flip migration, applied after the deployment carrying the
-- runtime is live — the same ordering Stack 10 used.
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
create or replace function public.chain_rules_version()
returns text language sql immutable set search_path = '' as $$ select 'chain@1'::text $$;

-- Four pads, ten rounds, fifty-five taps in a perfect run: the board is
-- bounded, so a run always ends and two players' scores measure the same thing.
create or replace function public.chain_pads()
returns integer language sql immutable set search_path = '' as $$ select 4 $$;

create or replace function public.chain_rounds()
returns integer language sql immutable set search_path = '' as $$ select 10 $$;

create or replace function public.chain_taps()
returns integer language sql immutable set search_path = '' as $$ select 55 $$;

comment on function public.chain_rules_version() is
  'The Chain rules version the database can verify. A rules change needs a new version and a new verifier.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Complete a run: replay, verify, then record
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.complete_chain_run(
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
  v_symbols  integer[] := '{}';
  v_round    int := 1;
  v_taken    int := 0;
  v_placed   int := 0;
  v_correct  int := 0;
  v_cleared  int := 0;
  v_over     boolean := false;
  v_pad      int;
  v_i        int;
  v_digest   text;
  v_elapsed  bigint;
  v_best     bigint;
  v_rank     bigint;
begin
  if p_session_id is null then
    raise exception 'a session id is required' using errcode = '22023';
  end if;
  if p_actions is null or array_position(p_actions, null) is not null then
    raise exception 'actions must be a dense array of pad indexes' using errcode = '22023';
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
  if v_session.rules_version is distinct from public.chain_rules_version() then
    v_result.outcome := 'wrong_rules';
    v_result.session_id := v_session.id;
    v_result.game_slug := v_game.slug;
    return v_result;
  end if;

  if array_length(p_actions, 1) > public.chain_taps() then
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
  -- The symbol sequence is a function of the seed alone: the same 32-bit LCG
  -- Stack 10's deck uses, defined once here and mirrored by the client's engine
  -- (src/lib/games/chain.ts, seeds and vectors in docs/games/README.md). It is
  -- drawn once, up front: round r shows the run's first r symbols and the
  -- player taps r pads, so a tap is checked against the symbol at its position
  -- *within its round*, not against the draw at its absolute position. A wrong
  -- tap ends the run with a loss and is still part of the submission; taps after
  -- it, a pad that does not exist, or a run that stops before the tenth round
  -- is cleared make the submission impossible rather than merely bad.
  v_state := (v_session.seed % 4294967296 + 4294967296) % 4294967296;
  if v_state = 0 then
    v_state := 2654435769; -- 0x9E3779B9: a zero state would make the sequence degenerate
  end if;

  for v_i in 1..public.chain_rounds() loop
    v_state := (v_state * 1664525 + 1013904223) % 4294967296;
    v_symbols := v_symbols || (((v_state >> 16) % 4)::int);
  end loop;

  foreach v_pad in array coalesce(p_actions, array[]::integer[]) loop
    if v_over or v_placed >= public.chain_taps() then
      v_result.outcome := 'invalid_actions';
      v_result.session_id := v_session.id;
      v_result.game_slug := v_game.slug;
      return v_result;
    end if;

    if v_pad < 0 or v_pad >= public.chain_pads() then
      v_result.outcome := 'invalid_actions';
      v_result.session_id := v_session.id;
      v_result.game_slug := v_game.slug;
      return v_result;
    end if;

    v_placed := v_placed + 1;
    -- Postgres arrays are 1-based; the round's taken count is 0-based.
    if v_pad = v_symbols[v_taken + 1] then
      v_correct := v_correct + 1;
      v_taken := v_taken + 1;
      if v_taken >= v_round then
        -- The round is fully reproduced: it clears, and the next round shows
        -- one symbol more.
        v_cleared := v_cleared + 1;
        v_round := v_round + 1;
        v_taken := 0;
      end if;
    else
      v_over := true;
    end if;
  end loop;

  -- The run has to be submitted in the state it ended in: a submission that
  -- stops early is a partial run, and scoring it would let a player discard the
  -- tap that broke their chain.
  if not v_over and v_placed < public.chain_taps() then
    v_result.outcome := 'invalid_actions';
    v_result.session_id := v_session.id;
    v_result.game_slug := v_game.slug;
    return v_result;
  end if;

  -- The client's number is a claim. The database's replay is the score.
  if p_score is distinct from v_correct then
    v_result.outcome := 'score_mismatch';
    v_result.session_id := v_session.id;
    v_result.game_slug := v_game.slug;
    v_result.score := v_correct;
    return v_result;
  end if;

  update public.game_sessions s
     set completed_at    = now(),
         verified_score  = v_correct,
         verified_digest = v_digest
   where s.id = v_session.id
  returning * into v_session;

  -- Only a signed-in run becomes a ranked score. A guest run is verified and
  -- closed, and its score exists on the session alone: `scores.user_id` is NOT
  -- NULL precisely so an anonymous run cannot become somebody's personal best.
  if v_session.user_id is not null then
    insert into public.scores (session_id, game_id, user_id, score, duration_ms)
    values (v_session.id, v_session.game_id, v_session.user_id, v_correct, p_duration_ms);
  end if;

  v_result.outcome         := 'recorded';
  v_result.session_id      := v_session.id;
  v_result.game_slug       := v_game.slug;
  v_result.score           := v_correct;
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

comment on function public.complete_chain_run(uuid, integer[], bigint, integer) is
  'Replays a submitted Chain run from its session seed, derives the score, and records it. The claim is compared, never trusted.';

revoke all on function public.complete_chain_run(uuid, integer[], bigint, integer) from public;
grant execute on function public.complete_chain_run(uuid, integer[], bigint, integer) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Start a run: the gate learns Chain's (runtime, rules version) pair
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
     or (v_game.runtime = 'chain' and p_rules_version = public.chain_rules_version()) then
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
  -- The moves a complete run holds: tiles for Stack 10, taps for Chain.
  v_empty.tile_count    := case v_game.runtime
                             when 'chain' then public.chain_taps()
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
