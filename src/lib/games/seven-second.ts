/**
 * 7 Second — the game, as a pure deterministic state machine.
 *
 * This module is the *client's* copy of the rules. The authority is the database:
 * `public.complete_seven_second_run` in
 * `supabase/migrations/20261024120000_seven_second_sessions.sql` replays the
 * submitted answer list from the session's seed and derives the score itself.
 * Two copies of one ruleset is a real risk, so the copy is pinned in three ways:
 *
 *   - **The rules version is data.** A session carries the version it was started
 *     under (`seven-second@1`), the server refuses to verify a version it does not
 *     implement, and this module declares the same string. A change to the rules
 *     is a change to the version, not an edit in place.
 *   - **The state machine is total and pure.** `answer` takes a run and an option
 *     and returns a run — no clock, no randomness, no I/O — so the same inputs
 *     produce the same run on both sides. The clock lives in the screen: it
 *     decides when the run ends, never what an answer is worth.
 *   - **It is tested against the database's own numbers.** The vectors in
 *     `seven-second.test.ts` are the ones `tests/security/rls_test.sql` asserts
 *     (seed 1's first challenges and the score an answer line earns). See
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
export const SEVEN_SECOND_RUNTIME = "seven-second";

/** The rules the server can verify. Sent with every run and pinned to a session. */
export const SEVEN_SECOND_RULES_VERSION = "seven-second@1";

/**
 * The clock the screen starts with, in milliseconds.
 *
 * Seven seconds is the game's name and the whole of its pressure. The constants
 * live here, beside the rules, so the instructions and the timer cannot disagree.
 */
export const SEVEN_SECOND_BASE_MS = 7000;

/** A correct answer buys this much more time. */
export const SEVEN_SECOND_BONUS_MS = 1500;

/** A wrong answer costs this much time. It can empty the clock. */
export const SEVEN_SECOND_PENALTY_MS = 2000;

/** Three answers per challenge: one right, two wrong. */
export const SEVEN_SECOND_OPTIONS = 3;

/**
 * The most answers a submission can hold.
 *
 * It is the contract's global bound, and it is also a real cap: no one answers
 * sixty three-option challenges in seven seconds. Reaching it ends the run — an
 * answer machine must still meet an ending.
 */
export const SEVEN_SECOND_MAX_ANSWERS = 60;

/** A correct answer is worth ten points. A wrong one is worth nothing. */
const CORRECT_SCORE = 10;

// The generator, state for state as `complete_seven_second_run` advances it: the
// same 32-bit LCG the other games use, with the same zero-state fallback and the
// same decimal-string seed handling, because a seed that differs by one bit poses
// a different challenge.
const SEED_MODULUS = 4294967296n;
const LCG_MULTIPLIER = 1664525n;
const LCG_INCREMENT = 1013904223n;
// 0x9E3779B9. The verifier substitutes it for a zero state, which would otherwise
// produce a constant sequence; mirrored so both sides treat a degenerate seed the
// same way.
const ZERO_STATE_FALLBACK = 2654435769n;

/** One arithmetic challenge, as the screen shows it. */
export type SevenSecondChallenge = {
  /** 0-based: how many answers were given before it. */
  readonly index: number;
  /** The two operands, in the order the prompt shows them. */
  readonly left: number;
  readonly right: number;
  /** `+` or `−`. Subtraction never goes below zero. */
  readonly operator: "+" | "−";
  /** The answer values, in the order the buttons show them. */
  readonly options: readonly number[];
  /** The index in `options` of the answer the verifier will score. */
  readonly correct: number;
};

function initialState(seed: string | number | bigint): bigint {
  const value = toBigInt(seed);
  const reduced = ((value % SEED_MODULUS) + SEED_MODULUS) % SEED_MODULUS;
  return reduced === 0n ? ZERO_STATE_FALLBACK : reduced;
}

function toBigInt(seed: string | number | bigint): bigint {
  if (typeof seed === "bigint") return seed;
  if (typeof seed === "number") {
    if (!Number.isInteger(seed)) {
      throw new TypeError("a 7 Second seed must be a whole number");
    }
    return BigInt(seed);
  }
  const trimmed = seed.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new TypeError("a 7 Second seed must be a decimal integer string");
  }
  return BigInt(trimmed);
}

function advance(state: bigint): bigint {
  return (state * LCG_MULTIPLIER + LCG_INCREMENT) % SEED_MODULUS;
}

/**
 * The challenge at a position in the day's deck.
 *
 * Challenge `k` is drawn after `k + 1` advances, so the first is the one the
 * verifier reads first and neither copy can drift by one draw. All the values
 * come from one state: the operands from bits 8–23, the sign from bit 24, the
 * distractors from the low bits, and the correct button's position from the state
 * modulo three. That is enough entropy for a correct answer that is not always in
 * the same place, which is what stops the game being a button-mashing contest.
 *
 * Distractors are both *above* the answer and distinct, so a wrong button is never
 * a negative number and never collides with the right one. Subtraction swaps its
 * operands when needed, so the answer is never negative either.
 */
export function challenge(seed: string | number | bigint, index: number): SevenSecondChallenge {
  if (!Number.isInteger(index) || index < 0 || index >= SEVEN_SECOND_MAX_ANSWERS) {
    throw new RangeError(`a 7 Second challenge index is 0 to ${SEVEN_SECOND_MAX_ANSWERS - 1}`);
  }

  let state = initialState(seed);
  for (let draw = 0; draw <= index; draw += 1) state = advance(state);

  let left = 2 + Number((state >> 8n) % 18n);
  let right = 1 + Number((state >> 16n) % 9n);
  const minus = (state >> 24n) % 2n === 0n;
  if (minus && right > left) [left, right] = [right, left];

  const answer = minus ? left - right : left + right;
  const firstOffset = 1 + Number((state >> 4n) % 5n);
  const secondOffset = firstOffset + 1 + Number((state >> 12n) % 4n);
  const position = Number(state % BigInt(SEVEN_SECOND_OPTIONS));

  const options = [answer + firstOffset, answer + secondOffset];
  options.splice(position, 0, answer);

  return {
    index,
    left,
    right,
    operator: minus ? "−" : "+",
    options,
    correct: position,
  };
}

/** The prompt, as the screen writes it. */
export function promptOf(challengeValue: SevenSecondChallenge): string {
  return `${challengeValue.left} ${challengeValue.operator} ${challengeValue.right}`;
}

/**
 * Why a run is over.
 *
 * `clock` — the seven seconds ran out (or a wrong answer emptied them). That is
 * the ordinary ending. `answers` — sixty answers were given, which is the
 * submission's hard cap. `null` while the run is live.
 */
export type SevenSecondEndReason = "clock" | "answers" | null;

export type SevenSecondOutcome = "playing" | "over";

/** One run, as this module knows it. */
export type SevenSecondRun = {
  /** The server's seed, as the decimal string the API returned. */
  readonly seed: string;
  readonly rulesVersion: string;
  /**
   * Every option chosen, in order. This *is* the submission: the server replays
   * the list against the day's challenges and nothing else.
   */
  readonly answers: readonly number[];
  /** Challenges answered correctly. Each one is worth ten points. */
  readonly correct: number;
  /** The score this run earns under the rules, as the server computes it too. */
  readonly score: number;
  readonly outcome: SevenSecondOutcome;
  readonly endReason: SevenSecondEndReason;
};

/** A fresh run, before the clock starts. */
export function createRun(seed: string | number | bigint): SevenSecondRun {
  return {
    seed: toBigInt(seed).toString(),
    rulesVersion: SEVEN_SECOND_RULES_VERSION,
    answers: [],
    correct: 0,
    score: 0,
    outcome: "playing",
    endReason: null,
  };
}

/**
 * Whether an answer is playable: the run is live, there are answers left, and the
 * option is one the screen offered.
 *
 * The screen calls this to decide whether a button is pressable, so an impossible
 * answer is never offered — and `answer` checks it again, because a keyboard or a
 * programmatic path must not be able to make one either.
 */
export function canAnswer(run: SevenSecondRun, option: number): boolean {
  if (run.outcome !== "playing") return false;
  if (run.answers.length >= SEVEN_SECOND_MAX_ANSWERS) return false;
  return Number.isInteger(option) && option >= 0 && option < SEVEN_SECOND_OPTIONS;
}

/**
 * Answers the challenge on screen and returns the resulting run.
 *
 * The challenge is the one at `run.answers.length`: the run only ever moves
 * forward, so an answer cannot skip a question or answer one twice. A correct
 * choice clears the challenge and scores ten points; a wrong one is recorded and
 * scores nothing. The screen applies the clock's bonus and penalty separately,
 * because time is presentation and the rules are score.
 *
 * An impossible answer is not an answer: the run comes back unchanged. That
 * keeps the submission equal to the play and lets an event that arrives one frame
 * after the run ended be harmless.
 */
export function answer(run: SevenSecondRun, option: number): SevenSecondRun {
  if (!canAnswer(run, option)) return run;

  const answered = challenge(run.seed, run.answers.length);
  const answers = [...run.answers, option];
  const correct = option === answered.correct;
  const cleared = run.correct + (correct ? 1 : 0);
  const full = answers.length >= SEVEN_SECOND_MAX_ANSWERS;

  return {
    ...run,
    answers,
    correct: cleared,
    score: run.score + (correct ? CORRECT_SCORE : 0),
    outcome: full ? "over" : "playing",
    endReason: full ? "answers" : null,
  };
}

/**
 * Ends the run because the clock reached zero.
 *
 * The screen calls this when its timer empties. The verifier does not need a
 * marker for it: a run that never touched its answer cap is scored from the
 * answers it gave either way.
 */
export function finish(run: SevenSecondRun): SevenSecondRun {
  if (run.outcome !== "playing") return run;
  return { ...run, outcome: "over", endReason: "clock" };
}

/** The challenge the player is looking at, or null once the run is over. */
export function currentChallenge(run: SevenSecondRun): SevenSecondChallenge | null {
  if (run.outcome !== "playing" || run.answers.length >= SEVEN_SECOND_MAX_ANSWERS) return null;
  return challenge(run.seed, run.answers.length);
}

/**
 * The body of a completion submission.
 *
 * It is assembled from the run rather than accepted from a caller, so the number
 * submitted is the one this engine computed and cannot be edited on the way out.
 */
export type SevenSecondSubmission = {
  readonly rulesVersion: string;
  readonly actions: readonly number[];
  readonly score: number;
};

export function submission(run: SevenSecondRun): SevenSecondSubmission {
  return {
    rulesVersion: run.rulesVersion,
    actions: run.answers,
    score: run.score,
  };
}

/** How far through the run the player is, for the progress readout. */
export function progress(run: SevenSecondRun): {
  answered: number;
  correct: number;
  max: number;
} {
  return {
    answered: run.answers.length,
    correct: run.correct,
    max: SEVEN_SECOND_MAX_ANSWERS,
  };
}
