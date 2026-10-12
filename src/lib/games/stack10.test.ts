import { describe, expect, it } from "vitest";

import {
  canPlace,
  createRun,
  place,
  progress,
  STACK10_COLUMNS,
  STACK10_RULES_VERSION,
  STACK10_TILES,
  submission,
  tileAt,
  type Stack10Run,
} from "@/lib/games/stack10";

/**
 * The engine's tests are pinned to the *database's* numbers.
 *
 * `public.complete_stack10_run` is the authority: it replays the submitted action
 * list and derives the score. Every vector below is either asserted by
 * `tests/security/rls_test.sql` for the same seed and line, or computed here from
 * the rules independently of this module. That is what makes a green suite worth
 * something — it proves agreement with the verifier, not self-consistency.
 *
 * The vectors are also written down in `docs/games/README.md`.
 */

/** Seed 1's deck, as `tests/security/rls_test.sql` documents it. */
const SEED_ONE_TILES = [1, 7, 9, 2, 2, 5, 4, 6, 7, 8, 3, 4, 3, 5];

/** The greedy line the SQL suite submits with seed 1: 55 points, 14 tiles, over. */
const SEED_ONE_GREEDY = [0, 0, 1, 0, 0, 0, 2, 2, 2, 3, 0, 0, 0, 0];

/** A perfect line for seed 1: all sixty tiles placed. */
const SEED_ONE_PERFECT = [
  0, 0, 1, 0, 0, 0, 2, 2, 2, 3, 0, 0, 2, 0, 2, 2, 0, 0, 2, 0, 2, 2, 3, 2, 2, 2, 2, 3, 0, 1, 0, 0, 0,
  0, 0, 2, 1, 2, 1, 0, 0, 2, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 3, 1, 1, 2, 1, 1, 0,
];

/** Plays a whole line and returns the finished run. */
function playLine(seed: string, line: number[]): Stack10Run {
  return line.reduce((run, column) => place(run, column), createRun(seed));
}

describe("the deck is the verifier's deck", () => {
  it("draws seed 1's tiles in the order the SQL suite documents", () => {
    SEED_ONE_TILES.forEach((tile, index) => {
      expect(tileAt("1", index)).toBe(tile);
    });
  });

  it("shows the next tile before the player chooses, because the tile does not depend on the column", () => {
    const run = createRun("1");
    expect(run.nextTile).toBe(SEED_ONE_TILES[0]);
    // The same tile whichever column the move goes into, so a board can display it.
    expect(place(run, 0).nextTile).toBe(SEED_ONE_TILES[1]);
    expect(place(run, 3).nextTile).toBe(SEED_ONE_TILES[1]);
  });

  it("replays a seed larger than a JS safe integer exactly", () => {
    // `game_sessions.seed` is a bigint: the database's default draws from 2^63-1.
    // Rounding it to a double would draw a different deck and the verifier would
    // reject every honest run, so the engine works in BigInt. These tiles come from
    // the generator directly, not from this module.
    const seed = "9223372036854775807";
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((i) => tileAt(seed, i))).toEqual([6, 2, 9, 4, 5, 3, 6, 1]);
    expect(createRun(seed).nextTile).toBe(6);
  });

  it("a rounded seed would have drawn a different deck, which is the bug this guards", () => {
    const exact = [0, 1, 2, 3, 4].map((i) => tileAt("9223372036854775807", i));
    const rounded = [0, 1, 2, 3, 4].map((i) => tileAt(Number("9223372036854775807"), i));
    expect(rounded).not.toEqual(exact);
  });

  it("treats a degenerate zero seed the way the verifier does", () => {
    // The verifier substitutes 0x9E3779B9 for a zero state; a seed of 0 and the seed
    // that is congruent to it must therefore play identically.
    expect([0, 1, 2, 3].map((i) => tileAt(0, i))).toEqual([5, 7, 7, 3]);
    expect([0, 1, 2, 3].map((i) => tileAt("4294967296", i))).toEqual([5, 7, 7, 3]);
  });

  it("refuses a seed that is not a whole number", () => {
    expect(() => createRun("not-a-seed")).toThrow(TypeError);
    expect(() => tileAt(1.5, 0)).toThrow(TypeError);
    expect(() => tileAt("1", -1)).toThrow(RangeError);
  });
});

describe("clearing is the arithmetic the verifier scores with", () => {
  it("scores the documented greedy run at 55 over 14 tiles", () => {
    const run = playLine("1", SEED_ONE_GREEDY);

    // Three clears: 1+7+2 (three tiles, 20), 4+6 (two tiles, 15) and 3+4+3 (three
    // tiles, 20). The fourth move clears, the eighth clears, the eleventh clears.
    expect(run.clearedColumns).toBe(3);
    expect(run.score).toBe(55);
    expect(run.actions).toHaveLength(14);
    expect(run.outcome).toBe("over");
    expect(run.nextTile).toBeNull();
  });

  it("adds the score at the move that cleared, not at the end", () => {
    let run = createRun("1");
    [0, 0, 1].forEach((column) => {
      run = place(run, column);
    });
    expect(run.score).toBe(0);
    expect(run.columns[0].sum).toBe(8);

    run = place(run, 0); // 8 + 2 = 10: clears a three-tile column for 20
    expect(run.score).toBe(20);
    expect(run.columns[0]).toEqual({ tiles: [], sum: 0 });
    expect(run.clearedColumns).toBe(1);
  });

  it("scores a two-tile clear at 15 and a three-tile clear at 20", () => {
    const run = playLine("1", SEED_ONE_GREEDY.slice(0, 8));
    // 20 for the three-tile clear, 15 for the two-tile one (4 + 6 in column 2).
    expect(run.score).toBe(35);
    expect(run.clearedColumns).toBe(2);
    expect(run.columns[2]).toEqual({ tiles: [], sum: 0 });
  });

  it("ends the run when a column passes ten, and keeps the score already earned", () => {
    const run = playLine("1", SEED_ONE_GREEDY);
    // The fourteenth tile is a 5 into a column already holding 7.
    expect(run.columns[0].sum).toBe(12);
    expect(run.score).toBe(55);
  });

  it("plays a perfect line: every one of the sixty tiles", () => {
    const run = playLine("1", SEED_ONE_PERFECT);
    expect(run.outcome).toBe("cleared");
    expect(run.actions).toHaveLength(STACK10_TILES);
    expect(run.nextTile).toBeNull();
    // The best score this deck allows, computed from the rules independently of
    // this module: twenty-five clears, none more than three tiles deep, and one
    // tile left on the board.
    expect(run.score).toBe(420);
    expect(run.clearedColumns).toBe(25);
    expect(run.columns.reduce((sum, column) => sum + column.tiles.length, 0)).toBe(1);
    expect(run.columns.every((column) => column.sum <= 10)).toBe(true);
  });
});

describe("an impossible move is not a move", () => {
  it("refuses a column that does not exist, and returns the same run", () => {
    const run = createRun("1");
    expect(place(run, -1)).toBe(run);
    expect(place(run, STACK10_COLUMNS)).toBe(run);
    expect(place(run, 1.5)).toBe(run);
    expect(canPlace(run, 0)).toBe(true);
    expect(canPlace(run, STACK10_COLUMNS)).toBe(false);
  });

  it("refuses to keep playing after the run has ended", () => {
    const run = playLine("1", SEED_ONE_GREEDY);
    expect(run.outcome).toBe("over");
    expect(canPlace(run, 0)).toBe(false);
    expect(place(run, 0)).toBe(run);
    expect(run.actions).toHaveLength(14);
  });

  it("refuses to keep playing after the board is cleared", () => {
    const run = playLine("1", SEED_ONE_PERFECT);
    expect(canPlace(run, 0)).toBe(false);
    expect(place(run, 0)).toBe(run);
  });

  it("does not mutate the run it was given", () => {
    const before = createRun("1");
    const after = place(before, 0);
    expect(before.actions).toEqual([]);
    expect(before.columns[0]).toEqual({ tiles: [], sum: 0 });
    expect(before.score).toBe(0);
    expect(after.actions).toEqual([0]);
    expect(after.columns[0]).toEqual({ tiles: [1], sum: 1 });
  });
});

describe("the submission is the run", () => {
  it("sends the action list, the score and the rules version the session pinned", () => {
    const run = playLine("1", SEED_ONE_GREEDY);
    expect(submission(run)).toEqual({
      rulesVersion: STACK10_RULES_VERSION,
      actions: SEED_ONE_GREEDY,
      score: 55,
      tilesPlaced: 14,
      clearedColumns: 3,
    });
  });

  it("counts progress against the server's tile count", () => {
    expect(progress(createRun("1"))).toEqual({ placed: 0, total: STACK10_TILES });
    expect(progress(playLine("1", [0, 0, 0])).placed).toBe(3);
  });

  it("declares the rules version the verifier implements", () => {
    // A mismatch here is a rejected run rather than a wrong score, which is why the
    // string is asserted: it is part of the contract with the database.
    expect(STACK10_RULES_VERSION).toBe("stack-10@1");
    expect(createRun("1").rulesVersion).toBe(STACK10_RULES_VERSION);
  });
});
