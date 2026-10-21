import { describe, expect, it } from "vitest";

import {
  DONT_TOUCH_CELLS,
  DONT_TOUCH_LANES,
  DONT_TOUCH_ROWS,
  DONT_TOUCH_RULES_VERSION,
  canTap,
  cellAt,
  createRun,
  deck,
  finish,
  isBlack,
  laneOf,
  progress,
  rowOf,
  submission,
  tap,
  type DontTouchRun,
} from "./dont-touch";

/**
 * Don't Touch the Black's rules, asserted rather than assumed.
 *
 * The two vectors that also appear in `tests/security/rls_test.sql` are seed 1's
 * sixty-cell deck and the runs two copies of the ruleset have to agree on: every
 * white cleared (410 points) and a cautious run that meets the black tile in row
 * six (90 points). If either engine drifts, an honest submission becomes
 * `score_mismatch` and the disagreement shows up here first.
 */

/** Seed 1's deck, `B` for a black tile and `.` for a white one. */
const SEED_ONE_DECK = "BB..BB..B..B...B..........B.B......B........B.BBBBB..B..B.B.";

/** Seed 1's white cells, in board order. */
function whiteCells(seed: string): number[] {
  return deck(seed).flatMap((black, cell) => (black ? [] : [cell]));
}

/** Plays every white cell of a seed's deck, in board order. */
function clearEveryWhite(seed: string): DontTouchRun {
  return whiteCells(seed).reduce((run, cell) => tap(run, cell), createRun(seed));
}

/**
 * Seed 1's nine whites in rows one to five, then the black tile in row six
 * (cell 15). Nine whites is 90 points, and the black tap is the ending.
 */
const LOSS_LINE = [2, 3, 6, 7, 9, 10, 12, 13, 14, 15];

describe("the deck", () => {
  it("deals seed 1's sixty cells exactly", () => {
    expect(deck("1")).toHaveLength(DONT_TOUCH_CELLS);
    expect(
      deck("1")
        .map((black) => (black ? "B" : "."))
        .join(""),
    ).toBe(SEED_ONE_DECK);
    expect(deck("1").filter(Boolean)).toHaveLength(19);
  });

  it("deals twenty rows of three lanes", () => {
    expect(DONT_TOUCH_ROWS * DONT_TOUCH_LANES).toBe(DONT_TOUCH_CELLS);
    for (let cell = 0; cell < DONT_TOUCH_CELLS; cell += 1) {
      expect(rowOf(cell)).toBeLessThan(DONT_TOUCH_ROWS);
      expect(laneOf(cell)).toBeLessThan(DONT_TOUCH_LANES);
      expect(cellAt(rowOf(cell), laneOf(cell))).toBe(cell);
    }
  });

  it("is deterministic: the same seed deals the same deck, twice", () => {
    expect(deck("1")).toEqual(deck("1"));
    expect(deck("1")).not.toEqual(deck("2"));
    expect(deck("0")).not.toEqual(deck("1"));
  });

  it("reads a full-width seed as a decimal string, not a rounded double", () => {
    // The seed is a bigint column. Parsing it as a double would deal different
    // colours and refuse every honest run.
    const wide = deck("9223372036854775807");
    expect(wide).toHaveLength(DONT_TOUCH_CELLS);
    expect(wide).toEqual(deck(9223372036854775807n));
    expect(wide).not.toEqual(deck("9223372036854775806"));
  });

  it("keeps a black tile possible but not certain", () => {
    for (let seed = 0; seed < 40; seed += 1) {
      const blacks = deck(String(seed)).filter(Boolean).length;
      expect(blacks).toBeGreaterThan(0);
      expect(blacks).toBeLessThan(DONT_TOUCH_CELLS);
    }
  });

  it("refuses a cell that is not on the deck", () => {
    expect(() => isBlack("1", -1)).toThrow(RangeError);
    expect(() => isBlack("1", DONT_TOUCH_CELLS)).toThrow(RangeError);
    expect(() => isBlack("1", 1.5)).toThrow(RangeError);
  });

  it("refuses a seed that is not a whole number", () => {
    expect(() => deck(1.5)).toThrow(TypeError);
    expect(() => deck("not-a-seed")).toThrow(TypeError);
  });
});

describe("tapping", () => {
  it("scores ten points for a white tile and records the tap", () => {
    const run = createRun("1");
    // Cell 2 is the one white tile in seed 1's opening row.
    expect(isBlack("1", 2)).toBe(false);

    const next = tap(run, 2);

    expect(next.taps).toEqual([2]);
    expect(next.cleared).toBe(1);
    expect(next.score).toBe(10);
    expect(next.outcome).toBe("playing");
    expect(next.endReason).toBeNull();
  });

  it("ends the run on a black tile, and submits the tap that ended it", () => {
    const run = createRun("1");
    expect(isBlack("1", 0)).toBe(true);

    const next = tap(run, 0);

    expect(next.taps).toEqual([0]);
    expect(next.cleared).toBe(0);
    expect(next.score).toBe(0);
    expect(next.outcome).toBe("over");
    expect(next.endReason).toBe("black");
  });

  it("does not accept a tap after the run ended", () => {
    const ended = tap(createRun("1"), 0);
    for (const cell of [1, 2, 5]) {
      expect(canTap(ended, cell)).toBe(false);
      expect(tap(ended, cell)).toBe(ended);
    }
  });

  it("ignores a tile that was already cleared", () => {
    const once = tap(createRun("1"), 2);
    expect(canTap(once, 2)).toBe(false);
    expect(tap(once, 2)).toBe(once);
    expect(once.score).toBe(10);
  });

  it("ignores a cell that is not on the deck", () => {
    const run = createRun("1");
    for (const cell of [-1, DONT_TOUCH_CELLS, 3.5]) {
      expect(canTap(run, cell)).toBe(false);
      expect(tap(run, cell)).toBe(run);
    }
  });

  it("can clear several tiles of one row", () => {
    // Row 4 (cells 12, 13, 14) is white all the way across.
    const run = [12, 13, 14].reduce((current, cell) => tap(current, cell), createRun("1"));
    expect(run.cleared).toBe(3);
    expect(run.score).toBe(30);
    expect(run.outcome).toBe("playing");
  });
});

describe("the end of a run", () => {
  it("scores every white tile of seed 1's deck", () => {
    const run = clearEveryWhite("1");
    expect(run.taps).toHaveLength(41);
    expect(run.cleared).toBe(41);
    expect(run.score).toBe(410);
    expect(run.outcome).toBe("playing");
  });

  it("ends at the end of the deck without changing the score", () => {
    const run = clearEveryWhite("1");
    const ended = finish(run);

    expect(ended.outcome).toBe("over");
    expect(ended.endReason).toBe("deck");
    expect(ended.score).toBe(run.score);
    expect(finish(ended)).toBe(ended);
  });

  it("records a run that met the black tile in row six", () => {
    const run = LOSS_LINE.reduce((current, cell) => tap(current, cell), createRun("1"));
    expect(run.score).toBe(90);
    expect(run.cleared).toBe(9);
    expect(run.outcome).toBe("over");
    expect(run.endReason).toBe("black");
    expect(run.taps.at(-1)).toBe(15);
  });

  it("never scores more than the deck holds", () => {
    const run = clearEveryWhite("1");
    expect(run.score).toBe(whiteCells("1").length * 10);
    expect(run.score).toBeLessThanOrEqual(DONT_TOUCH_CELLS * 10);
  });
});

describe("what a run submits", () => {
  it("submits the tap list, the rules version and the score it computed", () => {
    const run = LOSS_LINE.reduce((current, cell) => tap(current, cell), createRun("1"));
    expect(submission(run)).toEqual({
      rulesVersion: DONT_TOUCH_RULES_VERSION,
      actions: LOSS_LINE,
      score: 90,
    });
  });

  it("reports the deck's size, the whites cleared and the whites it holds", () => {
    const run = LOSS_LINE.reduce((current, cell) => tap(current, cell), createRun("1"));
    expect(progress(run)).toEqual({
      rows: DONT_TOUCH_ROWS,
      totalRows: DONT_TOUCH_ROWS,
      cleared: 9,
      whites: 41,
    });
  });
});
