-- 0009 — The catalogue starts telling the truth about Chain.
--
-- `20261014120000_chain_sessions.sql` creates the verifier; this migration is
-- the other half of the same change and is deliberately separate, because the
-- two must land in a particular order:
--
--   1. apply `20261014120000_chain_sessions.sql` (the verifier, and the start
--      gate learning Chain's runtime) — nothing a user can see changes yet;
--   2. deploy the service that routes `chain@1` completions to the new verifier
--      and the client that plays the game;
--   3. apply this migration.
--
-- Applied in the other order, `playable: true` would offer a Play button whose
-- runs no deployment can verify yet. Applied in this order, the flip is the
-- last step, and it is the moment the product starts claiming the game can be
-- played — a claim that is backed by a runtime in the bundle, a service behind
-- the API and a verifier in the database.
--
-- Five of the seven catalogue games stay exactly as they are: non-playable,
-- with no runtime. `playable` is a statement about shipped code, so a game
-- earns it in its own migration, when its own runtime ships — not in bulk.

update public.games
   set runtime  = 'chain',
       playable = true,
       -- The rules as shipped, which is what the game page renders. They have
       -- to describe the game that exists: four pads, a sequence that grows by
       -- one symbol each round, ten rounds, and a run that ends on the first
       -- wrong tap.
       instructions = 'Watch the flashing sequence, then tap the pads back in the same order. Each round adds one more step, up to ten rounds. A wrong tap breaks the chain and ends the run, and the taps so far are your score. Survive all ten rounds to clear it.'
 where slug = 'dont-break-the-chain'
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
     where slug = 'dont-break-the-chain' and playable and runtime = 'chain'
  ) then
    raise exception 'chain is not playable after the flip: it is missing, unpublished, or its runtime is not the one this migration sets';
  end if;

  -- Stack 10's flip must still hold: runtimes ship one game at a time, and a
  -- later flip must not drag anything else along.
  if not exists (
    select 1 from public.games
     where slug = 'stack-10' and playable and runtime = 'stack-10'
  ) then
    raise exception 'stack-10 stopped being playable: a later flip must not unflip a shipped runtime';
  end if;

  if exists (
    select 1 from public.games
     where slug not in ('stack-10', 'dont-break-the-chain') and (playable or runtime is not null)
  ) then
    raise exception 'a game other than stack-10 and chain is playable: runtimes ship one game at a time';
  end if;
end
$$;
