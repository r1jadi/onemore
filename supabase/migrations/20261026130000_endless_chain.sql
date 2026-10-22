-- Endless Chain — a game with no final round.
--
-- `20261014120000_chain_sessions.sql` shipped Chain as a ten-round run: 55 taps,
-- a `cleared` outcome when the tenth round was reproduced, and a verifier that
-- refused a submission shorter than that. This migration makes the run endless
-- and deliberately keeps the old rules verifiable:
--
--   - **`chain@2` is the new rules version.** Round r still shows the sequence's
--     first r symbols and the player repeats all r of them; a correct tap still
--     scores one point and a wrong tap still ends the run. What changed is that
--     there is always a next round, so a submission always ends with the losing
--     tap and the score is how far the player got. The server's replay loop is
--     the same loop, with the fixed ten-round draw replaced by a lazy draw that
--     grows with the round.
--   - **`chain@1` keeps verifying exactly as it did.** Sessions issued before
--     this migration may still be completed, and the old 55-tap perfect run is
--     still accepted as `cleared`. Only the version string chooses the rules, so
--     no run is retroactively re-graded.
--   - **The submission bound is not a level.** A run may carry at most 4096 taps
--     (a transport and replay bound, far beyond a session's lifetime); an endless
--     run has no complete length, so this is a ceiling on one request, not a
--     final stage.
--   - **Starting a run accepts both versions**, and a `chain@2` session lives for
--     twelve hours instead of two so a genuinely long run is not cut off by the
--     session clock. Every other game keeps its two-hour session.
--
-- The sequence generator, the seed handling, the score rule and the ledger are
-- untouched. See docs/games/README.md for the rules and the pinned vectors.

-- ─────────────────────────────────────────────────────────────────────────────
-- The rules, as constants the database owns
-- ─────────────────────────────────────────────────────────────────────────────

-- The version a new session pins. `chain@1` remains a literal in the verifier:
-- the old rules are history, not a constant that moves.
create or replace function public.chain_rules_version()
returns text language sql immutable set search_path = '' as $$ select 'chain@2'::text $$;

-- Four pads. Unchanged, and shared by both versions.
create or replace function public.chain_pads()
returns integer language sql immutable set search_path = '' as $$ select 4 $$;

-- `chain@1`'s ten rounds and fifty-five taps are no longer how a new run is
-- measured, but the legacy branch still needs them. They are kept, and named
-- for what they are.
create or replace function public.chain_rounds()
returns integer language sql immutable set search_path = '' as $$ select 10 $$;

create or replace function public.chain_taps()
returns integer language sql immutable set search_path = '' as $$ select 55 $$;

-- The most taps one submission may carry. This bounds a request, not a game:
-- an endless run has no complete length, and this is far past any run a session
-- could still be open for.
create or replace function public.chain_max_actions()
returns integer language sql immutable set search_path = '' as $$ select 4096 $$;

comment on function public.chain_rules_version() is
  'The Chain rules version new sessions pin. chain@2 is endless; chain@1 runs are still verified. A rules change needs a new version and a new verifier branch.';
comment on function public.chain_rounds() is
  'The legacy chain@1 rules: ten rounds. chain@2 has no round count.';
comment on function public.chain_taps() is
  'The legacy chain@1 rules: fifty-five taps in a perfect run. chain@2 has no complete length; see chain_max_actions().';
comment on function public.chain_max_actions() is
  'The most taps a Chain submission may carry. A request bound for the endless game, not a final round.';

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
  -- Which of the two rulesets this session pinned, and the submission bound it
  -- carries: 55 for the legacy ten-round game, 4096 for the endless one.
  v_endless  boolean := false;
  v_max      int;
  v_pad      int;
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

  -- The session pins the rules it was issued under. Two versions are
  -- implemented: the legacy ten-round game, and the endless one. The version
  -- chooses the rules; a session under anything else is refused rather than
  -- guessed at.
  if v_session.rules_version = 'chain@1' then
    v_max := public.chain_taps();
  elsif v_session.rules_version = public.chain_rules_version() then
    v_endless := true;
    v_max := public.chain_max_actions();
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
  -- The symbol sequence is a function of the seed alone: the same 32-bit LCG
  -- Stack 10's deck uses, defined once here and mirrored by the client's engine
  -- (src/lib/games/chain.ts, seeds and vectors in docs/games/README.md). Round r
  -- shows the run's first r symbols and the player taps r pads, so a tap is
  -- checked against the symbol at its position *within its round*, not against
  -- the draw at its absolute position. Symbols are drawn lazily, one round at a
  -- time: the legacy game needed ten draws up front, and the endless game has no
  -- number of rounds to draw for in advance. A wrong tap ends the run with a loss
  -- and is still part of the submission; taps after it, a pad that does not
  -- exist, or a non-endless run that stops before its last tap make the
  -- submission impossible rather than merely bad.
  v_state := (v_session.seed % 4294967296 + 4294967296) % 4294967296;
  if v_state = 0 then
    v_state := 2654435769; -- 0x9E3779B9: a zero state would make the sequence degenerate
  end if;

  foreach v_pad in array coalesce(p_actions, array[]::integer[]) loop
    if v_over or v_placed >= v_max then
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

    -- Draw until the current round has every symbol it will show. Round r needs
    -- r symbols and symbols are drawn in order, so this is exactly the
    -- sequence's prefix: the verifier never draws a symbol it does not compare,
    -- and the first ten draws are the same ten the legacy game made.
    while coalesce(array_length(v_symbols, 1), 0) < v_round loop
      v_state := (v_state * 1664525 + 1013904223) % 4294967296;
      v_symbols := v_symbols || (((v_state >> 16) % 4)::int);
    end loop;

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

  -- The run has to be submitted in the state it ended in. Under chain@1 that is
  -- the full fifty-five taps or the losing tap; a shorter no-loss submission is
  -- a partial run. Under chain@2 there is no complete length, so a submission
  -- that never lost is not a run that ended at all. Either way, scoring a
  -- prefix would let a player discard the tap that broke their chain.
  if not v_over and (v_endless or v_placed < v_max) then
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
  'Replays a submitted Chain run from its session seed, derives the score, and records it. chain@1 runs end at ten rounds; chain@2 runs end only when a tap breaks the chain. The claim is compared, never trusted.';

revoke all on function public.complete_chain_run(uuid, integer[], bigint, integer) from public;
grant execute on function public.complete_chain_run(uuid, integer[], bigint, integer) to anon, authenticated;

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
  -- implements. Chain has two — the endless version new runs pin, and the
  -- legacy finite version a session opened before this migration still holds.
  -- Anything else is a version no verifier owns.
  if (v_game.runtime = 'stack-10' and p_rules_version = public.stack10_rules_version())
     or (v_game.runtime = 'chain'
         and p_rules_version in ('chain@1', public.chain_rules_version()))
     or (v_game.runtime = 'memory-flash' and p_rules_version = public.memory_flash_rules_version())
     or (v_game.runtime = 'one-move' and p_rules_version = public.one_move_rules_version())
     or (v_game.runtime = 'color-merge' and p_rules_version = public.color_merge_rules_version())
     or (v_game.runtime = 'dont-touch' and p_rules_version = public.dont_touch_rules_version())
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
    -- the chain, not when the clock does. Every other game keeps two hours.
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
  -- Don't Touch the Black, and answers for 7 Second. Chain is endless, so a
  -- chain@2 session reports the submission bound — there is no complete run to
  -- count — while a legacy chain@1 session still reports its fifty-five taps.
  v_empty.tile_count    := case v_game.runtime
                             when 'chain' then
                               case when p_rules_version = 'chain@1'
                                    then public.chain_taps()
                                    else public.chain_max_actions()
                               end
                             when 'memory-flash' then public.memory_flash_taps()
                             when 'one-move' then public.one_move_taps()
                             when 'color-merge' then public.color_merge_slides()
                             when 'dont-touch' then public.dont_touch_cells()
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
  'Issues a play session with a server-chosen seed. The caller identity is the verified token, never an argument. Chain accepts chain@1 (legacy) and chain@2 (endless); 7 Second also answers already_played once the signed-in player has finished today''s deck.';

revoke all on function public.start_game_session(text, text, text) from public;
grant execute on function public.start_game_session(text, text, text) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- The catalogue tells the truth about the game it offers
-- ─────────────────────────────────────────────────────────────────────────────

-- The game page renders this, so it has to describe the run that now exists: no
-- final round, no "clear it", and a beat that quickens as the sequence grows.
update public.games
   set instructions = 'Watch the flashing sequence, then tap the pads back in the same order. Every round adds one more step and the beat gets a little quicker, with no final round — keep going until a wrong tap breaks the chain. Each correct tap scores one point, and the taps you got are your score.'
 where slug = 'dont-break-the-chain'
   and status = 'published';

do $$
begin
  if not exists (
    select 1 from public.games
     where slug = 'dont-break-the-chain' and playable and runtime = 'chain'
  ) then
    raise exception 'chain is not playable: this migration must not have been applied to a catalogue that offers the game';
  end if;
end
$$;
