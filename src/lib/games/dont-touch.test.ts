import { describe, expect, it } from "vitest";

import {
  DONT_TOUCH_LANES,
  DONT_TOUCH_MAX_CELLS,
  DONT_TOUCH_MAX_ROWS,
  DONT_TOUCH_RULES_VERSION,
  blackPercent,
  canTap,
  cellAt,
  createRun,
  finish,
  isBlack,
  laneOf,
  progress,
  rowAt,
  rowOf,
  rowWindow,
  submission,
  tap,
  type DontTouchRun,
} from "./dont-touch";

/**
 * Don't Touch the Black's endless rules, asserted rather than assumed.
 *
 * The vectors that also appear in `tests/security/rls_test.sql` are seed 1's
 * opening rows and the runs two copies of the ruleset have to agree on: every
 * white cleared for twenty-five rows (560 points, still playing), and a cautious
 * run that meets the black tile in the opening row (20 points). If either engine drifts,
 * an honest submission becomes `score_mismatch` and the disagreement shows up
 * here first.
 *
 * Two things are deliberately checked past the old twenty-row deck: a run of a
 * hundred rows still scores and plays on, and the density ramp — not the colour
 * generator — is what turns a cell black once the conveyor is ten rows deep.
 */

/** Seed 1's first twelve rows, `B` for black and `.` for white. */
const SEED_ONE_ROWS = [
  ".B.",
  ".BB",
  "...",
  ".B.",
  "B.B",
  ".BB",
  "...",
  ".B.",
  "B.B",
  "..B",
  ".B.",
  "..B",
];

/** Seed 1's white cells in rows one to twenty-five, in conveyor order. */
const TWENTY_FIVE_ROWS = [
  0, 2, 3, 6, 7, 8, 9, 11, 13, 15, 18, 19, 20, 21, 23, 25, 27, 28, 30, 32, 33, 34, 36, 37, 38, 40,
  41, 42, 43, 44, 46, 47, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66,
  68, 69, 70, 71, 73, 74,
];

/**
 * Seed 1's opening row: clear cell 0, clear cell 2, then touch the black tile at
 * cell 1. Two whites is 20 points, and the black tap is the ending.
 */
const LOSS_LINE = [0, 2, 1];

function play(cells: readonly number[], seed = "1"): DontTouchRun {
  return cells.reduce((run, cell) => tap(run, cell), createRun(seed));
}

function whitesBetween(seed: string, from: number, to: number): number[] {
  const cells: number[] = [];
  for (let row = from; row < to; row += 1) {
    const colours = rowAt(seed, row);
    for (let lane = 0; lane < DONT_TOUCH_LANES; lane += 1) {
      if (!colours[lane]) cells.push(cellAt(row, lane));
    }
  }
  return cells;
}

describe("the conveyor", () => {
  it("deals seed 1's opening rows exactly", () => {
    const rows = SEED_ONE_ROWS.map((_, row) =>
      rowAt("1", row)
        .map((black) => (black ? "B" : "."))
        .join(""),
    );
    expect(rows).toEqual(SEED_ONE_ROWS);
  });

  it("deals three lanes per row forever, up to the submission bound", () => {
    expect(DONT_TOUCH_MAX_ROWS * DONT_TOUCH_LANES).toBe(DONT_TOUCH_MAX_CELLS);
    for (const cell of [0, 1, 2, 59, 60, 4094]) {
      expect(rowOf(cell)).toBeLessThan(DONT_TOUCH_MAX_ROWS);
      expect(laneOf(cell)).toBeLessThan(DONT_TOUCH_LANES);
      expect(cellAt(rowOf(cell), laneOf(cell))).toBe(cell);
    }
    // A hundred rows are as ordinary as the first twenty; there is no last one.
    expect(rowAt("1", 99)).toHaveLength(DONT_TOUCH_LANES);
  });

  it("is deterministic: the same seed deals the same rows, twice", () => {
    expect(rowAt("1", 137)).toEqual(rowAt("1", 137));
    expect(rowAt("1", 137)).not.toEqual(rowAt("2", 137));
    expect(rowAt("0", 0)).not.toEqual(rowAt("1", 0));
  });

  it("reads a full-width seed as a decimal string, not a rounded double", () => {
    // The seed is a bigint column. Parsing it as a double would deal different
    // colours and refuse every honest run.
    const wide = rowAt("9223372036854775807", 0);
    expect(wide).toEqual(rowAt(9223372036854775807n, 0));
    expect(wide).not.toEqual(rowAt("9223372036854775806", 0));
  });

  it("refuses a row or a cell that is not on the conveyor", () => {
    expect(() => rowAt("1", -1)).toThrow(RangeError);
    expect(() => rowAt("1", DONT_TOUCH_MAX_ROWS)).toThrow(RangeError);
    expect(() => rowAt("1", 1.5)).toThrow(RangeError);
    expect(() => isBlack("1", -1)).toThrow(RangeError);
    expect(() => isBlack("1", DONT_TOUCH_MAX_CELLS)).toThrow(RangeError);
    expect(() => isBlack("1", 1.5)).toThrow(RangeError);
  });

  it("refuses a seed that is not a whole number", () => {
    expect(() => rowAt(1.5, 0)).toThrow(TypeError);
    expect(() => rowAt("not-a-seed", 0)).toThrow(TypeError);
  });
});

describe("the difficulty curves", () => {
  it("starts at 25% black and adds a point every ten rows, capped at 45%", () => {
    expect(blackPercent(0)).toBe(25);
    expect(blackPercent(9)).toBe(25);
    expect(blackPercent(10)).toBe(26);
    expect(blackPercent(20)).toBe(27);
    expect(blackPercent(199)).toBe(44);
    expect(blackPercent(200)).toBe(45);
    expect(blackPercent(DONT_TOUCH_MAX_ROWS - 1)).toBe(45);
  });

  it("never lightens a row as the conveyor goes on", () => {
    let previous = blackPercent(0);
    for (let row = 1; row < DONT_TOUCH_MAX_ROWS; row += 1) {
      const current = blackPercent(row);
      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });

  it("turns a cell black by density, not by a different draw", () => {
    // Seed 0's cell 41 draws 25: white at the opening 25%, black from the moment
    // row 13's density is 26%. A density ramp that did not reach the verifier
    // would leave this cell white forever.
    expect(rowOf(41)).toBe(13);
    expect(blackPercent(13)).toBe(26);
    expect(rowAt("0", 13)[2]).toBe(true);
    expect(isBlack("0", 41)).toBe(true);
  });

  it("quickens the row window, then eases toward a floor without reaching it", () => {
    expect(rowWindow(0)).toBe(1600);
    expect(rowWindow(20)).toBe(700);
    expect(rowWindow(1364)).toBeGreaterThan(650);
    expect(rowWindow(1364)).toBeLessThan(rowWindow(500));

    let previous = rowWindow(0);
    for (let row = 1; row < DONT_TOUCH_MAX_ROWS; row += 1) {
      const current = rowWindow(row);
      expect(current).toBeLessThanOrEqual(previous);
      expect(current).toBeGreaterThan(650);
      previous = current;
    }
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
    expect(isBlack("1", 1)).toBe(true);

    const next = tap(run, 1);

    expect(next.taps).toEqual([1]);
    expect(next.cleared).toBe(0);
    expect(next.score).toBe(0);
    expect(next.outcome).toBe("over");
    expect(next.endReason).toBe("black");
  });

  it("does not accept a tap after the run ended", () => {
    const ended = tap(createRun("1"), 1);
    for (const cell of [0, 2, 5]) {
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

  it("ignores a cell that is not on the conveyor", () => {
    const run = createRun("1");
    for (const cell of [-1, DONT_TOUCH_MAX_CELLS, 3.5]) {
      expect(canTap(run, cell)).toBe(false);
      expect(tap(run, cell)).toBe(run);
    }
  });

  it("can clear several tiles of one row", () => {
    // Row 2 (cells 6, 7 and 8) is white all the way across.
    const run = play([6, 7, 8]);
    expect(run.cleared).toBe(3);
    expect(run.score).toBe(30);
    expect(run.outcome).toBe("playing");
  });
});

describe("endless progression", () => {
  it("plays past the old twenty-row deck without stopping", () => {
    const run = play(whitesBetween("1", 0, 25));
    expect(run.taps).toHaveLength(TWENTY_FIVE_ROWS.length);
    expect(run.taps).toEqual(TWENTY_FIVE_ROWS);
    expect(run.cleared).toBe(56);
    expect(run.score).toBe(560);
    expect(run.outcome).toBe("playing");
  });

  it("keeps scoring a hundred rows into the conveyor", () => {
    const cells = whitesBetween("1", 0, 100);
    const run = play(cells);
    expect(cells).toHaveLength(206);
    expect(run.score).toBe(2060);
    expect(run.outcome).toBe("playing");
  });

  it("offers a next row at the old endpoint, with a tighter beat", () => {
    // Row 20 no longer ends anything; the run is still live and the window has
    // fallen from 1.6 s to 0.7 s.
    const run = play(whitesBetween("1", 0, 20));
    expect(run.outcome).toBe("playing");
    expect(rowWindow(20)).toBeLessThan(rowWindow(0));
    expect(rowAt("1", 20)).toHaveLength(DONT_TOUCH_LANES);
  });
});

describe("the end of a run", () => {
  it("ends a stopped run without changing the score", () => {
    const run = play(TWENTY_FIVE_ROWS);
    const ended = finish(run);

    expect(ended.outcome).toBe("over");
    expect(ended.endReason).toBe("stop");
    expect(ended.score).toBe(560);
    expect(ended.taps).toEqual(run.taps);
    expect(finish(ended)).toBe(ended);
  });

  it("ends a run that touched nothing", () => {
    const ended = finish(createRun("1"));
    expect(ended.outcome).toBe("over");
    expect(ended.endReason).toBe("stop");
    expect(ended.score).toBe(0);
    expect(submission(ended)).toEqual({
      rulesVersion: DONT_TOUCH_RULES_VERSION,
      actions: [],
      score: 0,
    });
  });

  it("does not let a stop replace the black tile that ended the run", () => {
    const lost = play(LOSS_LINE);
    expect(lost.endReason).toBe("black");
    expect(finish(lost)).toBe(lost);
    expect(lost.taps.at(-1)).toBe(1);
  });

  it("records a run that met the black tile in row six", () => {
    const run = play(LOSS_LINE);
    expect(run.score).toBe(20);
    expect(run.cleared).toBe(2);
    expect(run.outcome).toBe("over");
    expect(run.endReason).toBe("black");
    expect(run.taps.at(-1)).toBe(1);
  });

  it("never scores more than it cleared", () => {
    const run = play(whitesBetween("1", 0, 100));
    expect(run.score).toBe(run.cleared * 10);
    expect(run.score).toBeLessThanOrEqual(DONT_TOUCH_MAX_CELLS * 10);
  });
});

describe("what a run submits", () => {
  it("submits the tap list, the rules version and the score it computed", () => {
    const run = play(LOSS_LINE);
    expect(submission(run)).toEqual({
      rulesVersion: DONT_TOUCH_RULES_VERSION,
      actions: LOSS_LINE,
      score: 20,
    });
  });

  it("reports the row it reached and the whites it cleared, with no total", () => {
    const run = play(LOSS_LINE);
    expect(progress(run)).toEqual({ cleared: 2, row: 1 });
    expect(progress(createRun("1"))).toEqual({ cleared: 0, row: 0 });
    expect(progress(play(whitesBetween("1", 0, 100)))).toEqual({ cleared: 206, row: 100 });
  });
});
