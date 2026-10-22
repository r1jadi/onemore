# Games

How Unbored's games work: the rules, who is allowed to decide a score, and how a
game earns the right to be called playable.

Seven games are implemented today: **Stack 10**, **Chain** (Don't Break the
Chain), **Memory Flash**, **One Move**, **Color Merge**, **Don't Touch the Black**
and **7 Second**. Two of them — Chain and Don't Touch the Black — are endless, with
no final round or row. Every catalogue record is playable, and each one names the
runtime that plays it; the "no runtime yet" screen remains for any future entry
that is published before its runtime ships.

## Stack 10

Place the numbered tiles the game deals into four columns. A column that adds up to
**exactly ten** clears and scores. A column that goes **past ten** ends the run.

### The board

| Thing     | Value                                                             |
| --------- | ----------------------------------------------------------------- |
| Columns   | 4                                                                 |
| Tiles     | 60 per run — the run always ends, so two scores measure one thing |
| Tile face | 1–9                                                               |
| Rules     | `stack-10@1`                                                      |
| Runtime   | `stack-10` (the catalogue's `games.runtime` value)                |

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

| Tiles in the clear | Score | Example                                            |
| ------------------ | ----- | -------------------------------------------------- |
| 1                  | 10    | unreachable with a 1–9 deck, and still spelled out |
| 2                  | 15    | `4+6`, `1+9`                                       |
| 3                  | 20    | `1+7+2`, `3+4+3`                                   |
| 4                  | 25    | `3+2+1+4`                                          |

Stacking is what scores: a column that clears in three is worth twice one that
clears in one, and it is also the riskier play, because the tiles sitting in it are
columns the player cannot use for the next tile.

Failing to place anything is impossible — a single tile is at most 9 — so every run
has at least one move.

### How a run ends

| Outcome   | When                                                                                              |
| --------- | ------------------------------------------------------------------------------------------------- |
| `over`    | A column passed ten. The ordinary ending.                                                         |
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

| Verifier outcome                      | HTTP | What it means to the player                                                   |
| ------------------------------------- | ---- | ----------------------------------------------------------------------------- |
| `recorded`                            | 200  | Verified and saved.                                                           |
| `duplicate`                           | 200  | The same run, submitted again — a retry. Safe, and it never scores twice.     |
| `not_found`                           | 404  | No such run, or somebody else's — deliberately the same answer.               |
| `expired`, `abandoned`, `closed`      | 409  | The run can no longer be submitted; start a new one.                          |
| `wrong_rules`                         | 409  | The session was pinned to rules this server does not implement.               |
| `invalid_actions`, `invalid_duration` | 422  | The sequence is not one the rules can produce.                                |
| `score_mismatch`                      | 422  | The replay disagrees with the claimed score. The replayed number is returned. |

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
**There is no final round**: the sequence is infinite, so a run lasts as long as the
player's memory does.

### The board

| Thing   | Value                                                       |
| ------- | ----------------------------------------------------------- |
| Pads    | 4                                                           |
| Rounds  | Endless — no final round, no complete run                   |
| Taps    | Unbounded; the score is the correct taps a run earned       |
| Rules   | `chain@2` (endless); `chain@1` (the retired ten-round game) |
| Runtime | `chain` (the catalogue's `games.runtime` value)             |

### Difficulty

Difficulty is a function of the round alone, so it is deterministic and identical
for every player at the same point:

| Round | Step lit | Gap between steps |
| ----- | -------- | ----------------- |
| 1     | 440 ms   | 200 ms            |
| 2     | 422 ms   | 190 ms            |
| 10    | 278 ms   | 110 ms            |
| 13    | 224 ms   | 100 ms            |
| 14+   | 220 ms   | 100 ms            |

Both values fall linearly — by 18 ms and 10 ms per round — and then hold at their
floor: a step shorter than 220 ms stops being readable, so tightening further would
make a round unfair rather than harder. The floors are not the end of progression.
Round r always shows r symbols, so the sequence keeps growing by one tap a round for
as long as the run lasts; once the beat reaches its floor, memory is the whole of the
difficulty. The client's `chainTempo(round)` is the same curve the board's timers
use, and `chain.test.ts` pins both the curve and its floors.

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
not. The higher bits have the full period, so each seed deals its own sequence — and
because the generator is infinite, so is the sequence.

The seed travels as a **decimal string** for the same reason Stack 10's does: it is a
`bigint` column, and parsing it as a double would round it, deal a different
sequence, and reject every honest run.

### A move

A move is a **pad index, 0–3**. Round r shows the run's first r symbols, and the
player taps r pads — so a tap is checked against the symbol at its position _within
its round_, not at its absolute position: the third tap of round three must equal the
sequence's third symbol, the way the verifier replays it. Exactly one of two things
happens:

1. **The tap matches** → the run continues. Completing a round clears it and starts
   the next round, one symbol longer.
2. **The tap does not match** → the chain is broken and the run is over. The losing
   tap is still part of the run and is still submitted; it is a legal tap that
   loses, not an invalid one.

### Scoring

A correct tap scores **1 point**. The score of a run is its correct taps, and there
is no perfect score: 78 for a run that reproduces twelve rounds and then breaks the
chain, 3 for a run that reproduces rounds one and two and then breaks it. Failing to
tap anything is impossible — round one is a single pad — so every run has at least
one move.

### How a run ends

| Outcome | When                                                                      |
| ------- | ------------------------------------------------------------------------- |
| `over`  | A tap broke the chain. The only ending; the score is how far the run got. |

The old `cleared` outcome belongs to `chain@1` and is never produced under
`chain@2`: a run that reproduced all ten old rounds is simply a run that reached
round eleven.

The score already earned is kept. Every tap of the run must be submitted, losing tap
included: a submission that stops early is refused, so a player cannot discard the
tap that broke their chain. Because an endless run has no complete length, a
submission that never lost is refused as partial — the losing tap is what tells the
verifier the run ended.

### Verified scores

**The database decides the score**, under the same rules as Stack 10: see
`supabase/migrations/20261026130000_endless_chain.sql` for the endless branch and
`supabase/migrations/20261014120000_chain_sessions.sql` for the original.

- `public.start_game_session(slug, rules, client)` issues the run with the seed, the
  pinned version and the expiry. Its gate accepts (`stack-10`, `stack-10@1`) or
  (`chain`, `chain@1` or `chain@2`). A `chain@2` session's `tile_count` is 4096: the
  most taps one submission may carry, not a complete-run length, because an endless
  run has no complete length. A legacy `chain@1` session still reports 55. A
  `chain@2` session lives twelve hours instead of two, so a marathon is not cut off
  by the session clock.
- `public.complete_chain_run(session, actions, score, duration)` picks its branch
  from the pinned version. Both replay the same generator and score one point per
  correct tap; `chain@1` draws the ten symbols up front and accepts the 55-tap clear,
  while `chain@2` draws each round's symbols as the replay reaches it and requires
  the run to end with a losing tap. The 4096-tap bound is a request ceiling, not a
  level: it is far past any run a session could still be open for. Its outcome
  vocabulary (`recorded`, `duplicate`, `score_mismatch`, …) and its ledger behaviour
  are identical to Stack 10's, and the Go service maps them onto HTTP the same way —
  routing at the verifier the pinned rules version names.

A guest can play. Their run is verified and closed exactly like a signed-in
player's, and it is never ranked.

### Test vectors

Five vectors pin the rules to the database's own arithmetic. Each is asserted by the
client engine, and every vector that produces a score is also replayed against the
real verifier in `tests/security/rls_test.sql`; if either side drifts, one of the two
suites fails.

1. **Seed 1's sequence** — `0, 0, 2, 3, 0, 0, 2, 2, 0, 1, 1, 0`
2. **Seed 1, the retired ten-round line** — round 1 `[0]`, round 2 `[0,0]`, …, round
   10 the first ten symbols: 55 taps, ten clears, **55 points**. Still accepted by
   `chain@1`; under `chain@2` it is refused as a partial endless run, because it
   never loses.
3. **Seed 1, twelve rounds and a loss** — the same line continued through rounds
   eleven and twelve, then one wrong pad: 78 correct taps, twelve clears, **78
   points**, 79 taps submitted. Asserted in
   [`tests/security/rls_test.sql`](../../tests/security/rls_test.sql) and in
   [`src/lib/games/chain.test.ts`](../../src/lib/games/chain.test.ts).
4. **Seed 1, the broken chain** — `0, 0, 0, 1`: rounds one and two reproduced, then
   the wrong tap. **3 points**, 4 taps placed, 2 rounds cleared. Asserted in both
   suites.
5. **A full-width seed** — `9223372036854775807` deals `1, 3, 3, 3, 1, 0, 1, 0, …`,
   which is what catches a client that rounded the seed to a double.

## Memory Flash

Watch the pattern light, then tap the same cells back **in any order**. Each round
shows one cell more than the last; a tap outside the pattern — or a second tap on a
cell already lit — ends the run.

### The board

| Thing   | Value                                                             |
| ------- | ----------------------------------------------------------------- |
| Board   | 4×4, sixteen cells (indexes 0–15)                                 |
| Rounds  | 10 per run — the run always ends, so two scores measure one thing |
| Taps    | 55 in a perfect run (1 + 2 + … + 10)                              |
| Rules   | `memory-flash@1`                                                  |
| Runtime | `memory-flash` (the catalogue's `games.runtime` value)            |

### The patterns

The cells are not random at play time: they are a function of the run's seed, which
the **server** chooses when it issues the session. The client must produce exactly
the same patterns or its submission is refused, so the generator is written out in
full rather than described:

```
state₀ = ((seed mod 2³²) + 2³²) mod 2³²        // the seed is a bigint, reduced to 32 bits
if state₀ = 0 then state₀ = 2654435769         // 0x9E3779B9: a zero state would be degenerate
stateₙ = (stateₙ₋₁ × 1664525 + 1013904223) mod 2³²
cellₙ  = (stateₙ >> 16) mod 16                 // 0..15
```

Round `r` lights exactly `r` **distinct** cells: the generator is advanced until
`r` cells the round does not already hold have been drawn, and the rejection is
part of the rules rather than a drawing detail. The state carries across rounds —
round two starts drawing where round one stopped — so the ten patterns are one
sequence, not ten independent draws.

The state progression is the same LCG Stack 10's deck uses; only the digit read out
of each state differs. Cells are read from bits 16–19, deliberately not from the low
four bits: this LCG's low bits advance with a period of two to the power of their
width, so `state % 16` would flash a slice of one repeated sixteen-draw cycle and a
later round would teach nothing an earlier one had not. Bits 16–19 have the full
period, so each seed flashes its own patterns.

The seed travels as a **decimal string** for the same reason Stack 10's does: it is
a `bigint` column, and parsing it as a double would round it, flash different
patterns, and reject every honest run.

### A move

A move is a **cell index, 0–15**. Round `r` has `r` cells lit, and a tap is correct
when it is one of those cells that has not been entered yet. The order does not
matter — the pattern is a set — but a tap outside the set, or a repeat, is a mistake:

1. **A cell in the pattern, not yet entered** → it stays lit, and the round
   continues. Entering the last cell clears the round.
2. **A cell outside the pattern, or one already entered** → the run is over. The
   tap is still part of the run and is still submitted; it is a legal tap that
   loses, not an invalid one.

### Scoring

A cleared pattern scores **10 points**. A pattern is all-or-nothing: a round with
four of its five cells entered and then a mistake scores nothing for that round.
A perfect run clears ten patterns for **100 points**.

### How a run ends

| Outcome   | When                                                                       |
| --------- | -------------------------------------------------------------------------- |
| `over`    | A tap was outside the pattern or repeated a lit cell. The ordinary ending. |
| `cleared` | All ten patterns were rebuilt — all fifty-five taps.                       |

The score already earned is kept. Every tap of the run must be submitted, losing
tap included: a submission that stops early is refused, so a player cannot discard
the tap that broke their pattern. Tapping nothing is impossible — round one is a
single cell — so every run has at least one move.

### Verified scores

**The database decides the score**, under the same rules as Stack 10 and Chain: see
`supabase/migrations/20261020120000_memory_flash_sessions.sql` for the code.

- `public.memory_flash_pattern(seed, round)` draws one round's pattern. It is
  internals: execute is not granted to a client, because a player already holds the
  seed their own board draws from, and the verifier is the only caller.
- `public.start_game_session(slug, rules, client)` issues the run with the seed, the
  pinned version and the expiry. Its gate is a pair — (`stack-10`, `stack-10@1`),
  (`chain`, `chain@1` or `chain@2`) or (`memory-flash`, `memory-flash@1`) — and anything else is
  `unsupported_runtime`. A Memory Flash session's `tile_count` is 55: the field
  counts the moves a complete run holds, and its moves are cell taps.
- `public.complete_memory_flash_run(session, actions, score, duration)` replays the
  tap list pattern by pattern, derives the score, compares it with the claim, and
  only then closes the session and records it. Its outcome vocabulary
  (`recorded`, `duplicate`, `score_mismatch`, …) and its ledger behaviour are
  identical to the other two verifiers, and the Go service maps them onto HTTP the
  same way — routing at the verifier the pinned rules version names and accepting
  cell indexes up to 15 for this game's board.

A guest can play. Their run is verified and closed exactly like a signed-in
player's, and it is never ranked.

### Test vectors

Each vector is asserted by both the SQL suite and the client engine; if either side
drifts, one of the two suites fails.

1. **Seed 1's patterns** — `[8]`, `[8,6]`, `[3,0,8]`, `[6,2,8,5]`, `[13,0,7,1,8]`,
   `[3,14,15,13,7,2]`, `[15,2,11,14,8,10,0]`, `[11,2,1,10,5,12,3,13]`,
   `[3,14,13,9,11,8,0,4,15]`, `[1,4,7,2,10,6,9,5,14,11]`.
2. **Seed 1, the perfect line** — those fifty-five cells in that order: ten cleared
   patterns, **100 points**. Asserted in
   [`tests/security/rls_test.sql`](../../tests/security/rls_test.sql) and in
   [`src/lib/games/memory-flash.test.ts`](../../src/lib/games/memory-flash.test.ts).
3. **Seed 1, the broken pattern** — `8, 8, 0`: round one rebuilt, the first cell of
   round two entered, then a cell round two does not light. **10 points**, 3 taps
   placed, 1 round cleared. Asserted in both suites.
4. **A full-width seed** — `9223372036854775807` flashes `[5]`, `[7,3]`,
   `[15,5,4]`, `[5,0,2,11]`, … which is what catches a client that rounded the seed
   to a double.

## One Move

Every board is a checkerboard with exactly one move already made. Find the cell
that restores it; any other tap ends the run.

### The board

| Thing   | Value                                                             |
| ------- | ----------------------------------------------------------------- |
| Boards  | 12 per run — the run always ends, so two scores measure one thing |
| Taps    | 12 in a perfect run — one per board                               |
| Board   | 3×3 for boards 1–4, 4×4 for boards 5–8, 5×5 for boards 9–12       |
| Rules   | `one-move@1`                                                      |
| Runtime | `one-move` (the catalogue's `games.runtime` value)                |

### The boards

The winning cells are not random at play time: they are a function of the run's
seed, which the **server** chooses when it issues the session. The client must
produce exactly the same cells or its submission is refused, so the generator is
written out in full rather than described:

```
state₀ = ((seed mod 2³²) + 2³²) mod 2³²        // the seed is a bigint, reduced to 32 bits
if state₀ = 0 then state₀ = 2654435769         // 0x9E3779B9: a zero state would be degenerate
stateₙ = (stateₙ₋₁ × 1664525 + 1013904223) mod 2³²
cells(n) = side(n)²                             // 9, 16 or 25
centerₙ = (stateₙ >> 16) mod cells(n)           // the winning cell of board n
```

The state advances once per board, so board two draws from the second state and
not the first. Cells are read from bits 16–19 rather than the low bits for the
same reason Memory Flash reads them there: this LCG's low bits cycle with a
period of two to the power of the bit width. The cell count changes with the
board, so the value is reduced modulo the current board's cells, not modulo 16.

The seed travels as a **decimal string** for the same reason Stack 10's does: it
is a `bigint` column, and parsing it as a double would win on different cells and
reject every honest run.

A **solved board is a checkerboard**: a cell is dark when `row + col` is even.
Board `n` is that solved board with one cross flipped, where the cross of cell `c`
is `c` itself plus the cells above, below, left and right that exist — three cells
at a corner, four at an edge, five in the middle. The winning cell is the centre of
that cross.

It is the board's **only** winning move. Tapping another cell flips a different
cross, and two different crosses are different sets, so their symmetric difference
is non-empty and the board cannot come back solved. Both engine copies derive the
same cell, and both the winning-cell vector and the uniqueness property are tested.

### A move

A move is a **cell index on the current board**. Exactly one of two things happens:

1. **The cell is the board's winning cell** → the checkerboard is restored, the
   board scores ten points, and the next board is drawn — a larger one when the
   run reaches 5×5, or the run clears after the twelfth.
2. **Any other cell** → the run is over. The tap is still part of the run and is
   still submitted; it is a legal move that loses, not an invalid one.

### Scoring

Each restored board scores **10 points**. A perfect run restores all twelve for
**120 points**. A losing run keeps the boards it restored before the losing tap.

### How a run ends

| Outcome   | When                                                         |
| --------- | ------------------------------------------------------------ |
| `over`    | A tap was not the board's winning cell. The ordinary ending. |
| `cleared` | All twelve boards were restored — all twelve taps.           |

The score already earned is kept. Every tap of the run must be submitted, losing
tap included: a submission that stops early is refused, so a player cannot discard
the tap that ended their run. Tapping nothing is impossible — board one has a
winning cell — so every run has at least one move.

### Verified scores

**The database decides the score**, under the same rules as the other three: see
`supabase/migrations/20261021120000_one_move_sessions.sql` for the code.

- `public.one_move_center(seed, level)` draws one board's winning cell. It is
  internals: execute is not granted to a client, because a player already holds
  the seed their own boards draw from, and the verifier is the only caller.
- `public.start_game_session(slug, rules, client)` issues the run with the seed,
  the pinned version and the expiry. Its gate is a pair — (`stack-10`,
  `stack-10@1`), (`chain`, `chain@1` or `chain@2`), (`memory-flash`, `memory-flash@1`) or
  (`one-move`, `one-move@1`) — and anything else is `unsupported_runtime`. A One
  Move session's `tile_count` is 12: the field counts the moves a complete run
  holds, and its moves are board taps.
- `public.complete_one_move_run(session, actions, score, duration)` replays the tap
  list board by board, derives the score, compares it with the claim, and only
  then closes the session and records it. Its outcome vocabulary (`recorded`,
  `duplicate`, `score_mismatch`, …) and its ledger behaviour are identical to the
  other three verifiers, and the Go service maps them onto HTTP the same way —
  routing at the verifier the pinned rules version names and accepting cell indexes
  up to 24 for this game's largest board.

A guest can play. Their run is verified and closed exactly like a signed-in
player's, and it is never ranked.

### Test vectors

Each vector is asserted by both the SQL suite and the client engine; if either side
drifts, one of the two suites fails.

1. **Seed 1's winning cells** — `7, 8, 7, 7, 0, 8, 6, 2, 5, 18, 13, 5`.
2. **Seed 1, the perfect line** — those twelve cells in that order: twelve restored
   boards, **120 points**. Asserted in
   [`tests/security/rls_test.sql`](../../tests/security/rls_test.sql) and in
   [`src/lib/games/one-move.test.ts`](../../src/lib/games/one-move.test.ts).
3. **Seed 1, the missed move** — `7, 0`: board one restored, then a tap that is not
   board two's winning cell. **10 points**, 2 taps placed, 1 board restored.
   Asserted in both suites.
4. **A full-width seed** — `9223372036854775807` wins on
   `1, 8, 6, 6, 5, 4, 5, 0, 24, 13, 3, 7`, which is what catches a client that
   rounded the seed to a double.

## Color Merge

Slide a 4×4 board of shades. Two equal tiles that meet merge into the next shade
and score the tile they create. A run is **forty-eight slides**; it ends when the
deck is empty, or earlier if the board locks.

### The board

| Thing   | Value                                                            |
| ------- | ---------------------------------------------------------------- |
| Board   | 4×4, sixteen cells                                               |
| Tile    | A shade: `1` shows 2, `2` shows 4, `3` shows 8, and so on        |
| Opening | Two tiles, dealt from the seed                                   |
| Deck    | 48 slides — the run always ends, so two scores measure one thing |
| Rules   | `color-merge@1`                                                  |
| Runtime | `color-merge` (the catalogue's `games.runtime` value)            |

A tile's **value** is `2 ** shade`, which is the number on its face. Shades are
what the rules merge; values are what the player reads and what the score counts.

### The deck

The tiles are not random at play time: their cells and shades are a function of
the run's seed, which the **server** chooses when it issues the session. The
client must deal exactly the same board or its submission is refused, so the
generator is written out in full:

```
state₀ = ((seed mod 2³²) + 2³²) mod 2³²        // the seed is a bigint, reduced to 32 bits
if state₀ = 0 then state₀ = 2654435769         // 0x9E3779B9: a zero state would be degenerate
stateₙ = (stateₙ₋₁ × 1664525 + 1013904223) mod 2³²

// spawn k, 1-based: advance k times to pick the cell, once more for the shade
cell(k)  = empties[stateₖ mod count(empties)]  // empties are in board order
shade(k) = 2 if stateₖ₊₁ mod 10 = 0 else 1
```

Spawn `k` is a pure function of the seed and `k`, rather than a mutable generator
both sides must advance in step, so the verifier can reach spawn twenty without
replaying nineteen and neither copy can drift by one draw. The run opens with
spawns 1 and 2; slide `n` deals spawn `n + 2`, except the last slide, which deals
nothing because there is no next move to make with the tile.

The seed travels as a **decimal string** for the same reason the other games' do:
it is a `bigint` column, and parsing it as a double would deal a different board
and reject every honest run.

### A slide

A slide is a **direction, 0–3**: up, right, down, left. Every line of the board is
read in the direction of travel, compacted toward that edge, and its equal
neighbours merge into the next shade. A tile merges **at most once per slide** —
four 2s become two 4s, never one 8.

A direction that would not change the board is **not a move**: it is not
recorded, nothing is dealt, and nothing scores. That is why the verifier refuses
an action list containing one — the submitted list is exactly the play.

### Scoring

Each merge scores the value of the tile it created: two 2s make a 4 and score 4,
two 4s make an 8 and score 8. A dealt tile scores nothing until it merges.
Merging preserves the board's total value, so the score is **not** a difference in
what the board is worth — it is the sum of the merges, which is the conventional
score for this game and the number the verifier derives.

### How a run ends

| Outcome | Reason   | When                                                                      |
| ------- | -------- | ------------------------------------------------------------------------- |
| `over`  | `deck`   | The forty-eighth slide was played. Every run that survives reaches this.  |
| `over`  | `locked` | The board is full and no two neighbours match, so no slide can change it. |

Every slide of the run must be submitted: a submission that ends before the deck
is empty or before the board locks is refused, so a player cannot discard the
slide that ended their run.

### Verified scores

**The database decides the score**, under the same rules as the other four: see
`supabase/migrations/20261022120000_color_merge_sessions.sql` for the code.

- `public.color_merge_board(seed)` deals the opening two tiles, and
  `public.color_merge_spawn(seed, k, board)` deals spawn `k`. Both are internals:
  execute is not granted to a client, because a player already holds the seed
  their own board grows from, and the verifier is the only caller.
- `public.color_merge_slide(board, direction)` compacts and merges every line, and
  `public.color_merge_gain(board, direction)` reports the points the same slide
  earns. They share one line function, so the board and the score cannot disagree.
- `public.color_merge_can_move(board)` is the lock test: an empty cell, or two
  equal neighbours.
- `public.start_game_session(slug, rules, client)` issues the run with the seed,
  the pinned version and the expiry. Its gate is a pair — (`stack-10`,
  `stack-10@1`), (`chain`, `chain@1` or `chain@2`), (`memory-flash`, `memory-flash@1`),
  (`one-move`, `one-move@1`) or (`color-merge`, `color-merge@1`) — and anything
  else is `unsupported_runtime`. A Color Merge session's `tile_count` is 48: the
  field counts the moves a complete run holds, and its moves are slides.
- `public.complete_color_merge_run(session, actions, score, duration)` replays the
  direction list from the seed, deals the tiles, derives the score, compares it
  with the claim, and only then closes the session and records it. Its outcome
  vocabulary (`recorded`, `duplicate`, `score_mismatch`, …) and its ledger
  behaviour are identical to the other four verifiers, and the Go service maps
  them onto HTTP the same way — routing at the verifier the pinned rules version
  names and accepting directions 0–3.

A guest can play. Their run is verified and closed exactly like a signed-in
player's, and it is never ranked.

### Test vectors

Each vector is asserted by both the SQL suite and the client engine; if either side
drifts, one of the two suites fails.

1. **Seed 1's opening board** — two shade-1 tiles at cells 12 and 13:
   `0,0,0,0,0,0,0,0,0,0,0,0,1,1,0,0`. Seed `9223372036854775807` opens with a
   shade-1 tile at cell 2 and a shade-2 tile at cell 8, which is what catches a
   client that rounded the seed to a double.
2. **Seed 1's deck line** — the first legal direction in the order down, left,
   right, up, played forty-eight times:

   ```
   3,1,3,2,2,2,2,2,2,2,2,2,2,2,2,2,3,2,2,2,3,2,2,2,2,2,3,2,3,2,2,2,
   2,2,2,2,2,3,2,3,3,2,2,2,2,2,2,2
   ```

   It scores **272** and leaves `1,0,0,0,2,1,0,0,4,3,2,1,5,4,3,3`. Asserted in
   [`tests/security/rls_test.sql`](../../tests/security/rls_test.sql) and in
   [`src/lib/games/color-merge.test.ts`](../../src/lib/games/color-merge.test.ts).

3. **Seed 15's locked line** — the first legal direction in the order right, left,
   up, down, forty-two slides, scoring **184** and leaving a full board with no
   matching neighbours:

   ```
   1,2,4,1,3,4,1,3,1,3,4,2,2,1,2,1
   ```

   This is the vector that pins the lock ending: the run stops before the deck is
   empty, and the verifier must record it rather than call it partial. Asserted in
   both suites.

## Don't Touch the Black

Rows of tiles rise to a line. Tap the white ones; touch a black one and the run is
over. **There is no final row**: the conveyor keeps coming, getting faster and
blacker, until the player slips or chooses to stop.

### The board

| Thing   | Value                                                                  |
| ------- | ---------------------------------------------------------------------- |
| Rows    | Endless — no final row, no complete deck                               |
| Lanes   | 3 per row                                                              |
| Cells   | 4095 addressable — the most taps one submission can carry              |
| Tile    | White (safe, 10 points) or black (ends the run)                        |
| Rules   | `dont-touch@2` (endless); `dont-touch@1` (the retired twenty-row deck) |
| Runtime | `dont-touch` (the catalogue's `games.runtime` value)                   |

A cell is addressed by its index on the conveyor, in board order: row one's lanes
are cells 0–2, row two's are 3–5, and so on. That index is the move — no column of
the UI ever reaches the verifier.

### Difficulty

Two curves make the game harder, and both are functions of the row alone, so they
are deterministic and identical for every player at the same point.

**Speed** — how long a row stays at the line before the next one takes its place:

| Row | Window  |
| --- | ------- |
| 1   | 1600 ms |
| 11  | 1150 ms |
| 21  | 700 ms  |
| 31  | 697 ms  |
| 61  | 689 ms  |

The first twenty-one rows shorten linearly by 45 ms each. After that the window
eases toward a 650 ms floor and never reaches it: below 650 ms three lanes cannot be
scanned fairly on a phone, so the floor bounds readability, not progression. The
client's `rowWindow(row)` is the same curve the board's timers use.

**Density** — the share of black tiles in a row:

| Rows  | Black                   |
| ----- | ----------------------- |
| 1–10  | 25%                     |
| 11–20 | 26%                     |
| …     | +1 point every ten rows |
| 201+  | 45%                     |

The ramp caps at 45% where a row still usually has a white to take (55% of its cells
are white), while missing whites costs real points. Density is what keeps the game
getting harder after the beat has reached its readable floor, and a row may be all
black — that is a row to let pass, not a trap, because missing whites is a lost
opportunity rather than a loss.

Neither curve ever steps backwards, so the conveyor never slows down, and no two
players face a different beat at the same row.

### The conveyor

The colours are not random at play time: they are a function of the run's seed,
which the **server** chooses when it issues the session. The client must deal exactly
the same conveyor or its submission is refused, so the generator is written out in
full:

```
state₀ = ((seed mod 2³²) + 2³²) mod 2³²        // the seed is a bigint, reduced to 32 bits
if state₀ = 0 then state₀ = 2654435769         // 0x9E3779B9: a zero state would be degenerate
stateₙ = (stateₙ₋₁ × 1664525 + 1013904223) mod 2³²

// cell k, 0-based: advance k + 1 times, then read
draw(k)  = state >> 16
black(k) = (draw(k) mod 100) < blackPercent(k / 3)
```

The colour is read from bits 16 and above rather than the low bits on purpose: this
LCG's low bits cycle with a period of two to the power of the bit width, so a colour
read from them would repeat a fixed pattern regardless of the seed. The shift is
shared with the retired rules, which read `draw(k) mod 4 = 0`; the endless rules read
the same draw modulo 100 against the row's density. Because the generator is
infinite, so is the conveyor.

The seed travels as a **decimal string** for the same reason the other games' do: it
is a `bigint` column, and parsing it as a double would colour a different conveyor
and reject every honest run.

### A tap

A tap is a **cell number**. A white tile clears and scores ten points; a black tile
ends the run, and the tap that touched it is part of the submission so the verifier
replays the ending rather than being told about it. A cell can be touched once, a
cell past the conveyor is not a cell, and a tap after the black tile is impossible
play.

The rules deliberately do not know about time. The conveyor decides _when_ a row is
in reach — that is the screen's job — while the submitted list says only which cells
were touched. Whether a player saw every row is a fact about the conveyor's clock,
not about the action list.

### Scoring and endings

Each white tile is worth **10 points**; a black tile is worth nothing, because its
cost is the run. A run ends in one of two ways:

| Ending  | When                                                         |
| ------- | ------------------------------------------------------------ |
| Black   | A black tile was touched. The tap is submitted and replayed. |
| Stopped | The player ended the run. The cleared whites are the score.  |

An endless game has no natural last row, so stopping is the ordinary way out of a
good run, and it cannot inflate a score: the score is the whites already cleared.
The first twenty-row `dont-touch@1` deck also ended when its last row passed; that
ending belongs to the retired rules and is never produced under `dont-touch@2`.

### Verified scores

**The database decides the score**, under the same rules as the other six: see
`supabase/migrations/20261027120000_endless_dont_touch.sql` for the endless branch and
`supabase/migrations/20261023120000_dont_touch_sessions.sql` for the original.

- `public.dont_touch_black(seed, cell)` is the colour of one cell under the retired
  rules, and `public.dont_touch_black_endless(seed, cell)` is the colour under the
  endless ones. Both are internals: execute is not granted to a client, because a
  player already holds the seed their own conveyor grows from, and the verifier is
  the only caller.
- `public.start_game_session(slug, rules, client)` issues the run with the seed, the
  pinned version and the expiry. Its gate accepts (`dont-touch`, `dont-touch@1` or
  `dont-touch@2`) and refuses anything else as `unsupported_runtime`. A `dont-touch@2`
  session's `tile_count` is 4095: the most taps one submission may carry, not a
  complete-run length, because an endless run has no complete length. A legacy
  `dont-touch@1` session still reports 60.
- `public.complete_dont_touch_run(session, actions, score, duration)` picks its branch
  from the pinned version, replays the taps from the seed, derives the score, compares
  it with the claim, and only then closes the session and records it. The 4095-cell
  bound is a request ceiling, not a level: at the 650 ms floor it is more than a
  quarter of an hour of perfect play. Its outcome vocabulary (`recorded`,
  `duplicate`, `score_mismatch`, …) and its ledger behaviour are identical to the
  other six verifiers, and the Go service maps them onto HTTP the same way — routing
  at the verifier the pinned rules version names and accepting cells 0–4094.

A guest can play. Their run is verified and closed exactly like a signed-in
player's, and it is never ranked.

### Test vectors

Each vector is asserted by both the SQL suite and the client engine; if either side
drifts, one of the two suites fails.

1. **Seed 1's retired deck** — the sixty cells of `dont-touch@1`, `B` for black and
   `.` for white:

   ```
   BB..BB..B..B...B..........B.B......B........B.BBBBB..B..B.B.
   ```

   Nineteen of the sixty cells are black, so a careful run has 41 whites to clear.
   The old generator is still asserted exactly, which is what proves a session issued
   before the endless release replays to the same score.

2. **Seed 1's opening rows, endless** — rows 1–12 on the `dont-touch@2` conveyor:

   ```
   .B. .BB ... .B. B.B .BB ... .B. B.B ..B .B. ..B
   ```

   The endless rules do not reproduce the retired deck: the colour is read modulo
   100 against the row's density rather than modulo 4, and the ramp begins at row
   eleven. Asserted in
   [`tests/security/rls_test.sql`](../../tests/security/rls_test.sql) and in
   [`src/lib/games/dont-touch.test.ts`](../../src/lib/games/dont-touch.test.ts).

3. **Seed 1's twenty-five rows** — the whites of rows one to twenty-five in board
   order: `0,2,3,6,…,74`, **56 whites, 560 points**, and cells 60–74 are past the old
   deck. The run is still playing when it stops, which is the point: the conveyor did
   not end at twenty rows. Asserted in both suites.

4. **Seed 1's opening loss** — `0,2,1`: clear the row's two whites, then touch the
   black tile at cell 1. It scores **20**, and the black tap is recorded as the ending
   rather than scored. Asserted in both suites.

5. **Seed 0, density** — cell 41 (row fourteen) draws 25: white at the opening 25%,
   black from the moment that row's density is 26%. This is the vector that catches a
   client whose ramp never reaches the verifier. Asserted in both suites.

## 7 Second

The daily game. **Seven seconds** on the clock, one arithmetic challenge at a time,
three answers to choose from. A right answer buys time and scores; a wrong one
costs time. Everyone plays the same deck on the same UTC day, and a signed-in
player gets **one ranked attempt per day**.

### The board

| Thing    | Value                                                     |
| -------- | --------------------------------------------------------- |
| Clock    | 7.0 seconds, plus 1.5 per right answer, minus 2 per wrong |
| Answers  | 3 per challenge — one right, two wrong                    |
| Cap      | 60 answers per submission                                 |
| Score    | 10 points per right answer                                |
| Rules    | `seven-second@1`                                          |
| Runtime  | `seven-second` (the catalogue's `games.runtime` value)    |
| Category | Daily                                                     |

### The daily deck

The seed is **the UTC date**, hashed once:

```
seed = (days since 1970-01-01) × 2654435761 + 7
```

That makes the deck a property of the day rather than of the player: every run
started on 24 October 2026 receives the same seed, so two scores measure the same
challenges. It is also why the daily limit works — `start_game_session` compares a
completed session's seed with today's seed, not two wall-clock timestamps.

From there the generator is the same 32-bit LCG the other games use:

```
state₀ = ((seed mod 2³²) + 2³²) mod 2³²
if state₀ = 0 then state₀ = 2654435769
stateₙ = (stateₙ₋₁ × 1664525 + 1013904223) mod 2³²

// challenge k, 0-based: advance k + 1 times, then read one state
left     = 2 + ((state >> 8)  mod 18)      // 2..19
right    = 1 + ((state >> 16) mod 9)       // 1..9
minus    = ((state >> 24) mod 2) = 0       // subtraction when set
if minus and right > left then swap        // never pose a negative answer
answer   = minus ? left - right : left + right

offset₁  = 1 + ((state >> 4)  mod 5)       // 1..5
offset₂  = offset₁ + 1 + ((state >> 12) mod 4)
correct  = state mod 3                     // the button the answer sits on
options  = [answer + offset₁, answer + offset₂] with `answer` inserted at `correct`
```

Both wrong answers are therefore above the right one and distinct, which is enough
to stop the answer being found by shape rather than arithmetic. The right button
moves because its position is the state modulo three, so mashing one position is
not a strategy.

### A run

The screen starts the clock when the player presses Start, not when the session
arrives — reading the rules must not cost seven seconds. Each press is an answer
button index, 0–2:

- **right** → 10 points, and 1.5 seconds go back on the clock. The next challenge
  appears.
- **wrong** → nothing, and 2 seconds come off. The next challenge appears.
- **clock at zero** → the run ends and the answers already given are submitted.
  That is the ordinary ending; a run with no answers is valid and scores zero.
- **sixty answers** → the run ends too. It is the contract's cap and a real
  ending, not a number the UI invented.

The rules deliberately do not know about time: the screen decides _when_ a run is
over, while the submitted list says only which buttons were pressed. A press after
the clock empties is not recorded, so what is replayed is exactly what was played.

Because the clock is not replayed, a modified client could submit sixty correct
answers without waiting. The answer cap makes that score **600**, the same ceiling
a perfect run reaches, and the server still checks every answer — so the cheat is
bounded to the score the game already awards, never beyond it.

### Verified scores

**The database decides the score**, under the same rules as the other six: see
`supabase/migrations/20261024120000_seven_second_sessions.sql`.

- `public.seven_second_seed()` is today's seed. It is stable rather than immutable,
  and clients never call it: the seed arrives with the session.
- `public.seven_second_correct(seed, index)` is the right button for one challenge.
  It is an internal; execute is not granted to clients, because a player already
  holds the seed their deck grows from.
- `public.start_game_session(slug, rules, client)` issues the run with the daily
  seed, the pinned version and the expiry. Its gate is a pair — the six earlier
  pairs plus (`seven-second`, `seven-second@1`) — and anything else is
  `unsupported_runtime`. A 7 Second session's `tile_count` is 60, the answer cap.
  For a signed-in caller it also answers `already_played` when a completed session
  exists for today's seed, and issues nothing.
- `public.complete_seven_second_run(session, actions, score, duration)` replays the
  answers from the seed, scores ten per right one, compares the total with the
  claim, and only then closes the session and records it. Its outcome vocabulary
  (`recorded`, `duplicate`, `score_mismatch`, …) and ledger behaviour are identical
  to the other six verifiers, and the Go service maps them onto HTTP the same way —
  routing `seven-second@1` to this verifier, accepting choices 0–2, and answering
  `409` for `already_played`.

  The ledger keeps the daily rule on its own: if two sessions of the same day's
  deck reach completion — a start and a completion can race — the second is
  refused with `already_played` rather than becoming a second score. The race can
  cost a run; it cannot put two entries on the board.

A guest can play, and can play again: their run is verified and closed exactly like
a signed-in player's, and it is never ranked, so repeated practice cannot put a
score on a board. The daily limit is the rule that makes the daily board a
comparison of the same deck, and it applies to the ranked attempt.

### Test vectors

Each vector is asserted by both the SQL suite and the client engine; if either side
drifts, one of the two suites fails.

1. **Seed 1's first four challenges** — prompts, options, and the right button:

   ```
   0: 11 − 8  → [3, 5, 7]   right = 0
   1:  9 − 5  → [4, 6, 7]   right = 0
   2: 13 + 8  → [26, 27, 21] right = 2
   3: 16 − 8  → [9, 8, 13]  right = 1
   ```

   Asserted in
   [`tests/security/rls_test.sql`](../../tests/security/rls_test.sql) and in
   [`src/lib/games/seven-second.test.ts`](../../src/lib/games/seven-second.test.ts).

2. **Seed 1's answer line `0,1,2,1`** — right, wrong, right, right: **three
   correct, 30 points**, submitted as four answers. Asserted in both suites.

3. **The zero-state fallback** — seed `2654435769` draws the same deck as a seed of
   `0`; its first six right buttons are `1,0,0,2,1,2`. Asserted in both.

4. **A perfect sixty-answer run** on seed 42 scores **600** and ends itself at the
   cap. Asserted in the client engine; the verifier accepts any line from zero to
   sixty answers, so the line is valid play and the score is its replay.
