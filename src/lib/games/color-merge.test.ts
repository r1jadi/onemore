import { describe, expect, it } from "vitest";

import {
  COLOR_MERGE_CELLS,
  COLOR_MERGE_DIRECTIONS,
  COLOR_MERGE_RULES_VERSION,
  COLOR_MERGE_SIZE,
  COLOR_MERGE_SLIDES,
  DOWN,
  LEFT,
  RIGHT,
  UP,
  bestShade,
  canMove,
  canSlide,
  createRun,
  isDirection,
  openingBoard,
  progress,
  slide,
  slideBoard,
  slideGain,
  spawnBoard,
  submission,
  tileValue,
  type ColorMergeDirection,
  type ColorMergeRun,
} from "./color-merge";

/**
 * Color Merge's rules, asserted rather than assumed.
 *
 * The two vectors that also appear in `tests/security/rls_test.sql` are seed 1's
 * forty-eight-slide deck run (272 points) and seed 15's forty-two-slide locked
 * run (184 points). Those are the runs two copies of the ruleset have to agree
 * on; if either engine drifts, an honest submission becomes `score_mismatch`
 * and the disagreement shows up here first.
 */

/** A 4×4 board from at most four rows, padded to the sixteen cells the rules use. */
function boardOf(rows: number[][]): number[] {
  const board = rows.flat();
  while (board.length < COLOR_MERGE_CELLS) board.push(0);
  return board;
}

/** The first row of a board, which is where a horizontal slide acts first. */
function firstRow(board: readonly number[]): number[] {
  return board.slice(0, COLOR_MERGE_SIZE);
}

/** Plays the first direction in `order` that changes the board, until the run ends. */
function playFirstLegal(seed: string, order: readonly ColorMergeDirection[]): ColorMergeRun {
  let run = createRun(seed);
  while (run.outcome === "playing") {
    const direction = order.find((candidate) => canSlide(run, candidate));
    if (direction === undefined) throw new Error("a live run must have a legal slide");
    run = slide(run, direction);
  }
  return run;
}

const DECK_RUN = playFirstLegal("1", [DOWN, LEFT, RIGHT, UP]);
const LOCKED_RUN = playFirstLegal("15", [RIGHT, LEFT, UP, DOWN]);

describe("the opening board", () => {
  it("deals two tiles from the seed and leaves the rest empty", () => {
    const board = openingBoard("1");
    expect(board).toHaveLength(COLOR_MERGE_CELLS);
    expect(board.filter((shade) => shade !== 0)).toHaveLength(2);
    // A seed with a small value is still a full-width draw, not a rounded one.
    expect(openingBoard("9223372036854775807")).toEqual([
      0, 0, 1, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0,
    ]);
  });

  it("is deterministic: the same seed deals the same board, twice", () => {
    expect(createRun("1").board).toEqual(createRun("1").board);
    expect(createRun("1").board).not.toEqual(createRun("2").board);
  });

  it("opens at the start of the deck, with nothing played or scored", () => {
    const run = createRun("1");
    expect(run.rulesVersion).toBe(COLOR_MERGE_RULES_VERSION);
    expect(run.moves).toEqual([]);
    expect(run.score).toBe(0);
    expect(run.outcome).toBe("playing");
    expect(run.endReason).toBeNull();
  });

  it("never overwrites a tile when it deals", () => {
    const board = spawnBoard("1", 3, openingBoard("1"));
    expect(board.filter((shade) => shade !== 0)).toHaveLength(3);
    expect(openingBoard("1").every((shade, cell) => shade === 0 || board[cell] !== 0)).toBe(true);
  });

  it("refuses a spawn index that is not a whole number from one", () => {
    expect(() => spawnBoard("1", 0, openingBoard("1"))).toThrow(RangeError);
    expect(() => spawnBoard("1", 1.5, openingBoard("1"))).toThrow(RangeError);
  });
});

describe("sliding", () => {
  it("compacts a line toward the edge it is slid to", () => {
    expect(firstRow(slideBoard(boardOf([[1, 0, 0, 2]]), LEFT))).toEqual([1, 2, 0, 0]);
    expect(firstRow(slideBoard(boardOf([[1, 0, 0, 2]]), RIGHT))).toEqual([0, 0, 1, 2]);
  });

  it("merges equal neighbours into the next shade", () => {
    expect(firstRow(slideBoard(boardOf([[1, 1, 0, 0]]), LEFT))).toEqual([2, 0, 0, 0]);
    expect(firstRow(slideBoard(boardOf([[0, 0, 2, 2]]), RIGHT))).toEqual([0, 0, 0, 3]);
    expect(
      slideBoard(
        boardOf([
          [1, 0, 0, 0],
          [1, 0, 0, 0],
          [0, 0, 0, 0],
          [0, 0, 0, 0],
        ]),
        UP,
      ),
    ).toEqual([2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("merges each tile at most once per slide", () => {
    // Four shade-1 tiles are two shade-2 tiles, never one shade-3 tile.
    expect(firstRow(slideBoard(boardOf([[1, 1, 1, 1]]), LEFT))).toEqual([2, 2, 0, 0]);
    expect(firstRow(slideBoard(boardOf([[1, 1, 1, 0]]), LEFT))).toEqual([2, 1, 0, 0]);
  });

  it("merges the pair nearest the edge, leaving the odd tile behind", () => {
    expect(firstRow(slideBoard(boardOf([[2, 1, 1, 0]]), LEFT))).toEqual([2, 2, 0, 0]);
  });

  it("moves tiles that are already at the edge without merging them", () => {
    expect(firstRow(slideBoard(boardOf([[2, 1, 2, 1]]), LEFT))).toEqual([2, 1, 2, 1]);
  });

  it("refuses a board that is not sixteen cells", () => {
    expect(() => slideBoard([1, 2], LEFT)).toThrow(RangeError);
    expect(() => canMove([1, 2])).toThrow(RangeError);
  });
});

describe("a slide as a move", () => {
  it("records the direction and scores the tiles the merge created", () => {
    const run = createRun("1");
    // The opening board's two shade-1 tiles sit side by side, so sliding left
    // merges them into a shade-2 tile worth four points.
    expect(slideGain(run.board, LEFT)).toBe(4);

    const next = slide(run, LEFT);

    expect(next.moves).toEqual([LEFT]);
    expect(next.score).toBe(4);
    // Two tiles became one, and the slide dealt one: still two tiles, and the
    // dealt tile is worth nothing until it merges.
    expect(next.board.filter((shade) => shade !== 0)).toHaveLength(2);
  });

  it("does not record a direction that changes nothing", () => {
    // The opening board is two tiles on the last row: sliding down is a no-op.
    const run = createRun("1");
    expect(canSlide(run, DOWN)).toBe(false);
    expect(slide(run, DOWN)).toBe(run);
    expect(run.moves).toHaveLength(0);
  });

  it("ignores a slide once the run has ended", () => {
    const run = { ...LOCKED_RUN };
    expect(canSlide(run, LEFT)).toBe(false);
    for (const direction of COLOR_MERGE_DIRECTIONS) {
      expect(slide(run, direction)).toBe(run);
    }
  });

  it("ignores a direction that is not one of the four", () => {
    const run = createRun("1");
    expect(isDirection(4)).toBe(false);
    expect(isDirection(-1)).toBe(false);
    expect(slide(run, 4 as ColorMergeDirection)).toBe(run);
  });

  it("tiles only ever double, never shrink", () => {
    let run = createRun("3");
    let previous = bestShade(run.board);
    while (run.outcome === "playing") {
      const direction = COLOR_MERGE_DIRECTIONS.find((candidate) => canSlide(run, candidate));
      run = slide(run, direction as ColorMergeDirection);
      const shade = bestShade(run.board);
      expect(shade).toBeGreaterThanOrEqual(previous);
      previous = shade;
    }
  });
});

describe("the end of a run", () => {
  it("ends after the deck's forty-eight slides", () => {
    expect(DECK_RUN.outcome).toBe("over");
    expect(DECK_RUN.endReason).toBe("deck");
    expect(DECK_RUN.moves).toHaveLength(COLOR_MERGE_SLIDES);
    expect(DECK_RUN.score).toBe(272);
    expect(DECK_RUN.board).toEqual([1, 0, 0, 0, 2, 1, 0, 0, 4, 3, 2, 1, 5, 4, 3, 3]);
  });

  it("ends early when the board locks, and says so", () => {
    expect(LOCKED_RUN.outcome).toBe("over");
    expect(LOCKED_RUN.endReason).toBe("locked");
    expect(LOCKED_RUN.moves).toHaveLength(42);
    expect(LOCKED_RUN.score).toBe(184);
    expect(LOCKED_RUN.board).toEqual([1, 2, 4, 1, 3, 4, 1, 3, 1, 3, 4, 2, 2, 1, 2, 1]);
    expect(canMove(LOCKED_RUN.board)).toBe(false);
  });

  it("knows a full board with no equal neighbours is locked", () => {
    expect(canMove([1, 2, 1, 2, 2, 1, 2, 1, 1, 2, 1, 2, 2, 1, 2, 1])).toBe(false);
  });

  it("knows an empty cell or a matching pair is a move", () => {
    expect(canMove([1, 2, 1, 2, 2, 1, 2, 1, 1, 2, 1, 2, 2, 1, 2, 0])).toBe(true);
    expect(canMove([1, 1, 2, 3, 2, 3, 1, 2, 3, 1, 2, 3, 1, 2, 3, 1])).toBe(true);
  });

  it("never plays more slides than the deck holds", () => {
    expect(DECK_RUN.moves.length).toBeLessThanOrEqual(COLOR_MERGE_SLIDES);
    expect(slide(DECK_RUN, LEFT)).toBe(DECK_RUN);
  });

  it("stops a deck run on the slide that empties the deck, without dealing again", () => {
    let run = createRun("1");
    while (run.moves.length < COLOR_MERGE_SLIDES - 1) {
      const direction = COLOR_MERGE_DIRECTIONS.find((candidate) => canSlide(run, candidate));
      run = slide(run, direction as ColorMergeDirection);
    }
    const before = run.board;
    const final = slide(
      run,
      COLOR_MERGE_DIRECTIONS.find((candidate) => canSlide(run, candidate))!,
    );

    expect(final.endReason).toBe("deck");
    expect(final.board).toEqual(slideBoard(before, final.moves[final.moves.length - 1]));
  });
});

describe("what a run submits", () => {
  it("submits the move list, the rules version and the score it computed", () => {
    expect(submission(DECK_RUN)).toEqual({
      rulesVersion: COLOR_MERGE_RULES_VERSION,
      actions: DECK_RUN.moves,
      score: 272,
    });
  });

  it("reports progress from the moves played and the best tile", () => {
    expect(progress(DECK_RUN)).toEqual({
      slides: COLOR_MERGE_SLIDES,
      total: COLOR_MERGE_SLIDES,
      best: tileValue(bestShade(DECK_RUN.board)),
    });
  });

  it("reads a shade as the number on its face", () => {
    expect(tileValue(1)).toBe(2);
    expect(tileValue(2)).toBe(4);
    expect(tileValue(5)).toBe(32);
    expect(bestShade([0, 3, 1])).toBe(3);
    expect(bestShade([0, 0])).toBe(0);
  });
});
