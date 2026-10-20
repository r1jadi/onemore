import { describe, expect, it } from "vitest";

import {
  canTap,
  createRun,
  MEMORY_FLASH_CELLS,
  MEMORY_FLASH_ROUNDS,
  MEMORY_FLASH_RULES_VERSION,
  MEMORY_FLASH_TAPS,
  patternAt,
  progress,
  submission,
  tap,
  type MemoryFlashRun,
} from "@/lib/games/memory-flash";

/**
 * The engine's tests are pinned to the *database's* numbers.
 *
 * `public.complete_memory_flash_run` is the authority: it replays the submitted
 * tap list against the seed's patterns and derives the score. Every vector below
 * is either asserted by `tests/security/rls_test.sql` for the same seed and line,
 * or computed here from the rules independently of this module. That is what makes
 * a green suite worth something — it proves agreement with the verifier, not
 * self-consistency.
 *
 * The vectors are also written down in `docs/games/README.md`.
 */

/** Seed 1's ten patterns, in draw order, as the SQL suite documents them. */
const SEED_ONE_PATTERNS = [
  [8],
  [8, 6],
  [3, 0, 8],
  [6, 2, 8, 5],
  [13, 0, 7, 1, 8],
  [3, 14, 15, 13, 7, 2],
  [15, 2, 11, 14, 8, 10, 0],
  [11, 2, 1, 10, 5, 12, 3, 13],
  [3, 14, 13, 9, 11, 8, 0, 4, 15],
  [1, 4, 7, 2, 10, 6, 9, 5, 14, 11],
];

/** The perfect line the SQL suite submits with seed 1: 55 taps, ten patterns. */
const SEED_ONE_PERFECT = SEED_ONE_PATTERNS.flat();

/** Round one reproduced, then a cell round two does not light. */
const SEED_ONE_BROKEN = [8, 8, 0];

/** Plays a whole line and returns the finished run. */
function playLine(seed: string, line: number[]): MemoryFlashRun {
  return line.reduce((run, cell) => tap(run, cell), createRun(seed));
}

describe("the patterns are the verifier's patterns", () => {
  it("lights seed 1's cells in the order the SQL suite documents", () => {
    SEED_ONE_PATTERNS.forEach((pattern, index) => {
      expect(patternAt("1", index + 1)).toEqual(pattern);
    });
  });

  it("lights exactly `round` distinct cells, all on the 4×4 board", () => {
    for (let round = 1; round <= MEMORY_FLASH_ROUNDS; round += 1) {
      const pattern = patternAt("1", round);
      expect(pattern).toHaveLength(round);
      expect(new Set(pattern).size).toBe(round);
      for (const cell of pattern) {
        expect(Number.isInteger(cell)).toBe(true);
        expect(cell).toBeGreaterThanOrEqual(0);
        expect(cell).toBeLessThan(MEMORY_FLASH_CELLS);
      }
    }
  });

  it("reads the high bits, so patterns do not repeat a sixteen-draw cycle", () => {
    // `state % 16` would walk a fixed cycle of the low four bits. The low bits
    // of this LCG have a period of sixteen, so a pattern generated that way would
    // be a slice of one repeated sequence. Seed 1's ten patterns together use
    // every cell, in a order no single cycle produces.
    const drawn = SEED_ONE_PERFECT;
    expect(new Set(drawn).size).toBe(MEMORY_FLASH_CELLS);
    expect(drawn.slice(0, 16)).not.toEqual(drawn.slice(16, 32));
  });

  it("replays the pattern of a seed larger than a JS safe integer exactly", () => {
    // `game_sessions.seed` is a bigint: the database's default draws from 2^63-1.
    // Rounding it to a double would flash different patterns and the verifier
    // would reject every honest run, so the engine works in BigInt. These
    // patterns come from the generator directly, not from this module.
    const seed = "9223372036854775807";
    expect(Array.from({ length: 4 }, (_, i) => patternAt(seed, i + 1))).toEqual([
      [5],
      [7, 3],
      [15, 5, 4],
      [5, 0, 2, 11],
    ]);
  });

  it("a rounded seed would have flashed a different pattern, which is the bug this guards", () => {
    const exact = patternAt("9223372036854775807", 10);
    const rounded = patternAt(Number("9223372036854775807"), 10);
    expect(rounded).not.toEqual(exact);
  });

  it("treats a degenerate zero seed the way the verifier does", () => {
    // 0 and 0x9E3779B9 both normalise to the same state in SQL.
    expect(patternAt("0", 5)).toEqual(patternAt("2654435769", 5));
  });

  it("reduces a negative seed the way the verifier does", () => {
    expect(patternAt("-1", 5)).toEqual(patternAt("4294967295", 5));
  });

  it("refuses a seed that is not a whole number", () => {
    expect(() => patternAt("1.5", 1)).toThrow(TypeError);
    expect(() => patternAt(1.5, 1)).toThrow(TypeError);
    expect(() => patternAt("not-a-seed", 1)).toThrow(TypeError);
  });

  it("refuses a round outside the run, rather than inventing one", () => {
    expect(() => patternAt("1", 0)).toThrow(RangeError);
    expect(() => patternAt("1", MEMORY_FLASH_ROUNDS + 1)).toThrow(RangeError);
    expect(() => patternAt("1", 1.5)).toThrow(RangeError);
  });
});

describe("a run", () => {
  it("starts on round one with the pinned rules version and no score", () => {
    const run = createRun("1");
    expect(run.seed).toBe("1");
    expect(run.rulesVersion).toBe(MEMORY_FLASH_RULES_VERSION);
    expect(run.round).toBe(1);
    expect(run.entered).toEqual([]);
    expect(run.taps).toEqual([]);
    expect(run.score).toBe(0);
    expect(run.roundsCleared).toBe(0);
    expect(run.outcome).toBe("playing");
  });

  it("keeps the seed exactly as the database sent it", () => {
    expect(createRun("9223372036854775807").seed).toBe("9223372036854775807");
    expect(createRun(42).seed).toBe("42");
  });

  it("clears a round when its pattern is rebuilt, and scores it", () => {
    const run = playLine("1", [8]);
    expect(run.score).toBe(10);
    expect(run.roundsCleared).toBe(1);
    expect(run.round).toBe(2);
    expect(run.entered).toEqual([]);
    expect(run.outcome).toBe("playing");
  });

  it("does not care about the order of a pattern", () => {
    // Round two is [8, 6]: the reverse order must clear it, because a pattern is
    // a set. Only drawing one cell twice is a mistake.
    const reversed = playLine("1", [8, 6, 8]);
    expect(reversed.outcome).toBe("playing");
    expect(reversed.round).toBe(3);
    expect(reversed.score).toBe(20);
  });

  it("keeps a partial round's taps but scores nothing for it", () => {
    const run = playLine("1", [8, 8]);
    expect(run.round).toBe(2);
    expect(run.entered).toEqual([8]);
    expect(run.score).toBe(10);
  });

  it("ends the run on a cell the pattern does not light, keeping the losing tap", () => {
    const run = playLine("1", SEED_ONE_BROKEN);
    expect(run.outcome).toBe("over");
    expect(run.taps).toEqual(SEED_ONE_BROKEN);
    expect(run.score).toBe(10);
    expect(run.roundsCleared).toBe(1);
  });

  it("ends the run on a cell already entered, rather than counting it twice", () => {
    // Round two is [8, 6]. Tapping 8 twice is a mistake: it lights no new cell.
    const run = playLine("1", [8, 8, 8]);
    expect(run.outcome).toBe("over");
    expect(run.taps).toEqual([8, 8, 8]);
    expect(run.score).toBe(10);
  });

  it("clears the run when all ten patterns are rebuilt", () => {
    const run = playLine("1", SEED_ONE_PERFECT);
    expect(run.outcome).toBe("cleared");
    expect(run.score).toBe(100); // ten rounds at ten points
    expect(run.roundsCleared).toBe(MEMORY_FLASH_ROUNDS);
    expect(run.taps).toHaveLength(MEMORY_FLASH_TAPS);
    expect(run.round).toBe(MEMORY_FLASH_ROUNDS);
  });

  it("offers no tap once the run has ended, on a missing cell, or past the last tap", () => {
    const over = playLine("1", SEED_ONE_BROKEN);
    expect(canTap(over, 8)).toBe(false);
    expect(tap(over, 8)).toBe(over);

    const fresh = createRun("1");
    expect(canTap(fresh, -1)).toBe(false);
    expect(canTap(fresh, MEMORY_FLASH_CELLS)).toBe(false);
    expect(canTap(fresh, 1.5)).toBe(false);
    expect(tap(fresh, MEMORY_FLASH_CELLS)).toBe(fresh);

    const cleared = playLine("1", SEED_ONE_PERFECT);
    expect(canTap(cleared, 0)).toBe(false);
  });

  it("is a replay, not a sequence of side effects: the same line produces the same run", () => {
    const first = playLine("1", SEED_ONE_BROKEN);
    const second = playLine("1", SEED_ONE_BROKEN);
    expect(second).toEqual(first);
  });

  it("assembles the submission from the run, so the claim cannot be edited on the way out", () => {
    const run = playLine("1", SEED_ONE_BROKEN);
    expect(submission(run)).toEqual({
      rulesVersion: MEMORY_FLASH_RULES_VERSION,
      actions: SEED_ONE_BROKEN,
      score: 10,
      tapsPlaced: 3,
      roundsCleared: 1,
    });
  });

  it("reports progress through the run's fifty-five taps", () => {
    expect(progress(createRun("1"))).toEqual({
      taps: 0,
      total: MEMORY_FLASH_TAPS,
      round: 1,
      rounds: MEMORY_FLASH_ROUNDS,
      entered: 0,
    });

    const halfway = playLine("1", SEED_ONE_PATTERNS.slice(0, 4).flat());
    expect(progress(halfway)).toMatchObject({ taps: 10, round: 5, rounds: 10, entered: 0 });
  });
});
