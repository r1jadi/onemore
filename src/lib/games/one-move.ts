/**
 * One Move — the game, as a pure deterministic state machine.
 *
 * This module is the *client's* copy of the rules. The authority is the database:
 * `public.complete_one_move_run` in
 * `supabase/migrations/20261021120000_one_move_sessions.sql` replays the submitted
 * tap list from the session's seed and derives the score itself. Two copies of one
 * ruleset is a real risk, so the copy is pinned in three ways:
 *
 *   - **The rules version is data.** A session carries the version it was started
 *     under (`one-move@1`), the server refuses to verify a version it does not
 *     implement, and this module declares the same string. A change to the rules
 *     is a change to the version, not an edit in place.
 *   - **The state machine is total and pure.** `tap` takes a run and a cell and
 *     returns a run — no clock, no randomness, no I/O — so the same inputs produce
 *     the same run on both sides.
 *   - **It is tested against the database's own numbers.** The vectors in
 *     `one-move.test.ts` are the ones `tests/security/rls_test.sql` asserts (seed
 *     1's twelve winning cells and the perfect 120-point line). See
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
export const ONE_MOVE_RUNTIME = "one-move";

/** The rules the server can verify. Sent with every run and pinned to a session. */
export const ONE_MOVE_RULES_VERSION = "one-move@1";

/** Twelve boards, one tap each: the run always ends, so scores measure one thing. */
export const ONE_MOVE_LEVELS = 12;
export const ONE_MOVE_TAPS = ONE_MOVE_LEVELS;

/** A solved board scores, and a board is all-or-nothing. */
const LEVEL_SCORE = 10;

// The generator, state for state as `complete_one_move_run` advances it: the same
// 32-bit LCG Stack 10's deck uses (see `src/lib/games/stack10.ts`), with the same
// zero-state fallback and the same decimal-string seed handling, because a seed
// that differs by one bit wins on a different cell.
//
// The winning cell is read from bits 16–19 (`(state >> 16) % cells`) rather than
// the low bits, and deliberately so: this LCG's low bits cycle with a period of
// two to the power of the bit width, so a small board read from them would repeat
// a fixed cycle. The higher bits have the full period, so each seed has its own
// boards. (The cell count changes with the board size, so the value is taken mod
// the current level's board, not mod 16.)
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
 * `over` — a tap was not the one that restores the board. That is the ordinary
 * ending.
 * `cleared` — all twelve boards were restored, all twelve taps.
 */
export type OneMoveOutcome = "playing" | "over" | "cleared";

/** One run, as this module knows it. */
export type OneMoveRun = {
  /** The server's seed, as the decimal string the API returned. */
  readonly seed: string;
  readonly rulesVersion: string;
  /**
   * Every cell tapped, in order, including the tap that ended the run. This *is*
   * the submission: the server replays this list and nothing else.
   */
  readonly taps: readonly number[];
  /** Boards restored so far. Each one is worth ten points. */
  readonly levelsCleared: number;
  /** The board being played, 1-based. On a cleared run it stays on the last one. */
  readonly level: number;
  /** The score this run earns under the rules, as the server computes it too. */
  readonly score: number;
  readonly outcome: OneMoveOutcome;
};

/**
 * Normalises a seed to the 32-bit state the generator starts from.
 *
 * It mirrors the verifier's own expression — including its handling of a negative
 * or zero seed — because a state that differs by one bit wins on a different
 * cell, and the run would be rejected as a run the rules cannot produce.
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
      throw new TypeError("a One Move seed must be a whole number");
    }
    return BigInt(seed);
  }
  const trimmed = seed.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new TypeError("a One Move seed must be a decimal integer string");
  }
  return BigInt(trimmed);
}

/**
 * The side of the board a board is played on.
 *
 * A board grows as the run goes on: 3×3 for the first four, 4×4 for the next
 * four, 5×5 for the last four. It never shrinks, so a focused cell stays on the
 * board when the next one is drawn.
 */
export function boardSize(level: number): number {
  if (!Number.isInteger(level) || level < 1 || level > ONE_MOVE_LEVELS) {
    throw new RangeError(`a One Move level must be a whole number from 1 to ${ONE_MOVE_LEVELS}`);
  }
  if (level <= 4) return 3;
  if (level <= 8) return 4;
  return 5;
}

/** The number of cells on a level's board. */
export function cellCount(level: number): number {
  const size = boardSize(level);
  return size * size;
}

/** Advances the generator once. */
function advance(state: bigint): bigint {
  return (state * LCG_MULTIPLIER + LCG_INCREMENT) % SEED_MODULUS;
}

/**
 * The cell whose cross was flipped on a level's board — the run's one winning
 * move.
 *
 * The state progresses once per level, so board two is drawn from the second
 * state and not the first, and the verifier reproduces the same cell. It is
 * exported because the board has to know which pattern it is showing, and a
 * screen must not grow a second copy of the generator.
 */
export function winningCell(seed: string | number | bigint, level: number): number {
  const cells = cellCount(level);
  let state = initialState(seed);
  for (let current = 1; current <= level; current += 1) {
    state = advance(state);
  }
  return Number((state >> CELL_SHIFT) % BigInt(cells));
}

/** Whether a cell is dark on a *solved* board: a checkerboard, in board order. */
export function solvedCell(level: number, cell: number): boolean {
  const size = boardSize(level);
  if (!Number.isInteger(cell) || cell < 0 || cell >= size * size) {
    throw new RangeError("a One Move cell must be on the level's board");
  }
  const row = Math.floor(cell / size);
  const column = cell % size;
  return (row + column) % 2 === 0;
}

/**
 * The cells a move on `cell` flips: the cell itself and its four orthogonal
 * neighbours, truncated at the board's edges.
 *
 * A move at a corner therefore flips three cells and a move in the middle of a
 * 5×5 board flips five. Truncation is part of the rules, not a rendering detail:
 * both engine copies compute the same cross, and the winning cell is unique
 * because two different crosses always differ as sets.
 */
export function crossCells(level: number, cell: number): number[] {
  const size = boardSize(level);
  if (!Number.isInteger(cell) || cell < 0 || cell >= size * size) {
    throw new RangeError("a One Move cell must be on the level's board");
  }
  const row = Math.floor(cell / size);
  const column = cell % size;
  const cells = [cell];
  if (row > 0) cells.push(cell - size);
  if (row < size - 1) cells.push(cell + size);
  if (column > 0) cells.push(cell - 1);
  if (column < size - 1) cells.push(cell + 1);
  return cells;
}

/** A level's board as it is shown before the winning move is made. */
export type OneMoveBoard = {
  readonly size: number;
  readonly center: number;
  /** `true` is a dark cell; `false` is a light one. Indexed in board order. */
  readonly cells: readonly boolean[];
};

/**
 * The board a level shows.
 *
 * It is a solved checkerboard with exactly one cross already flipped. That is why
 * the level has exactly one winning move: tapping any other cell would flip a
 * different cross, and the two crosses cannot cancel to leave the board solved.
 */
export function boardPattern(seed: string | number | bigint, level: number): OneMoveBoard {
  const size = boardSize(level);
  const center = winningCell(seed, level);
  const flipped = new Set(crossCells(level, center));
  const cells = Array.from({ length: size * size }, (_, index) => {
    const solved = solvedCell(level, index);
    return flipped.has(index) ? !solved : solved;
  });
  return { size, center, cells };
}

/** A fresh run at the start of the first board. */
export function createRun(seed: string | number | bigint): OneMoveRun {
  return {
    seed: toBigInt(seed).toString(),
    rulesVersion: ONE_MOVE_RULES_VERSION,
    taps: [],
    levelsCleared: 0,
    level: 1,
    score: 0,
    outcome: "playing",
  };
}

/**
 * Whether a tap is playable: the run is live, there are taps left, and the cell
 * exists on the current board.
 *
 * The board calls this to decide whether a cell is pressable, so an impossible
 * tap is never offered in the first place — and `tap` checks it again, because a
 * keyboard or programmatic path must not be able to make one either.
 */
export function canTap(run: OneMoveRun, cell: number): boolean {
  if (run.outcome !== "playing") return false;
  if (run.taps.length >= ONE_MOVE_TAPS) return false;
  return Number.isInteger(cell) && cell >= 0 && cell < cellCount(run.level);
}

/**
 * Taps a cell and returns the resulting run.
 *
 * Exactly one cell restores the current board: the one the cross was flipped
 * from. Tapping it clears the board and scores ten points; tapping any other
 * cell ends the run. The ending tap is still part of the run and is submitted,
 * the way Stack 10's overflowing tile is, and clearing the twelfth board clears
 * the run.
 *
 * An impossible tap is not a tap: the run comes back unchanged. That is
 * deliberate rather than an exception — a tap that arrives one frame after the
 * run ended must not throw inside a render — and it keeps this function total.
 */
export function tap(run: OneMoveRun, cell: number): OneMoveRun {
  if (!canTap(run, cell)) return run;

  const taps = [...run.taps, cell];
  if (cell !== winningCell(run.seed, run.level)) {
    return { ...run, taps, outcome: "over" };
  }

  const levelsCleared = run.levelsCleared + 1;
  const cleared = run.level === ONE_MOVE_LEVELS || taps.length >= ONE_MOVE_TAPS;
  return {
    ...run,
    taps,
    levelsCleared,
    level: cleared ? ONE_MOVE_LEVELS : run.level + 1,
    score: run.score + LEVEL_SCORE,
    outcome: cleared ? "cleared" : "playing",
  };
}

/**
 * The body of a completion submission.
 *
 * It is assembled from the run rather than accepted from a caller, so the number
 * submitted is the one this engine computed and cannot be edited on the way out.
 */
export type OneMoveSubmission = {
  readonly rulesVersion: string;
  readonly actions: readonly number[];
  readonly score: number;
  readonly tapsPlaced: number;
  readonly levelsCleared: number;
};

export function submission(run: OneMoveRun): OneMoveSubmission {
  return {
    rulesVersion: run.rulesVersion,
    actions: run.taps,
    score: run.score,
    tapsPlaced: run.taps.length,
    levelsCleared: run.levelsCleared,
  };
}

/** How far through the run the player is, for the progress readout. */
export function progress(run: OneMoveRun): {
  taps: number;
  total: number;
  level: number;
  levels: number;
} {
  return {
    taps: run.taps.length,
    total: ONE_MOVE_TAPS,
    level: run.level,
    levels: ONE_MOVE_LEVELS,
  };
}
