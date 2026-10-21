import { describe, expect, it } from "vitest";

import {
  boardPattern,
  boardSize,
  canTap,
  cellCount,
  createRun,
  crossCells,
  ONE_MOVE_LEVELS,
  ONE_MOVE_RULES_VERSION,
  ONE_MOVE_TAPS,
  progress,
  solvedCell,
  submission,
  tap,
  winningCell,
  type OneMoveRun,
} from "@/lib/games/one-move";

/**
 * The engine's tests are pinned to the *database's* numbers.
 *
 * `public.complete_one_move_run` is the authority: it replays the submitted taps
 * against the seed's winning cells and derives the score. Every vector below is
 * either asserted by `tests/security/rls_test.sql` for the same seed and line, or
 * computed here from the rules independently of this module. That is what makes a
 * green suite worth something — it proves agreement with the verifier, not
 * self-consistency.
 *
 * The vectors are also written down in `docs/games/README.md`.
 */

/** Seed 1's twelve winning cells, in level order, as the SQL suite documents them. */
const SEED_ONE_CENTERS = [7, 8, 7, 7, 0, 8, 6, 2, 5, 18, 13, 5];

/** The perfect line the SQL suite submits with seed 1: twelve taps, 120 points. */
const SEED_ONE_PERFECT = SEED_ONE_CENTERS;

/** Plays a whole line and returns the finished run. */
function playLine(seed: string, line: number[]): OneMoveRun {
  return line.reduce((run, cell) => tap(run, cell), createRun(seed));
}

/** Whether flipping `candidate`'s cross on `cells` restores the checkerboard. */
function restores(level: number, cells: readonly boolean[], candidate: number): boolean {
  const flipped = new Set(crossCells(level, candidate));
  return cells.every(
    (dark, index) => (flipped.has(index) ? !dark : dark) === solvedCell(level, index),
  );
}

describe("the winning cell is the verifier's cell", () => {
  it("draws seed 1's twelve winning cells in the order the SQL suite documents", () => {
    SEED_ONE_CENTERS.forEach((cell, index) => {
      expect(winningCell("1", index + 1)).toBe(cell);
    });
  });

  it("grows the board from 3×3 to 4×4 to 5×5", () => {
    expect(Array.from({ length: ONE_MOVE_LEVELS }, (_, i) => boardSize(i + 1))).toEqual([
      3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5,
    ]);
    expect(cellCount(1)).toBe(9);
    expect(cellCount(5)).toBe(16);
    expect(cellCount(9)).toBe(25);
  });

  it("replays a seed larger than a JS safe integer exactly", () => {
    // `game_sessions.seed` is a bigint: the database's default draws from 2^63-1.
    // Rounding it to a double would win on different cells and the verifier
    // would reject every honest run, so the engine works in BigInt.
    const seed = "9223372036854775807";
    expect(Array.from({ length: ONE_MOVE_LEVELS }, (_, i) => winningCell(seed, i + 1))).toEqual([
      1, 8, 6, 6, 5, 4, 5, 0, 24, 13, 3, 7,
    ]);
  });

  it("a rounded seed would have won on a different cell, which is the bug this guards", () => {
    expect(winningCell(Number("9223372036854775807"), 12)).not.toBe(
      winningCell("9223372036854775807", 12),
    );
  });

  it("treats a degenerate zero seed the way the verifier does", () => {
    for (let level = 1; level <= ONE_MOVE_LEVELS; level += 1) {
      expect(winningCell("0", level)).toBe(winningCell("2654435769", level));
    }
  });

  it("reduces a negative seed the way the verifier does", () => {
    for (let level = 1; level <= ONE_MOVE_LEVELS; level += 1) {
      expect(winningCell("-1", level)).toBe(winningCell("4294967295", level));
    }
  });

  it("refuses a seed that is not a whole number", () => {
    expect(() => winningCell("1.5", 1)).toThrow(TypeError);
    expect(() => winningCell(1.5, 1)).toThrow(TypeError);
    expect(() => winningCell("not-a-seed", 1)).toThrow(TypeError);
  });

  it("refuses a level outside the run, rather than inventing one", () => {
    expect(() => winningCell("1", 0)).toThrow(RangeError);
    expect(() => winningCell("1", ONE_MOVE_LEVELS + 1)).toThrow(RangeError);
    expect(() => winningCell("1", 1.5)).toThrow(RangeError);
  });
});

describe("a board has exactly one winning move", () => {
  it("flips a cross: the cell, its neighbours, and no cell off the board", () => {
    // A corner on the 3×3 board has three cells in its cross, an edge four, the
    // middle five.
    expect(crossCells(1, 0).sort((a, b) => a - b)).toEqual([0, 1, 3]);
    expect(crossCells(1, 1).sort((a, b) => a - b)).toEqual([0, 1, 2, 4]);
    expect(crossCells(1, 4).sort((a, b) => a - b)).toEqual([1, 3, 4, 5, 7]);
    // A corner of the 5×5 board, same truncation rule.
    expect(crossCells(9, 24).sort((a, b) => a - b)).toEqual([19, 23, 24]);
    for (const level of [1, 5, 9]) {
      for (const cell of crossCells(level, 0)) {
        expect(cell).toBeGreaterThanOrEqual(0);
        expect(cell).toBeLessThan(cellCount(level));
      }
    }
  });

  it("shows a checkerboard with the winning cross flipped, and nothing else", () => {
    for (let level = 1; level <= ONE_MOVE_LEVELS; level += 1) {
      const board = boardPattern("1", level);
      const flipped = new Set(crossCells(level, board.center));
      expect(board.center).toBe(winningCell("1", level));
      expect(board.cells).toHaveLength(cellCount(level));
      board.cells.forEach((dark, index) => {
        expect(dark).toBe(
          flipped.has(index) ? !solvedCell(level, index) : solvedCell(level, index),
        );
      });
      // Not already solved, or there would be nothing to find.
      expect(board.cells.some((dark, index) => dark !== solvedCell(level, index))).toBe(true);
    }
  });

  it("is restored by exactly one tap on every level of seed 1", () => {
    for (let level = 1; level <= ONE_MOVE_LEVELS; level += 1) {
      const board = boardPattern("1", level);
      const winners = Array.from({ length: cellCount(level) }, (_, cell) => cell).filter((cell) =>
        restores(level, board.cells, cell),
      );
      expect(winners).toEqual([board.center]);
    }
  });

  it("is restored by exactly one tap on every level of the widest seed", () => {
    const seed = "9223372036854775807";
    for (let level = 1; level <= ONE_MOVE_LEVELS; level += 1) {
      const board = boardPattern(seed, level);
      const winners = Array.from({ length: cellCount(level) }, (_, cell) => cell).filter((cell) =>
        restores(level, board.cells, cell),
      );
      expect(winners).toEqual([board.center]);
    }
  });
});

describe("a run", () => {
  it("starts on board one with the pinned rules version and no score", () => {
    const run = createRun("1");
    expect(run.seed).toBe("1");
    expect(run.rulesVersion).toBe(ONE_MOVE_RULES_VERSION);
    expect(run.level).toBe(1);
    expect(run.taps).toEqual([]);
    expect(run.score).toBe(0);
    expect(run.levelsCleared).toBe(0);
    expect(run.outcome).toBe("playing");
  });

  it("keeps the seed exactly as the database sent it", () => {
    expect(createRun("9223372036854775807").seed).toBe("9223372036854775807");
    expect(createRun(42).seed).toBe("42");
  });

  it("restores a board and scores it when the winning cell is tapped", () => {
    const run = playLine("1", [7]);
    expect(run.score).toBe(10);
    expect(run.levelsCleared).toBe(1);
    expect(run.level).toBe(2);
    expect(run.outcome).toBe("playing");
  });

  it("ends the run on any other cell, keeping the losing tap", () => {
    const run = playLine("1", [0]);
    expect(run.outcome).toBe("over");
    expect(run.taps).toEqual([0]);
    expect(run.score).toBe(0);
    expect(run.levelsCleared).toBe(0);
  });

  it("does not let a cell from the previous board win the next one", () => {
    // Board one wins on 7; board two wins on 8. A player who taps 7 again has not
    // found board two's move.
    const run = playLine("1", [7, 7]);
    expect(run.outcome).toBe("over");
    expect(run.score).toBe(10);
    expect(run.levelsCleared).toBe(1);
    expect(run.level).toBe(2);
  });

  it("clears the run when all twelve boards are restored", () => {
    const run = playLine("1", SEED_ONE_PERFECT);
    expect(run.outcome).toBe("cleared");
    expect(run.score).toBe(120); // twelve boards at ten points
    expect(run.levelsCleared).toBe(ONE_MOVE_LEVELS);
    expect(run.taps).toHaveLength(ONE_MOVE_TAPS);
    expect(run.level).toBe(ONE_MOVE_LEVELS);
  });

  it("keeps the boards restored before a losing tap", () => {
    const run = playLine("1", [7, 8, 7, 0]);
    expect(run.outcome).toBe("over");
    expect(run.score).toBe(30);
    expect(run.levelsCleared).toBe(3);
    expect(run.taps).toEqual([7, 8, 7, 0]);
  });

  it("offers no tap once the run has ended, off the current board, or past the last tap", () => {
    const over = playLine("1", [0]);
    expect(canTap(over, 7)).toBe(false);
    expect(tap(over, 7)).toBe(over);

    const fresh = createRun("1");
    expect(canTap(fresh, -1)).toBe(false);
    expect(canTap(fresh, 9)).toBe(false);
    expect(canTap(fresh, 1.5)).toBe(false);
    expect(tap(fresh, 9)).toBe(fresh);

    // The board grows, so the same engine accepts a cell that only exists later…
    const fifth = playLine("1", SEED_ONE_CENTERS.slice(0, 4));
    expect(fifth.level).toBe(5);
    expect(canTap(fifth, 15)).toBe(true);
    // …but not a cell past the current board's edge.
    expect(canTap(fifth, 16)).toBe(false);

    const cleared = playLine("1", SEED_ONE_PERFECT);
    expect(canTap(cleared, 0)).toBe(false);
  });

  it("is a replay, not a sequence of side effects: the same line produces the same run", () => {
    const first = playLine("1", [7, 8, 0]);
    const second = playLine("1", [7, 8, 0]);
    expect(second).toEqual(first);
  });

  it("assembles the submission from the run, so the claim cannot be edited on the way out", () => {
    const run = playLine("1", [7, 0]);
    expect(submission(run)).toEqual({
      rulesVersion: ONE_MOVE_RULES_VERSION,
      actions: [7, 0],
      score: 10,
      tapsPlaced: 2,
      levelsCleared: 1,
    });
  });

  it("reports progress through the run's twelve taps", () => {
    expect(progress(createRun("1"))).toEqual({
      taps: 0,
      total: ONE_MOVE_TAPS,
      level: 1,
      levels: 12,
    });
    const halfway = playLine("1", SEED_ONE_CENTERS.slice(0, 6));
    expect(progress(halfway)).toMatchObject({ taps: 6, level: 7, levels: 12 });
  });
});
