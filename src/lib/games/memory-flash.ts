/**
 * Memory Flash — the game, as a pure deterministic state machine.
 *
 * This module is the *client's* copy of the rules. The authority is the database:
 * `public.complete_memory_flash_run` in
 * `supabase/migrations/20261020120000_memory_flash_sessions.sql` replays the
 * submitted tap list from the session's seed and derives the score itself. Two
 * copies of one ruleset is a real risk, so the copy is pinned in three ways:
 *
 *   - **The rules version is data.** A session carries the version it was started
 *     under (`memory-flash@1`), the server refuses to verify a version it does not
 *     implement, and this module declares the same string. A change to the rules
 *     is a change to the version, not an edit in place.
 *   - **The state machine is total and pure.** `tap` takes a run and a cell and
 *     returns a run — no clock, no randomness, no I/O — so the same inputs produce
 *     the same run on both sides.
 *   - **It is tested against the database's own numbers.** The vectors in
 *     `memory-flash.test.ts` are the ones `tests/security/rls_test.sql` asserts
 *     (seed 1's patterns, the perfect 55-tap line for 100 points, and a broken
 *     line). See `docs/games/README.md`.
 *
 * The client cannot invent a score even if this file is wrong: a wrong replay
 * produces a number the server's replay disagrees with, and the submission is
 * refused with `score_mismatch`. What the module must get right is *agreement*, and
 * the failure mode of disagreement is a rejected run rather than a wrong one.
 *
 * Storage rule: nothing here is persisted. A run lives in React state for as long
 * as the screen is open; losing it costs the player one run and never a score,
 * because a score only exists once the server has verified it.
 */

/** The `runtime` value the catalogue must carry for these rules to play a game. */
export const MEMORY_FLASH_RUNTIME = "memory-flash";

/** The rules the server can verify. Sent with every run and pinned to a session. */
export const MEMORY_FLASH_RULES_VERSION = "memory-flash@1";

/** The board: a 4×4 grid, ten patterns, fifty-five taps in a perfect run. */
export const MEMORY_FLASH_COLUMNS = 4;
export const MEMORY_FLASH_CELLS = MEMORY_FLASH_COLUMNS * MEMORY_FLASH_COLUMNS;
export const MEMORY_FLASH_ROUNDS = 10;
/** 1 + 2 + … + 10: the taps a run that clears every pattern holds. */
export const MEMORY_FLASH_TAPS = (MEMORY_FLASH_ROUNDS * (MEMORY_FLASH_ROUNDS + 1)) / 2;

/** A round is all-or-nothing: clearing its pattern scores, a partial round does not. */
const ROUND_SCORE = 10;

// The generator, state for state as `complete_memory_flash_run` advances it: the
// same 32-bit LCG Stack 10's deck uses (see `src/lib/games/stack10.ts`), with the
// same zero-state fallback and the same decimal-string seed handling, because a
// seed that differs by one bit flashes a different pattern.
//
// A cell is read from bits 16–19 (`(state >> 16) % 16`) rather than the low four
// bits, and deliberately so: this LCG's low bits cycle with a period of two to the
// power of the bit width, so `state % 16` would repeat a fixed sixteen-draw cycle.
// Every pattern would be a slice of that cycle, and round seven would show something
// round one already taught. Bits 16–19 have the full period, so each seed flashes
// its own patterns. Chain reads the same bits two at a time; the games are unrelated.
const SEED_MODULUS = 4294967296n;
const LCG_MULTIPLIER = 1664525n;
const LCG_INCREMENT = 1013904223n;
// 0x9E3779B9. The verifier substitutes it for a zero state, which would otherwise
// produce a constant sequence; mirrored so both sides treat a degenerate seed the
// same way.
const ZERO_STATE_FALLBACK = 2654435769n;
const CELL_SHIFT = 16n;

/**
 * How a run ended.
 *
 * `over` — a tap was not part of the pattern, or repeated a cell already lit. That
 * is the ordinary ending.
 * `cleared` — all ten patterns were rebuilt, all fifty-five taps.
 */
export type MemoryFlashOutcome = "playing" | "over" | "cleared";

/** One run, as this module knows it. */
export type MemoryFlashRun = {
  /** The server's seed, as the decimal string the API returned. */
  readonly seed: string;
  readonly rulesVersion: string;
  /**
   * Every cell tapped, in order, including the tap that broke the pattern. This
   * *is* the submission: the server replays this list and nothing else, so a run
   * is verifiable exactly when this is the list that produced it.
   */
  readonly taps: readonly number[];
  /**
   * The cells correctly rebuilt in the current round, in the order they were
   * tapped. The round is a set, not a sequence: the pattern must be reproduced in
   * any order, which is what makes this game memory rather than reaction.
   */
  readonly entered: readonly number[];
  /** Rounds cleared so far. Each one is worth ten points. */
  readonly roundsCleared: number;
  /** The round being played, 1-based. */
  readonly round: number;
  /** The score this run earns under the rules, as the server computes it too. */
  readonly score: number;
  readonly outcome: MemoryFlashOutcome;
};

/**
 * Normalises a seed to the 32-bit state the generator starts from.
 *
 * It mirrors the verifier's own expression — including its handling of a negative
 * or zero seed — because a state that differs by one bit flashes a different
 * pattern, and the run would be rejected as a run the rules cannot produce.
 */
function initialState(seed: string | number | bigint): bigint {
  const value = toBigInt(seed);
  const reduced = ((value % SEED_MODULUS) + SEED_MODULUS) % SEED_MODULUS;
  return reduced === 0n ? ZERO_STATE_FALLBACK : reduced;
}

function toBigInt(seed: string | number | bigint): bigint {
  if (typeof seed === "bigint") return seed;
  if (typeof seed === "number") {
    if (!Number.isInteger(seed)) {
      throw new TypeError("a Memory Flash seed must be a whole number");
    }
    return BigInt(seed);
  }
  const trimmed = seed.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new TypeError("a Memory Flash seed must be a decimal integer string");
  }
  return BigInt(trimmed);
}

/** Advances the generator once and returns the cell it produced. */
function draw(state: bigint): { state: bigint; cell: number } {
  const next = (state * LCG_MULTIPLIER + LCG_INCREMENT) % SEED_MODULUS;
  return { state: next, cell: Number((next >> CELL_SHIFT) % 16n) };
}

/**
 * The pattern of one round, as the cells it lights in draw order.
 *
 * A round `r` lights exactly `r` distinct cells. The generator is advanced until
 * `r` cells the round does not already hold have been drawn, so a pattern never
 * lights the same cell twice and the rejection is part of the rules the verifier
 * replays. The state carries across rounds: round two starts drawing where round
 * one stopped, exactly as the SQL function does.
 *
 * The verifier draws the same list in SQL (`public.memory_flash_pattern`), one
 * round at a time; this is the client's copy. It is exported because the board
 * needs to know which cells are lit, and a screen must not grow a second copy of
 * the generator.
 */
export function patternAt(seed: string | number | bigint, round: number): number[] {
  if (!Number.isInteger(round) || round < 1 || round > MEMORY_FLASH_ROUNDS) {
    throw new RangeError(
      `a Memory Flash round must be a whole number from 1 to ${MEMORY_FLASH_ROUNDS}`,
    );
  }

  let state = initialState(seed);
  let pattern: number[] = [];
  for (let current = 1; current <= round; current += 1) {
    pattern = [];
    while (pattern.length < current) {
      const next = draw(state);
      state = next.state;
      if (!pattern.includes(next.cell)) pattern.push(next.cell);
    }
  }
  return pattern;
}

/** A fresh run at the start of the first pattern. */
export function createRun(seed: string | number | bigint): MemoryFlashRun {
  const normalized = toBigInt(seed).toString();
  return {
    seed: normalized,
    rulesVersion: MEMORY_FLASH_RULES_VERSION,
    taps: [],
    entered: [],
    roundsCleared: 0,
    round: 1,
    score: 0,
    outcome: "playing",
  };
}

/**
 * Whether a tap is playable: the run is live, there are taps left, and the cell
 * exists.
 *
 * The board calls this to decide whether a cell is pressable, so an impossible tap
 * is never offered in the first place — and `tap` checks it again, because a
 * keyboard or programmatic path must not be able to make one either.
 */
export function canTap(run: MemoryFlashRun, cell: number): boolean {
  if (run.outcome !== "playing") return false;
  if (run.taps.length >= MEMORY_FLASH_TAPS) return false;
  return Number.isInteger(cell) && cell >= 0 && cell < MEMORY_FLASH_CELLS;
}

/**
 * Taps a cell and returns the resulting run.
 *
 * Every round replays its own pattern, so a correct tap is one of the round's
 * cells that has not been entered yet — the order does not matter. A tap outside
 * the pattern, or on a cell already entered, breaks the pattern and ends the run.
 * That losing tap is still part of the run and is submitted, the way Stack 10's
 * overflowing tile is, and completing the tenth pattern clears the run.
 *
 * An impossible tap is not a tap: the run comes back unchanged. That is deliberate
 * rather than an exception — a tap that arrives one frame after the run ended must
 * not throw inside a render — and it keeps this function total, which is what makes
 * it testable against every state.
 */
export function tap(run: MemoryFlashRun, cell: number): MemoryFlashRun {
  if (!canTap(run, cell)) return run;

  const taps = [...run.taps, cell];
  const pattern = patternAt(run.seed, run.round);
  if (!pattern.includes(cell) || run.entered.includes(cell)) {
    return { ...run, taps, outcome: "over" };
  }

  const entered = [...run.entered, cell];
  if (entered.length < run.round) {
    return { ...run, taps, entered };
  }

  // The round clears: all of its cells are lit, in whatever order they were
  // tapped. Ten points for the round, and the next pattern is one cell larger.
  const roundsCleared = run.roundsCleared + 1;
  const cleared = run.round === MEMORY_FLASH_ROUNDS || taps.length >= MEMORY_FLASH_TAPS;
  return {
    ...run,
    taps,
    // The pattern is complete, so the round's entered set is empty whether the
    // run is over or the next pattern is about to be shown.
    entered: [],
    roundsCleared,
    round: cleared ? MEMORY_FLASH_ROUNDS : run.round + 1,
    score: run.score + ROUND_SCORE,
    outcome: cleared ? "cleared" : "playing",
  };
}

/**
 * The body of a completion submission.
 *
 * It is assembled from the run rather than accepted from a caller, so the number
 * submitted is the one this engine computed and cannot be edited on the way out.
 */
export type MemoryFlashSubmission = {
  readonly rulesVersion: string;
  readonly actions: readonly number[];
  readonly score: number;
  readonly tapsPlaced: number;
  readonly roundsCleared: number;
};

export function submission(run: MemoryFlashRun): MemoryFlashSubmission {
  return {
    rulesVersion: run.rulesVersion,
    actions: run.taps,
    score: run.score,
    tapsPlaced: run.taps.length,
    roundsCleared: run.roundsCleared,
  };
}

/** How far through the run the player is, for the progress readout. */
export function progress(run: MemoryFlashRun): {
  taps: number;
  total: number;
  round: number;
  rounds: number;
  entered: number;
} {
  return {
    taps: run.taps.length,
    total: MEMORY_FLASH_TAPS,
    round: run.round,
    rounds: MEMORY_FLASH_ROUNDS,
    entered: run.entered.length,
  };
}
