# Games

How OneMore's games work: the rules, who is allowed to decide a score, and how a
game earns the right to be called playable.

Two games are implemented today: **Stack 10** and **Chain** (Don't Break the
Chain). The other five catalogue records are published but not playable —
`playable: false`, `runtime: null` — and no screen offers to start them.

## Stack 10

Place the numbered tiles the game deals into four columns. A column that adds up to
**exactly ten** clears and scores. A column that goes **past ten** ends the run.

### The board

| Thing     | Value                                                     |
| --------- | --------------------------------------------------------- |
| Columns   | 4                                                         |
| Tiles     | 60 per run — the run always ends, so two scores measure one thing |
| Tile face | 1–9                                                       |
| Rules     | `stack-10@1`                                              |
| Runtime   | `stack-10` (the catalogue's `games.runtime` value)        |

### The deck

The tiles are not random at play time: they are a function of the run's seed, which
the **server** chooses when it issues the session. The client must produce exactly
the same sequence or its submission is refused, so the generator is written out in
full rather than described:

```
state₀ = ((seed mod 2³²) + 2³²) mod 2³²        // the seed is a bigint, reduced to 32 bits
if state₀ = 0 then state₀ = 2654435769         // 0x9E3779B9: a zero state would be degenerate
stateₙ = (stateₙ₋₁ × 1664525 + 1013904223) mod 2³²
tileₙ  = (stateₙ mod 9) + 1                    // 1..9
```

The tile a move places depends only on how many tiles have been placed, never on
which column they went into. That is why the board can show the next tile before the
player chooses — and why `tileAt(seed, n)` in the client is a pure function.

The seed is a `bigint` column: the database's default draws from the full 2⁶³ range.
It therefore travels as a **decimal string** and is reduced with integer arithmetic on
both sides. Parsing it as a double would round it, draw a different deck, and reject
every honest run — see the test that pins this.

### A move

A move is a **column index, 0–3**. The game deals the next tile, the column's total
rises, and then exactly one of three things happens:

1. **The column totals exactly ten** → it clears: the tiles disappear, the column
   resets to zero, and the move scores.
2. **The column totals more than ten** → the run is over. The move is still part of
   the run and is still submitted; it is a legal move that loses, not an invalid one.
3. **Otherwise** the column keeps its tiles and the run continues.

### Scoring

A clear scores **10, plus 5 for every tile the column was stacked with beyond the
first**:

```
clear score = 10 + 5 × (tiles cleared − 1)
```

| Tiles in the clear | Score | Example             |
| ------------------ | ----- | ------------------- |
| 1                  | 10    | unreachable with a 1–9 deck, and still spelled out |
| 2                  | 15    | `4+6`, `1+9`        |
| 3                  | 20    | `1+7+2`, `3+4+3`    |
| 4                  | 25    | `3+2+1+4`           |

Stacking is what scores: a column that clears in three is worth twice one that
clears in one, and it is also the riskier play, because the tiles sitting in it are
columns the player cannot use for the next tile.

Failing to place anything is impossible — a single tile is at most 9 — so every run
has at least one move.

### How a run ends

| Outcome   | When                                                      |
| --------- | --------------------------------------------------------- |
| `over`    | A column passed ten. The ordinary ending.                  |
| `cleared` | All sixty tiles were placed. A perfect run, and a real one: seed 1 admits at least one such line. |

The score already earned is kept. Every tile of the run must be submitted: a
submission that stops early is refused, so a player cannot discard the move that
ended their run.

### Verified scores

**The database decides the score.** The client's number is a claim that is compared,
never trusted — see
[ADR 0012](../decisions/0012-server-verified-scores.md) for why, and
`supabase/migrations/20261013120000_play_sessions.sql` for the code:

- `public.start_game_session(slug, rules, client)` issues the run: it picks the seed,
  fixes the rules version and the expiry, and reads the caller's identity from their
  token — never from an argument. It refuses an unpublished, unplayable or
  unknown game identically (`not_playable`).
- `public.complete_stack10_run(session, actions, score, duration)` replays the action
  list from the session's seed, derives the score, compares it with the claim, and
  only then closes the session and records it.

Outcomes the API maps onto HTTP:

| Verifier outcome                        | HTTP | What it means to the player                                                  |
| --------------------------------------- | ---- | ---------------------------------------------------------------------------- |
| `recorded`                              | 200  | Verified and saved.                                                          |
| `duplicate`                             | 200  | The same run, submitted again — a retry. Safe, and it never scores twice.     |
| `not_found`                             | 404  | No such run, or somebody else's — deliberately the same answer.               |
| `expired`, `abandoned`, `closed`        | 409  | The run can no longer be submitted; start a new one.                          |
| `wrong_rules`                           | 409  | The session was pinned to rules this server does not implement.               |
| `invalid_actions`, `invalid_duration`   | 422  | The sequence is not one the rules can produce.                                |
| `score_mismatch`                        | 422  | The replay disagrees with the claimed score. The replayed number is returned. |

A guest can play. Their run is verified and closed exactly like a signed-in
player's, and it is never ranked: `scores.user_id` is `NOT NULL`, so there is no row
for it to become. The same run cannot later be claimed by a signed-in caller.

### Test vectors

Three vectors pin the rules to the database's own arithmetic. The first two are
asserted by the SQL suite and by the client engine; if either side drifts, one of the
two suites fails.

1. **Seed 1's deck** — `1, 7, 9, 2, 2, 5, 4, 6, 7, 8, 3, 4, 3, 5, …`
2. **Seed 1, the greedy line** `0,0,1,0,0,0,2,2,2,3,0,0,0,0` — 14 tiles, three clears
   (`1+7+2` = 20, `4+6` = 15, `3+4+3` = 20), **55 points**, and a run that ends when
   the fourteenth tile (a 5) takes a column holding 7 to 12. Asserted in
   [`tests/security/rls_test.sql`](../../tests/security/rls_test.sql) and in
   [`src/lib/games/stack10.test.ts`](../../src/lib/games/stack10.test.ts).
3. **Seed 1, a perfect line** — the sixty tiles in the order above, for **420
   points**: twenty-five clears, none deeper than three tiles, and one tile left on
   the board at the end. It is the best that deck allows, which a search over its
   reachable states confirms. Asserted by the client engine and used as the
   play-screen test's full run.
4. **A full-width seed** — `9223372036854775807` deals `6, 2, 9, 4, 5, 3, 6, 1, …`,
   which is what catches a client that rounded the seed to a double.

### Changing the rules

The rules version is data, not a comment. A session pins the version it was issued
under, and the verifier only replays versions it implements, so:

1. add a new rules version string (`stack-10@2`),
2. add the new verifier function rather than editing `complete_stack10_run`,
3. update the client engine, the vectors above and this document,
4. sessions pinned to `stack-10@1` keep being verified by the function that
   implements it.

Editing `stack-10@1` in place would silently re-grade every open session and every
stored score.

## Chain

Watch the flashing sequence, then tap the pads back in the same order. Each round
shows one symbol more than the last; a wrong tap breaks the chain and ends the run.

### The board

| Thing     | Value                                                     |
| --------- | --------------------------------------------------------- |
| Pads      | 4                                                         |
| Rounds    | 10 per run — the run always ends, so two scores measure one thing |
| Taps      | 55 in a perfect run (1 + 2 + … + 10)                      |
| Rules     | `chain@1`                                                 |
| Runtime   | `chain` (the catalogue's `games.runtime` value)           |

### The sequence

The symbols are not random at play time: they are a function of the run's seed, which
the **server** chooses when it issues the session. The client must reproduce exactly
the same sequence or its submission is refused, so the generator is written out in
full rather than described:

```
state₀ = ((seed mod 2³²) + 2³²) mod 2³²        // the seed is a bigint, reduced to 32 bits
if state₀ = 0 then state₀ = 2654435769         // 0x9E3779B9: a zero state would be degenerate
stateₙ = (stateₙ₋₁ × 1664525 + 1013904223) mod 2³²
symbolₙ = (stateₙ >> 16) mod 4                 // 0..3
```

The state progression is the same LCG Stack 10's deck uses; only the digit read out
of each state differs, and deliberately so: the low two bits of this generator
advance by a constant, so reading them would deal every seed one of four rotations
of the same pattern (`0,3,2,1,…`) and round five would teach nothing round one had
not. The higher bits have the full period, so each seed deals its own sequence.

The seed travels as a **decimal string** for the same reason Stack 10's does: it is a
`bigint` column, and parsing it as a double would round it, deal a different
sequence, and reject every honest run.

### A move

A move is a **pad index, 0–3**. Round r shows the run's first r symbols, and the
player taps r pads — so a tap is checked against the symbol at its position *within
its round*, not at its absolute position: the third tap of round three must equal the
sequence's third symbol, the way the verifier replays it. Exactly one of two things
happens:

1. **The tap matches** → the run continues. Completing a round clears it.
2. **The tap does not match** → the chain is broken and the run is over. The losing
   tap is still part of the run and is still submitted; it is a legal tap that
   loses, not an invalid one.

### Scoring

A correct tap scores **1 point**. The score of a run is its correct taps: 55 for a
perfect run, 3 for a run that reproduces rounds one and two and then breaks the
chain. Failing to tap anything is impossible — round one is a single pad — so every
run has at least one move.

### How a run ends

| Outcome   | When                                                      |
| --------- | --------------------------------------------------------- |
| `over`    | A tap broke the chain. The ordinary ending.                |
| `cleared` | All ten rounds were reproduced — all fifty-five taps.      |

The score already earned is kept. Every tap of the run must be submitted, losing tap
included: a submission that stops early is refused, so a player cannot discard the
tap that broke their chain.

### Verified scores

**The database decides the score**, under the same rules as Stack 10: see
`supabase/migrations/20261014120000_chain_sessions.sql` for the code:

- `public.start_game_session(slug, rules, client)` issues the run with the seed, the
  pinned version and the expiry. Its gate is a pair — (`stack-10`, `stack-10@1`) or
  (`chain`, `chain@1`) — and anything else is `unsupported_runtime`. A Chain
  session's `tile_count` is 55: the field counts the moves a complete run holds, and
  Chain's moves are taps rather than tiles.
- `public.complete_chain_run(session, actions, score, duration)` draws the ten
  symbols once, replays the tap list round by round, derives the score, compares it
  with the claim, and only then closes the session and records it. Its outcome
  vocabulary (`recorded`, `duplicate`, `score_mismatch`, …) and its ledger behaviour
  are identical to Stack 10's, and the Go service maps them onto HTTP the same way —
  routing at the verifier the pinned rules version names.

A guest can play. Their run is verified and closed exactly like a signed-in
player's, and it is never ranked.

### Test vectors

Three vectors pin the rules to the database's own arithmetic. Each is asserted by
the SQL suite and by the client engine; if either side drifts, one of the two
suites fails.

1. **Seed 1's sequence** — `0, 0, 2, 3, 0, 0, 2, 2, 0, 1`
2. **Seed 1, the perfect line** — round 1 `[0]`, round 2 `[0,0]`, …, round 10 the
   first ten symbols: 55 taps, ten clears, **55 points**. Asserted in
   [`tests/security/rls_test.sql`](../../tests/security/rls_test.sql) and in
   [`src/lib/games/chain.test.ts`](../../src/lib/games/chain.test.ts).
3. **Seed 1, the broken chain** — `0, 0, 0, 1`: rounds one and two reproduced, then
   the wrong tap. **3 points**, 4 taps placed, 2 rounds cleared. Asserted in both
   suites.
4. **A full-width seed** — `9223372036854775807` deals `1, 3, 3, 3, 1, 0, 1, 0, …`,
   which is what catches a client that rounded the seed to a double.
