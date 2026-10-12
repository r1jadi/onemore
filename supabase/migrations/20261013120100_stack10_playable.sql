-- 0006 — The catalogue starts telling the truth about Stack 10.
--
-- `20261013120000_play_sessions.sql` creates the verifier; this migration is the
-- other half of the same change and is deliberately separate, because the two must
-- land in a particular order:
--
--   1. apply `20261013120000_play_sessions.sql` (the schema, the functions, the
--      board) — nothing a user can see changes yet;
--   2. deploy the service that serves `/api/v1/sessions` and the client that plays
--      the game;
--   3. apply this migration.
--
-- Applied in the other order, `playable: true` would offer a Play button whose
-- only endpoint answers `503`. Applied in this order, the flip is the last step,
-- and it is the moment the product starts claiming the game can be played — a
-- claim that is backed by a runtime in the bundle, a service behind the API and a
-- verifier in the database.
--
-- Six of the seven catalogue games stay exactly as they are: non-playable, with no
-- runtime. `playable` is a statement about shipped code, so a game earns it in its
-- own migration, when its own runtime ships — not in bulk.

update public.games
   set runtime  = 'stack-10',
       playable = true,
       -- The rules as shipped, which is what the game page renders. They have to
       -- describe the game that exists: four columns, tiles that clear a column at
       -- exactly ten, a run that ends past ten, and a run of sixty tiles.
       instructions = 'Tap a column to drop the next tile. A column that adds up to exactly ten clears and scores: ten points, plus five for every extra tile in the clear. Go past ten and the run ends. A run is sixty tiles.'
 where slug = 'stack-10'
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
     where slug = 'stack-10' and playable and runtime = 'stack-10'
  ) then
    raise exception 'stack-10 is not playable after the flip: it is missing, unpublished, or its runtime is not the one this migration sets';
  end if;

  -- The other six games must not have been dragged along.
  if exists (
    select 1 from public.games
     where slug <> 'stack-10' and (playable or runtime is not null)
  ) then
    raise exception 'a game other than stack-10 is playable: runtimes ship one game at a time';
  end if;
end
$$;
