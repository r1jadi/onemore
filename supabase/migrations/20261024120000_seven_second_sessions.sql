-- 0022 — 7 Second sessions: the verifier for the seventh runtime.
--
-- What this migration changes, and why each piece is here:
--
--   1. The rules 7 Second plays under, as constants the database owns:
--      `seven-second@1`, three choices per challenge, and at most sixty answers
--      in a submission. The answer cap is both the contract's global bound and
--      the point where a run ends: no one answers sixty arithmetic challenges in
--      seven seconds, but an answer machine must still meet an ending.
--
--   2. The daily deck, as the generator both sides draw from. `seven_second_seed`
--      derives today's seed from the UTC date, so everybody who plays on the same
--      day gets the same challenges — that is what makes a daily score comparable
--      — and nobody can choose their own deck. `seven_second_state` draws the
--      challenge at an index directly from the seed, exactly as the client engine
--      does, so the two cannot drift by one draw.
--
--   3. `public.complete_seven_second_run`, the verifier. It replays the submitted
--      choice list from the session's seed, scoring ten points per correct answer,
--      with the same outcome vocabulary and ledger behaviour as the other six.
--      Time is *not* replayed: the clock decides when a run ends, never what an
--      answer is worth, so a run is valid with any number of answers from zero to
--      sixty.
--
--   4. `public.start_game_session` learns the seventh runtime it may issue, and
--      its daily gate. A signed-in player gets one ranked attempt per calendar
--      day: a completed session for today's seed answers `already_played`, and no
--      new run is issued. Guests are not gated — their runs are verified but
--      never ranked, so repeated practice cannot put a score on a board.
--
-- Nothing here flips the catalogue: `7-second` stays unplayable until its own
-- flip migration, applied after the deployment carrying this runtime is live —
-- the same ordering the other six games used.
--
-- The rules themselves are documented in docs/games/README.md. Bumping them means
-- a new rules version and a new verifier function; this one keeps verifying the
-- runs whose sessions pinned it.

-- ─────────────────────────────────────────────────────────────────────────────
-- The rules, as constants the database owns
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.seven_second_rules_version()
returns text language sql immutable set search_path = '' as $$ select 'seven-second@1'::text $$;

-- Three buttons: one right and two wrong.
create or replace function public.seven_second_options()
returns integer language sql immutable set search_path = '' as $$ select 3 $$;

-- The most answers a submission can hold, and where a run is forced to end.
create or replace function public.seven_second_answers()
returns integer language sql immutable set search_path = '' as $$ select 60 $$;

comment on function public.seven_second_rules_version() is
  'The 7 Second rules version the database can verify. A rules change needs a new version and a new verifier.';

comment on function public.seven_second_options() is
  'The choices each 7 Second challenge offers: one right and two wrong.';

comment on function public.seven_second_answers() is
  'The answers a 7 Second submission may hold. The cap is what guarantees a run ends.';

-- ─────────────────────────────────────────────────────────────────────────────
-- The daily deck, as the generator both sides draw from
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `seven_second_seed` is the one function here a client never needs: the seed is
-- handed to it in the session. It is stable, not immutable — it changes when the
-- UTC date does — and it is deliberately not executable by clients, because a
-- caller who could ask for a seed would still not gain a deck (the seed is public
-- the moment a session is issued), but there is no reason to widen the surface.

create or replace function public.seven_second_seed()
returns bigint
language sql
stable
set search_path = ''
as $$
  -- Days since the epoch, hashed once with the same odd multiplier the engine's
  -- generator uses, plus a non-zero offset. A day-based seed is what makes the
  -- challenge "daily": yesterday's deck is a different deck, and today's is one
  -- deck shared by every player.
  select ((extract(epoch from (now() at time zone 'utc')::date)::bigint / 86400) * 2654435761 + 7)
$$;

comment on function public.seven_second_seed() is
  'The seed of the UTC day''s 7 Second deck. Every player gets the same one, so daily scores measure the same challenges.';

-- Pure function of the seed and an answer index: no rows, no clock, no session.
-- It is an internal, not API surface — the verifier calls it with the session's
-- seed, and no client needs it, because a client already holds its own seed and
-- computes the same challenge in TypeScript. Execute is therefore not granted to
-- anyone; the definer-owned verifier calls it as the function's owner.
--
-- The same 32-bit LCG the other games use, with the same zero-state fallback and
-- the same handling of a negative seed, because a seed that differs by one bit
-- poses a different challenge.
create or replace function public.seven_second_state(p_seed bigint, p_index integer)
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_state bigint := (p_seed % 4294967296 + 4294967296) % 4294967296;
  v_draw  int;
begin
  if p_index is null or p_index < 0 or p_index >= public.seven_second_answers() then
    raise exception 'invalid challenge index' using errcode = '22023';
  end if;

  if v_state = 0 then
    v_state := 2654435769;
  end if;

  -- Challenge k is drawn after k + 1 advances, so the first is the one both
  -- copies read first and neither can drift by one draw.
  for v_draw in 0..p_index loop
    v_state := (v_state * 1664525 + 1013904223) % 4294967296;
  end loop;

  return v_state;
end;
$$;

-- The index of the right button for the challenge at a position in the deck.
--
-- The order of the three answers is the state modulo three, and the client places
-- the right answer at the same index. That is all the verifier needs from the
-- values: whether the submitted choice is the correct one. The subtraction the
-- deck poses is non-negative on both sides, and a challenge's options are all
-- distinct, which the client's tests pin.
create or replace function public.seven_second_correct(p_seed bigint, p_index integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select (public.seven_second_state(p_seed, p_index) % public.seven_second_options())::integer
$$;

comment on function public.seven_second_correct(bigint, integer) is
  'The index of the correct choice for one 7 Second challenge. Mirrors the client engine, digit for digit.';

-- Internals, not API surface: the client already holds its seed and computes the
-- same deck, and the only legitimate callers are the definer-owned verifier and
-- the start gate. Postgres grants execute to PUBLIC by default, so the revoke is
-- the part that makes the comment true.
revoke all on function public.seven_second_state(bigint, integer) from public;
revoke all on function public.seven_second_correct(bigint, integer) from public;
revoke all on function public.seven_second_seed() from public;

-- ─────────────────────────────────────────────────────────────────────────────
-- The verifier
-- ─────────────────────────────────────────────────────────────────────────────
--
-- The submitted choices are claims. The replay is the score. A client that
-- computes a different number is refused with `score_mismatch`, and the number
-- this function derived comes back so the screen can say what the run was worth.
create or replace function public.complete_seven_second_run(
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
  v_score    bigint := 0;
  v_cleared  int := 0;
  v_choices  int := 0;
  v_choice   integer;
  v_digest   text;
  v_elapsed  bigint;
  v_best     bigint;
  v_rank     bigint;
begin
  if p_session_id is null then
    raise exception 'a session id is required' using errcode = '22023';
  end if;
  if p_actions is null or array_position(p_actions, null) is not null then
    raise exception 'actions must be a dense array of choices' using errcode = '22023';
  end if;
  if p_duration_ms is null or p_duration_ms < 1 then
    raise exception 'duration must be a positive number of milliseconds' using errcode = '22023';
  end if;

  -- Read without locking first, only to learn the key to serialize on. The
  -- daily ledger lock has to be taken before the session row, or a completion
  -- holding the row and a start holding the ledger lock could wait on each other.
  select * into v_session from public.game_sessions s where s.id = p_session_id;

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

  -- One score per player per day's deck is a serialization problem, not a
  -- read-then-write one. The start gate takes this same transaction-scoped lock,
  -- so a completion and a start (or two completions) meet here in a fixed order:
  -- the second one sees the first one's commit instead of racing past it.
  if v_game.runtime = 'seven-second' and v_session.user_id is not null then
    perform pg_advisory_xact_lock(
      hashtextextended(v_session.game_id::text || ':' || v_session.user_id::text, 0)
    );
  end if;

  -- Locked: two completions racing for one session must meet here, not both pass
  -- the "already closed" check and then both insert.
  select * into v_session from public.game_sessions s where s.id = p_session_id for update;
  if not found then
    -- The row can only disappear through a cascade after the read above; it is
    -- still not the caller's run, so it answers like a missing session.
    v_result.outcome := 'not_found';
    v_result.session_id := p_session_id;
    return v_result;
  end if;

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
  if v_session.rules_version is distinct from public.seven_second_rules_version() then
    v_result.outcome := 'wrong_rules';
    v_result.session_id := v_session.id;
    v_result.game_slug := v_game.slug;
    return v_result;
  end if;

  -- The ledger's own daily guard, now under the lock above. Only one score may
  -- exist per player per day's deck: the second completion is refused even if its
  -- session was issued before the first one finished.
  if v_session.user_id is not null and exists (
    select 1
      from public.game_sessions s
     where s.game_id = v_session.game_id
       and s.user_id = v_session.user_id
       and s.seed = v_session.seed
       and s.id <> v_session.id
       and s.completed_at is not null
  ) then
    v_result.outcome := 'already_played';
    v_result.session_id := v_session.id;
    v_result.game_slug := v_game.slug;
    return v_result;
  end if;

  if array_length(p_actions, 1) > public.seven_second_answers() then
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
  -- Every choice must be a button the screen offered, and the answer it was
  -- given against is the challenge at that position. A right answer scores ten;
  -- a wrong one scores nothing. A submission may stop anywhere: the clock is the
  -- ordinary ending, and this verifier has no clock to disagree with.
  foreach v_choice in array coalesce(p_actions, array[]::integer[]) loop
    if v_choice < 0 or v_choice >= public.seven_second_options() then
      v_result.outcome := 'invalid_actions';
      v_result.session_id := v_session.id;
      v_result.game_slug := v_game.slug;
      return v_result;
    end if;

    if v_choice = public.seven_second_correct(v_session.seed, v_choices) then
      v_cleared := v_cleared + 1;
      v_score := v_score + 10;
    end if;

    v_choices := v_choices + 1;
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
  v_result.tiles_placed    := v_choices;
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

comment on function public.complete_seven_second_run(uuid, integer[], bigint, integer) is
  'Replays a submitted 7 Second answer line from its session seed, derives the score, and records it. The claim is compared, never trusted.';

revoke all on function public.complete_seven_second_run(uuid, integer[], bigint, integer) from public;
grant execute on function public.complete_seven_second_run(uuid, integer[], bigint, integer) to anon, authenticated;

comment on type public.play_result is
  'The outcome of completing a run. `outcome` is `recorded`, `duplicate`, `expired`, `abandoned`, `closed`, '
  '`anonymous_session`, `wrong_rules`, `invalid_actions`, `invalid_duration` or `score_mismatch`; '
  '`already_played` is a second completion of a daily deck; `not_found` covers a session that is missing or belongs to somebody else.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Start a run: the gate learns 7 Second's pair, and its daily limit
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
    insert into public.game_sessions (game_id, user_id, client, rules_version)
    values (v_game.id, v_user, v_client, p_rules_version)
    returning * into v_session;
  end if;

  v_empty.outcome       := 'started';
  v_empty.id            := v_session.id;
  v_empty.game_slug     := v_game.slug;
  v_empty.rules_version := v_session.rules_version;
  v_empty.seed          := v_session.seed;
  -- The moves a complete run holds: tiles for Stack 10, taps for Chain and
  -- Memory Flash, board taps for One Move, slides for Color Merge, rows for
  -- Don't Touch the Black, and answers for 7 Second.
  v_empty.tile_count    := case v_game.runtime
                             when 'chain' then public.chain_taps()
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
  'Issues a play session with a server-chosen seed. The caller identity is the verified token, never an argument. 7 Second also answers already_played once the signed-in player has finished today''s deck.';

revoke all on function public.start_game_session(text, text, text) from public;
grant execute on function public.start_game_session(text, text, text) to anon, authenticated;

comment on type public.session_start is
  'The result of asking for a session. `outcome` is `started`, `not_playable`, `unsupported_runtime` or `already_played`.';
