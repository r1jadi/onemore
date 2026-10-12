# Games

How OneMore's games work: the rules, who is allowed to decide a score, and how a
game earns the right to be called playable.

One game is implemented today: **Stack 10**. The other six catalogue records are
published but not playable — `playable: false`, `runtime: null` — and no screen
offers to start them.

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
