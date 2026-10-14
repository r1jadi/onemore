/**
 * Chain — the game, as a pure deterministic state machine.
 *
 * This module is the *client's* copy of the rules. The authority is the database:
 * `public.complete_chain_run` in
 * `supabase/migrations/20261014120000_chain_sessions.sql` replays the submitted
 * tap list against the session's sequence and derives the score itself. Two copies
 * of one ruleset is a real risk, so the copy is pinned in three ways:
 *
 *   - **The rules version is data.** A session carries the version it was started
 *     under (`chain@1`), the server refuses to verify a version it does not
 *     implement, and this module declares the same string. A change to the rules
 *     is a change to the version, not an edit in place.
 *   - **The state machine is total and pure.** `tap` takes a run and a pad and
 *     returns a run — no clock, no randomness, no I/O — so the same inputs
 *     produce the same run on both sides.
 *   - **It is tested against the database's own numbers.** The vectors in
 *     `chain.test.ts` are the ones `tests/security/rls_test.sql` asserts (seed 1,
 *     the perfect 55-tap line, the broken chain). See `docs/games/README.md`.
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
export const CHAIN_RUNTIME = "chain";

/** The rules the server can verify. Sent with every run and pinned to a session. */
export const CHAIN_RULES_VERSION = "chain@1";

/** The board: four pads, ten rounds, fifty-five taps in a perfect run. */
export const CHAIN_PADS = 4;
export const CHAIN_ROUNDS = 10;
export const CHAIN_TAPS = 55;

// The generator, state for state as `complete_chain_run` advances it: the same
// 32-bit LCG Stack 10's deck uses (see `src/lib/games/stack10.ts`), with the
// same zero-state fallback and the same decimal-string seed handling, because a
// seed that differs by one bit deals a different sequence. Only the digit read
// out of each state differs: Stack 10 reads the low bits (`state % 9`), while
// Chain reads two higher bits (`(state >> 16) % 4`). The low two bits advance
// by a constant, so they cycle with period four — every seed would deal one of
// four rotations of the same pattern, and round five would teach nothing round
// one had not. The higher bits have the full period, so each seed deals its
// own sequence.
const SEED_MODULUS = 4294967296n;
const LCG_MULTIPLIER = 1664525n;
const LCG_INCREMENT = 1013904223n;
// 0x9E3779B9. The verifier substitutes it for a zero state, which would otherwise
// produce a constant sequence; mirrored so both sides treat a degenerate seed the
// same way.
const ZERO_STATE_FALLBACK = 2654435769n;
const SYMBOL_SHIFT = 16n;

/**
 * How a run ended.
 *
 * `over` — a tap broke the chain, which is the ordinary ending.
 * `cleared` — all ten rounds were reproduced, all fifty-five taps.
 */
export type ChainOutcome = "playing" | "over" | "cleared";

/** One run, as this module knows it. */
export type ChainRun = {
  /** The server's seed, as the decimal string the API returned. */
  readonly seed: string;
  readonly rulesVersion: string;
  /**
   * Every pad tapped, in order, including the tap that broke the chain. This
   * *is* the submission: the server replays this list and nothing else, so a
   * run is verifiable exactly when this is the list that produced it.
   */
  readonly taps: readonly number[];
  /**
   * The score this run earns under the rules, as the server computes it too:
   * one point per correct tap.
   */
  readonly score: number;
  /** Rounds fully reproduced so far. */
  readonly roundsCleared: number;
  /** The round being played, 1-based. */
  readonly round: number;
  readonly outcome: ChainOutcome;
};

/**
 * Normalises a seed to the 32-bit state the generator starts from.
 *
 * It mirrors the verifier's own expression — including its handling of a negative
 * or zero seed — because a state that differs by one bit produces a different
 * sequence, and the run would be rejected as a run the rules cannot produce.
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
      throw new TypeError("a Chain seed must be a whole number");
    }
    return BigInt(seed);
  }
  const trimmed = seed.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new TypeError("a Chain seed must be a decimal integer string");
  }
  return BigInt(trimmed);
}

/** Advances the generator once and returns the symbol it produced. */
function draw(state: bigint): { state: bigint; symbol: number } {
  const next = (state * LCG_MULTIPLIER + LCG_INCREMENT) % SEED_MODULUS;
  return { state: next, symbol: Number((next >> SYMBOL_SHIFT) % 4n) };
}

/** The `index`-th symbol of a run's sequence (0-based). */
export function symbolAt(seed: string | number | bigint, index: number): number {
  if (!Number.isInteger(index) || index < 0) {
    throw new RangeError("a symbol index must be a whole number of zero or more");
  }
  let state = initialState(seed);
  let symbol = 0;
  for (let i = 0; i <= index; i += 1) {
    const next = draw(state);
    state = next.state;
    symbol = next.symbol;
  }
  return symbol;
}

/** Taps a round holds: round r shows the run's first r symbols. */
export function tapsInRound(round: number): number {
  return round;
}

/** Taps a perfect run holds through `round` (1-based): 1 + 2 + … + round. */
export function totalTapsThrough(round: number): number {
  return (round * (round + 1)) / 2;
}

/** A fresh run at the start of the first round. */
export function createRun(seed: string | number | bigint): ChainRun {
  const normalized = toBigInt(seed).toString();
  return {
    seed: normalized,
    rulesVersion: CHAIN_RULES_VERSION,
    taps: [],
    score: 0,
    roundsCleared: 0,
    round: 1,
    outcome: "playing",
  };
}

/**
 * Whether a tap is playable: the run is live, there are rounds left, and the
 * pad exists.
 *
 * The board calls this to decide whether a pad is pressable, so an impossible
 * tap is never offered in the first place — and `tap` checks it again, because
 * a keyboard or programmatic path must not be able to make one either.
 */
export function canTap(run: ChainRun, pad: number): boolean {
  if (run.outcome !== "playing") return false;
  if (run.taps.length >= CHAIN_TAPS) return false;
  return Number.isInteger(pad) && pad >= 0 && pad < CHAIN_PADS;
}

/**
 * Taps a pad and returns the resulting run.
 *
 * Every round replays the sequence from its start, so a tap is checked against
 * the symbol at its position *within its round*, not at its absolute position:
 * the third tap of round three must equal the sequence's third symbol, the way
 * the verifier replays it. A wrong tap ends the run with a loss and is still
 * part of it — a loss is submitted, not hidden — and completing the tenth
 * round clears the run.
 *
 * An impossible tap is not a tap: the run comes back unchanged. That is
 * deliberate rather than an exception — a tap that arrives one frame after the
 * run ended must not throw inside a render — and it keeps this function total,
 * which is what makes it testable against every state.
 */
export function tap(run: ChainRun, pad: number): ChainRun {
  if (!canTap(run, pad)) return run;

  const taps = [...run.taps, pad];
  // Taps taken in the current round so far: the round replays the sequence
  // from symbol zero, so this is the index the tap is checked against.
  const taken = run.taps.length - totalTapsThrough(run.round - 1);
  if (pad !== symbolAt(run.seed, taken)) {
    return { ...run, taps, outcome: "over" };
  }

  const roundDone = taken + 1 >= run.round;
  const roundsCleared = roundDone ? run.roundsCleared + 1 : run.roundsCleared;
  const outcome: ChainOutcome = taps.length >= CHAIN_TAPS ? "cleared" : "playing";
  return {
    ...run,
    taps,
    score: run.score + 1,
    roundsCleared,
    round: outcome === "cleared" ? CHAIN_ROUNDS : roundDone ? run.round + 1 : run.round,
    outcome,
  };
}

/**
 * The body of a completion submission.
 *
 * It is assembled from the run rather than accepted from a caller, so the number
 * submitted is the one this engine computed and cannot be edited on the way out.
 */
export type ChainSubmission = {
  readonly rulesVersion: string;
  readonly actions: readonly number[];
  readonly score: number;
  readonly tapsPlaced: number;
  readonly roundsCleared: number;
};

export function submission(run: ChainRun): ChainSubmission {
  return {
    rulesVersion: run.rulesVersion,
    actions: run.taps,
    score: run.score,
    tapsPlaced: run.taps.length,
    roundsCleared: run.roundsCleared,
  };
}

/** How far through the run the player is, for the progress readout. */
export function progress(run: ChainRun): {
  taps: number;
  total: number;
  round: number;
  rounds: number;
} {
  return { taps: run.taps.length, total: CHAIN_TAPS, round: run.round, rounds: CHAIN_ROUNDS };
}
