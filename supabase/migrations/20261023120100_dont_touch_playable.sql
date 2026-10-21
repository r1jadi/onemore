-- 0021 — The catalogue starts telling the truth about Don't Touch the Black.
--
-- `20261023120000_dont_touch_sessions.sql` creates the verifier; this migration
-- is the other half of the same change and is deliberately separate, because the
-- two must land in a particular order:
--
--   1. apply `20261023120000_dont_touch_sessions.sql` (the verifier, and the
--      start gate learning the game's runtime) — nothing a user can see changes
--      yet;
--   2. deploy the service that routes `dont-touch@1` completions to the new
--      verifier and the client that plays the game;
--   3. apply this migration.
--
-- Applied in the other order, `playable: true` would offer a Play button whose
-- runs no deployment can verify yet. Applied in this order, the flip is the last
-- step, and it is the moment the product starts claiming the game can be played —
-- a claim backed by a runtime in the bundle, a service behind the API and a
-- verifier in the database.
--
-- One of the seven catalogue games stays exactly as it is: 7 Second is published,
-- non-playable and has no runtime. `playable` is a statement about shipped code,
-- so a game earns it in its own migration, when its own runtime ships.

update public.games
   set runtime  = 'dont-touch',
       playable = true,
       -- The rules as shipped, which is what the game page renders. They have to
       -- describe the game that exists: twenty rows of three lanes rising to a
       -- line, white tiles scoring, a black tile ending the run, and rows that
       -- speed up as the deck goes on.
       instructions = 'Tap the white tiles in the row at the line. Number keys 1–3 or A–D work too. Never touch a black tile: one black tap ends the run on the spot. Twenty rows, each faster than the last; a white tile that passes is lost, not fatal.'
 where slug = 'dont-touch-the-black'
   -- Idempotent, and honest about what it is for: only a published game becomes
   -- playable, and only the one whose runtime this repository actually ships.
   and status = 'published';

-- The database enforces the invariant this relies on — `playable` implies a
-- runtime — so a typo in the slug above could not quietly publish a game nobody
-- can play. Asserting it here turns that into a failed migration instead of a
-- silent no-op, which is the difference between a deploy that stops and a
-- catalogue that lies.
do $$
begin
  if not exists (
    select 1 from public.games
     where slug = 'dont-touch-the-black' and playable and runtime = 'dont-touch'
  ) then
    raise exception 'dont-touch-the-black is not playable after the flip: it is missing, unpublished, or its runtime is not the one this migration sets';
  end if;

  -- The earlier flips must still hold: runtimes ship one game at a time, and a
  -- later flip must not drag anything else along.
  if not exists (
    select 1 from public.games
     where slug = 'stack-10' and playable and runtime = 'stack-10'
  ) then
    raise exception 'stack-10 stopped being playable: a later flip must not unflip a shipped runtime';
  end if;

  if not exists (
    select 1 from public.games
     where slug = 'dont-break-the-chain' and playable and runtime = 'chain'
  ) then
    raise exception 'dont-break-the-chain stopped being playable: a later flip must not unflip a shipped runtime';
  end if;

  if not exists (
    select 1 from public.games
     where slug = 'memory-flash' and playable and runtime = 'memory-flash'
  ) then
    raise exception 'memory-flash stopped being playable: a later flip must not unflip a shipped runtime';
  end if;

  if not exists (
    select 1 from public.games
     where slug = 'one-move' and playable and runtime = 'one-move'
  ) then
    raise exception 'one-move stopped being playable: a later flip must not unflip a shipped runtime';
  end if;

  if not exists (
    select 1 from public.games
     where slug = 'color-merge' and playable and runtime = 'color-merge'
  ) then
    raise exception 'color-merge stopped being playable: a later flip must not unflip a shipped runtime';
  end if;

  -- The game that is still waiting for its own runtime must stay waiting: this
  -- migration claims one game, not the whole catalogue.
  if exists (
    select 1 from public.games
     where slug = '7-second' and (playable or runtime is not null)
  ) then
    raise exception '7-second is playable or carries a runtime: this flip ships one game, not two';
  end if;

  if exists (
    select 1 from public.games
     where slug not in (
       'stack-10', 'dont-break-the-chain', 'memory-flash', 'one-move',
       'color-merge', 'dont-touch-the-black'
     )
       and (playable or runtime is not null)
  ) then
    raise exception 'a game other than the six shipped runtimes is playable: runtimes ship one game at a time';
  end if;
end
$$;
