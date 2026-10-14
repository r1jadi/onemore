import { describe, expect, it } from "vitest";

import {
  canTap,
  CHAIN_PADS,
  CHAIN_ROUNDS,
  CHAIN_RULES_VERSION,
  CHAIN_TAPS,
  createRun,
  progress,
  submission,
  symbolAt,
  tap,
  totalTapsThrough,
  type ChainRun,
} from "@/lib/games/chain";

/**
 * The engine's tests are pinned to the *database's* numbers.
 *
 * `public.complete_chain_run` is the authority: it replays the submitted tap
 * list against the sequence and derives the score. Every vector below is either
 * asserted by `tests/security/rls_test.sql` for the same seed and line, or
 * computed here from the rules independently of this module. That is what makes
 * a green suite worth something — it proves agreement with the verifier, not
 * self-consistency.
 *
 * The vectors are also written down in `docs/games/README.md`.
 */

/** Seed 1's sequence, as `tests/security/rls_test.sql` documents it. */
const SEED_ONE_SYMBOLS = [0, 0, 2, 3, 0, 0, 2, 2, 0, 1];

/** The perfect line the SQL suite submits with seed 1: 55 taps, ten rounds. */
const SEED_ONE_PERFECT = [
  0, 0, 0, 0, 0, 2, 0, 0, 2, 3, 0, 0, 2, 3, 0, 0, 0, 2, 3, 0, 0, 0, 0, 2, 3, 0, 0, 2, 0, 0, 2, 3, 0,
  0, 2, 2, 0, 0, 2, 3, 0, 0, 2, 2, 0, 0, 0, 2, 3, 0, 0, 2, 2, 0, 1,
];

/** Rounds one and two reproduced, then the tap that breaks the chain. */
const SEED_ONE_BROKEN = [0, 0, 0, 1];

/** Plays a whole line and returns the finished run. */
function playLine(seed: string, line: number[]): ChainRun {
  return line.reduce((run, pad) => tap(run, pad), createRun(seed));
}

describe("the sequence is the verifier's sequence", () => {
  it("deals seed 1's symbols in the order the SQL suite documents", () => {
    SEED_ONE_SYMBOLS.forEach((symbol, index) => {
      expect(symbolAt("1", index)).toBe(symbol);
    });
  });

  it("reads the high bits, so the sequence does not cycle every four draws", () => {
    // The low two bits of this LCG advance by a constant: reading them would
    // deal every seed one of four rotations of the same pattern. The first ten
    // symbols of seed 1 already disprove that.
    expect(SEED_ONE_SYMBOLS).not.toEqual([0, 3, 2, 1, 0, 3, 2, 1, 0, 3]);
    expect(new Set(SEED_ONE_SYMBOLS).size).toBeGreaterThan(2);
  });

  it("replays a seed larger than a JS safe integer exactly", () => {
    // `game_sessions.seed` is a bigint: the database's default draws from 2^63-1.
    // Rounding it to a double would draw a different sequence and the verifier
    // would reject every honest run, so the engine works in BigInt. These symbols
    // come from the generator directly, not from this module.
    const seed = "9223372036854775807";
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((i) => symbolAt(seed, i))).toEqual([
      1, 3, 3, 3, 1, 0, 1, 0,
    ]);
  });

  it("a rounded seed would have drawn a different sequence, which is the bug this guards", () => {
    const exact = [0, 1, 2, 3, 4].map((i) => symbolAt("9223372036854775807", i));
    const rounded = [0, 1, 2, 3, 4].map((i) => symbolAt(Number("9223372036854775807"), i));
    expect(rounded).not.toEqual(exact);
  });

  it("treats a degenerate zero seed the way the verifier does", () => {
    // The verifier substitutes 0x9E3779B9 for a zero state; a seed of 0 and the seed
    // that is congruent to it must therefore play identically.
    expect([0, 1, 2, 3].map((i) => symbolAt(0, i))).toEqual([0, 2, 1, 0]);
    expect([0, 1, 2, 3].map((i) => symbolAt("4294967296", i))).toEqual([0, 2, 1, 0]);
  });

  it("reduces a negative seed the way the verifier does", () => {
    expect([0, 1, 2, 3].map((i) => symbolAt("-3", i))).toEqual([2, 3, 1, 3]);
  });

  it("refuses a seed that is not a whole number", () => {
    expect(() => symbolAt("1.5", 0)).toThrow(TypeError);
    expect(() => symbolAt("pad-1", 0)).toThrow(TypeError);
    expect(() => symbolAt(1.5, 0)).toThrow(TypeError);
    expect(() => symbolAt("1", -1)).toThrow(RangeError);
  });
});

describe("a run", () => {
  it("starts on round one with the pinned rules version", () => {
    const run = createRun("1");
    expect(run.seed).toBe("1");
    expect(run.rulesVersion).toBe(CHAIN_RULES_VERSION);
    expect(run.taps).toEqual([]);
    expect(run.score).toBe(0);
    expect(run.roundsCleared).toBe(0);
    expect(run.round).toBe(1);
    expect(run.outcome).toBe("playing");
  });

  it("advances one round at a time as each round is reproduced", () => {
    let run = createRun("1");
    run = tap(run, 0);
    expect(run.round).toBe(2);
    expect(run.roundsCleared).toBe(1);
    expect(run.score).toBe(1);
    run = tap(run, 0);
    expect(run.round).toBe(2);
    expect(run.roundsCleared).toBe(1);
    run = tap(run, 0);
    expect(run.round).toBe(3);
    expect(run.roundsCleared).toBe(2);
    expect(run.score).toBe(3);
  });

  it("checks every tap against its position within its round, from the round's start", () => {
    // Round three replays [0,0,2]: the first two taps are the sequence's first
    // two symbols again, not its fourth and fifth.
    let run = playLine("1", [0, 0, 0]);
    expect(run.outcome).toBe("playing");
    run = tap(run, 0);
    expect(run.outcome).toBe("playing");
    run = tap(run, 0);
    expect(run.outcome).toBe("playing");
    run = tap(run, 2);
    expect(run.outcome).toBe("playing");
    expect(run.round).toBe(4);
  });

  it("ends the run on the first wrong tap and keeps the losing tap in the run", () => {
    const run = playLine("1", SEED_ONE_BROKEN);
    expect(run.outcome).toBe("over");
    expect(run.taps).toEqual(SEED_ONE_BROKEN);
    expect(run.score).toBe(3);
    expect(run.roundsCleared).toBe(2);
    expect(run.taps.length).toBe(4);
  });

  it("clears the run when all ten rounds are reproduced", () => {
    expect(SEED_ONE_PERFECT).toHaveLength(CHAIN_TAPS);
    const run = playLine("1", SEED_ONE_PERFECT);
    expect(run.outcome).toBe("cleared");
    expect(run.score).toBe(55);
    expect(run.roundsCleared).toBe(10);
    expect(run.round).toBe(CHAIN_ROUNDS);
  });

  it("offers no tap once the run has ended, on a missing pad, or past the last round", () => {
    const over = playLine("1", SEED_ONE_BROKEN);
    expect(canTap(over, 0)).toBe(false);
    expect(tap(over, 0)).toBe(over);

    const live = createRun("1");
    expect(canTap(live, -1)).toBe(false);
    expect(canTap(live, CHAIN_PADS)).toBe(false);
    expect(tap(live, 9)).toBe(live);

    const cleared = playLine("1", SEED_ONE_PERFECT);
    expect(canTap(cleared, 0)).toBe(false);
  });

  it("assembles the submission from the run, so the claim cannot be edited on the way out", () => {
    const run = playLine("1", SEED_ONE_BROKEN);
    expect(submission(run)).toEqual({
      rulesVersion: CHAIN_RULES_VERSION,
      actions: SEED_ONE_BROKEN,
      score: 3,
      tapsPlaced: 4,
      roundsCleared: 2,
    });
  });

  it("reports progress through the run's fifty-five taps", () => {
    expect(progress(createRun("1"))).toEqual({ taps: 0, total: 55, round: 1, rounds: 10 });
    expect(totalTapsThrough(10)).toBe(CHAIN_TAPS);
  });
});
