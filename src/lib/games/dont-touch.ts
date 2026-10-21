/**
 * Don't Touch the Black — the game, as a pure deterministic state machine.
 *
 * This module is the *client's* copy of the rules. The authority is the database:
 * `public.complete_dont_touch_run` in
 * `supabase/migrations/20261023120000_dont_touch_sessions.sql` replays the
 * submitted taps from the session's seed and derives the score itself. Two copies
 * of one ruleset is a real risk, so the copy is pinned in three ways:
 *
 *   - **The rules version is data.** A session carries the version it was started
 *     under (`dont-touch@1`), the server refuses to verify a version it does not
 *     implement, and this module declares the same string. A change to the rules
 *     is a change to the version, not an edit in place.
 *   - **The state machine is total and pure.** `tap` takes a run and a cell and
 *     returns a run — no clock, no randomness, no I/O — so the same inputs produce
 *     the same run on both sides. The conveyor's speed lives in the screen, not in
 *     the rules: time decides when a tile can be touched, never what touching it
 *     is worth.
 *   - **It is tested against the database's own numbers.** The vectors in
 *     `dont-touch.test.ts` are the ones `tests/security/rls_test.sql` asserts
 *     (seed 1's first rows, its whites and the score a run of them earns). See
 *     `docs/games/README.md`.
 *
 * The client cannot invent a score even if this file is wrong: a wrong replay
 * produces a number the server's replay disagrees with, and the submission is
 * refused with `score_mismatch`.
 *
 * Storage rule: nothing here is persisted. A run lives in React state for as long
 * as the screen is open; losing it costs the player one run and never a score,
 * because a score only exists once the server has verified it.
 */

/** The `runtime` value the catalogue must carry for these rules to play a game. */
export const DONT_TOUCH_RUNTIME = "dont-touch";

/** The rules the server can verify. Sent with every run and pinned to a session. */
export const DONT_TOUCH_RULES_VERSION = "dont-touch@1";

/**
 * The deck: twenty rows of three lanes, dealt once, all at once.
 *
 * A run is one pass of the deck. The deck is fixed in size so two scores always
 * measure the same board — a player cannot farm a lucky long run, and a short run
 * is a missed half of the same deck rather than a different game. Sixty cells is
 * also the most taps a submission can hold, which is the contract's existing
 * bound.
 */
export const DONT_TOUCH_ROWS = 20;
export const DONT_TOUCH_LANES = 3;
export const DONT_TOUCH_CELLS = DONT_TOUCH_ROWS * DONT_TOUCH_LANES;

/** A cleared white tile is worth ten points; a black one is worth nothing. */
const TILE_SCORE = 10;

// The generator, state for state as `complete_dont_touch_run` advances it: the
// same 32-bit LCG the other games use, with the same zero-state fallback and the
// same decimal-string seed handling, because a seed that differs by one bit
// colours a different board.
//
// The colour is read from bits 16–17 rather than the low bits, and deliberately
// so: this LCG's low bits cycle with a period of two to the power of the bit
// width, and a colour read from them would repeat a fixed pattern regardless of
// the seed. The higher bits have the full period, so each seed gets its own deck.
const SEED_MODULUS = 4294967296n;
const LCG_MULTIPLIER = 1664525n;
const LCG_INCREMENT = 1013904223n;
// 0x9E3779B9. The verifier substitutes it for a zero state, which would otherwise
// produce a constant sequence; mirrored so both sides treat a degenerate seed the
// same way.
const ZERO_STATE_FALLBACK = 2654435769n;
const COLOUR_SHIFT = 16n;
// One cell in four is black. A quarter is enough that a careless swipe finds one
// and rare enough that a careful player can usually see a safe lane.
const BLACK_ONE_IN = 4n;

function initialState(seed: string | number | bigint): bigint {
  const value = toBigInt(seed);
  const reduced = ((value % SEED_MODULUS) + SEED_MODULUS) % SEED_MODULUS;
  return reduced === 0n ? ZERO_STATE_FALLBACK : reduced;
}

function toBigInt(seed: string | number | bigint): bigint {
  if (typeof seed === "bigint") return seed;
  if (typeof seed === "number") {
    if (!Number.isInteger(seed)) {
      throw new TypeError("a Don't Touch the Black seed must be a whole number");
    }
    return BigInt(seed);
  }
  const trimmed = seed.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new TypeError("a Don't Touch the Black seed must be a decimal integer string");
  }
  return BigInt(trimmed);
}

function advance(state: bigint): bigint {
  return (state * LCG_MULTIPLIER + LCG_INCREMENT) % SEED_MODULUS;
}

/**
 * The deck's colours, in board order: twenty rows, lane by lane.
 *
 * Cell `k` is drawn after `k + 1` advances of the generator, so the first cell is
 * the same one the verifier reads and neither copy can drift by one draw. The
 * whole deck is a pure function of the seed, so the screen can show the rows that
 * are coming without keeping a generator in step.
 */
export function deck(seed: string | number | bigint): boolean[] {
  let state = initialState(seed);
  const cells: boolean[] = [];
  for (let cell = 0; cell < DONT_TOUCH_CELLS; cell += 1) {
    state = advance(state);
    cells.push((state >> COLOUR_SHIFT) % BLACK_ONE_IN === 0n);
  }
  return cells;
}

/** Whether one cell is black. Throws for a cell that is not on the deck. */
export function isBlack(seed: string | number | bigint, cell: number): boolean {
  if (!Number.isInteger(cell) || cell < 0 || cell >= DONT_TOUCH_CELLS) {
    throw new RangeError(`a Don't Touch the Black cell is 0 to ${DONT_TOUCH_CELLS - 1}`);
  }
  return deck(seed)[cell];
}

/** The row a cell belongs to. */
export function rowOf(cell: number): number {
  return Math.floor(cell / DONT_TOUCH_LANES);
}

/** The lane a cell belongs to. */
export function laneOf(cell: number): number {
  return cell % DONT_TOUCH_LANES;
}

/** The cell at a row and lane. */
export function cellAt(row: number, lane: number): number {
  return row * DONT_TOUCH_LANES + lane;
}

/**
 * How a run ended.
 *
 * `black` — a black tile was touched, which is the ordinary ending. `deck` — every
 * row of the deck passed without a black tap, which is the run a careful player
 * gets. `null` while the run is live.
 */
export type DontTouchEndReason = "black" | "deck" | null;

export type DontTouchOutcome = "playing" | "over";

/** One run, as this module knows it. */
export type DontTouchRun = {
  /** The server's seed, as the decimal string the API returned. */
  readonly seed: string;
  readonly rulesVersion: string;
  /**
   * Every cell tapped, in order, including the black cell that ended the run.
   * This *is* the submission: the server replays this list and nothing else.
   */
  readonly taps: readonly number[];
  /** White tiles cleared. Each one is worth ten points. */
  readonly cleared: number;
  /** The score this run earns under the rules, as the server computes it too. */
  readonly score: number;
  readonly outcome: DontTouchOutcome;
  readonly endReason: DontTouchEndReason;
};

/** A fresh run at the top of the deck. */
export function createRun(seed: string | number | bigint): DontTouchRun {
  return {
    seed: toBigInt(seed).toString(),
    rulesVersion: DONT_TOUCH_RULES_VERSION,
    taps: [],
    cleared: 0,
    score: 0,
    outcome: "playing",
    endReason: null,
  };
}

/**
 * Whether a tap is playable: the run is live, the cell is on the deck, and it has
 * not been tapped already.
 *
 * The screen calls this to decide whether a tile is pressable, so a tile that is
 * out of reach or already cleared is never offered — and `tap` checks it again,
 * because a keyboard or programmatic path must not be able to make one either.
 */
export function canTap(run: DontTouchRun, cell: number): boolean {
  if (run.outcome !== "playing") return false;
  if (!Number.isInteger(cell) || cell < 0 || cell >= DONT_TOUCH_CELLS) return false;
  return !run.taps.includes(cell);
}

/**
 * Taps a cell and returns the resulting run.
 *
 * A white tile clears and scores ten points. A black tile ends the run; the tap
 * that ended it is still part of the run and is submitted, the way Stack 10's
 * overflowing tile is, so the verifier can replay the ending rather than be told
 * about it. A tap that is impossible — a cell off the deck, or one already
 * tapped — is not a tap: the run comes back unchanged, which keeps this function
 * total and lets a stray event one frame after the run ended be harmless.
 */
export function tap(run: DontTouchRun, cell: number): DontTouchRun {
  if (!canTap(run, cell)) return run;

  const taps = [...run.taps, cell];
  if (isBlack(run.seed, cell)) {
    return { ...run, taps, outcome: "over", endReason: "black" };
  }
  return {
    ...run,
    taps,
    cleared: run.cleared + 1,
    score: run.score + TILE_SCORE,
  };
}

/**
 * Ends the run because the deck has passed.
 *
 * The screen calls this when the last row has left the line; the verifier does not
 * need a marker for it, because a run that never touched a black tile is scored
 * from the cells it did touch either way. It is separate from `tap` so a run can
 * only end by the two things that end one — a black tile, or the deck running out.
 */
export function finish(run: DontTouchRun): DontTouchRun {
  if (run.outcome !== "playing") return run;
  return { ...run, outcome: "over", endReason: "deck" };
}

/**
 * The body of a completion submission.
 *
 * It is assembled from the run rather than accepted from a caller, so the number
 * submitted is the one this engine computed and cannot be edited on the way out.
 */
export type DontTouchSubmission = {
  readonly rulesVersion: string;
  readonly actions: readonly number[];
  readonly score: number;
};

export function submission(run: DontTouchRun): DontTouchSubmission {
  return {
    rulesVersion: run.rulesVersion,
    actions: run.taps,
    score: run.score,
  };
}

/** How far through the deck the player is, for the progress readout. */
export function progress(run: DontTouchRun): {
  rows: number;
  totalRows: number;
  cleared: number;
  whites: number;
} {
  const colours = deck(run.seed);
  return {
    rows: DONT_TOUCH_ROWS,
    totalRows: DONT_TOUCH_ROWS,
    cleared: run.cleared,
    whites: colours.filter((black) => !black).length,
  };
}
