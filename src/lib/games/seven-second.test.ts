import { describe, expect, it } from "vitest";

import {
  answer,
  canAnswer,
  challenge,
  createRun,
  currentChallenge,
  finish,
  progress,
  promptOf,
  submission,
  SEVEN_SECOND_BASE_MS,
  SEVEN_SECOND_BONUS_MS,
  SEVEN_SECOND_MAX_ANSWERS,
  SEVEN_SECOND_OPTIONS,
  SEVEN_SECOND_PENALTY_MS,
  SEVEN_SECOND_RULES_VERSION,
} from "@/lib/games/seven-second";

/**
 * 7 Second's rules, tested where they can be tested deterministically.
 *
 * The clock is not here: it is the screen's job, and the rules only own what an
 * answer is worth. What *is* here is the part that must agree with the database
 * digit for digit — the deck — and the score line the verify migration replays.
 * The vectors below are asserted against the SQL verifier in
 * `tests/security/rls_test.sql`; if this file changes them, that suite must change
 * with it, or the client and the server would disagree about the same run.
 */

describe("the deck", () => {
  it("is the same deck for the same seed and position", () => {
    expect(challenge("42", 3)).toEqual(challenge("42", 3));
    expect(challenge(42, 3)).toEqual(challenge("42", 3));
  });

  it("deals seed 1's opening challenges exactly as the verifier does", () => {
    // The first four of seed 1, mirrored by `seven_second_correct` in
    // 20261024120000_seven_second_sessions.sql.
    expect(promptOf(challenge("1", 0))).toBe("11 − 8");
    expect(challenge("1", 0).options).toEqual([3, 5, 7]);
    expect(challenge("1", 0).correct).toBe(0);

    expect(promptOf(challenge("1", 1))).toBe("9 − 5");
    expect(challenge("1", 1).options).toEqual([4, 6, 7]);
    expect(challenge("1", 1).correct).toBe(0);

    expect(promptOf(challenge("1", 2))).toBe("13 + 8");
    expect(challenge("1", 2).options).toEqual([26, 27, 21]);
    expect(challenge("1", 2).correct).toBe(2);

    expect(promptOf(challenge("1", 3))).toBe("16 − 8");
    expect(challenge("1", 3).options).toEqual([9, 8, 13]);
    expect(challenge("1", 3).correct).toBe(1);
  });

  it("mirrors the verifier's fallback for a zero seed", () => {
    // 0x9E3779B9 is substituted for a zero state on both sides, so the deck is
    // the same one seed 2654435769 draws. The six right buttons are the vector
    // tests/security/rls_test.sql asserts.
    expect(challenge("0", 0)).toEqual(challenge("2654435769", 0));
    expect(challenge("0", 7)).toEqual(challenge("2654435769", 7));
    expect(Array.from({ length: 6 }, (_, index) => challenge("2654435769", index).correct)).toEqual(
      [1, 0, 0, 2, 1, 2],
    );
  });

  it("keeps the same deck for a negative seed and its 32-bit residue", () => {
    expect(challenge("-1", 2)).toEqual(challenge("4294967295", 2));
  });

  it("offers three distinct answers, one of them right", () => {
    for (const seed of ["0", "1", "2", "42", "999999999999999999", "20261024"]) {
      for (let index = 0; index < 40; index += 1) {
        const dealt = challenge(seed, index);
        expect(dealt.options).toHaveLength(SEVEN_SECOND_OPTIONS);
        expect(new Set(dealt.options).size).toBe(SEVEN_SECOND_OPTIONS);
        expect(dealt.correct).toBeGreaterThanOrEqual(0);
        expect(dealt.correct).toBeLessThan(SEVEN_SECOND_OPTIONS);
        expect(Number.isInteger(dealt.options[dealt.correct])).toBe(true);
      }
    }
  });

  it("never poses a negative or fractional answer", () => {
    for (const seed of ["3", "17", "2718281828", "9007199254740991"]) {
      for (let index = 0; index < 60; index += 1) {
        for (const option of challenge(seed, index).options) {
          expect(option).toBeGreaterThanOrEqual(0);
          expect(Number.isInteger(option)).toBe(true);
        }
      }
    }
  });

  it("writes the prompt the game shows", () => {
    expect(promptOf(challenge("1", 0))).toBe("11 − 8");
    expect(promptOf(challenge("1", 2))).toBe("13 + 8");
  });

  it("moves the right answer around", () => {
    const positions = new Set<number>();
    for (let index = 0; index < 12; index += 1) positions.add(challenge("7", index).correct);
    expect(positions.size).toBeGreaterThan(1);
  });

  it("refuses a position off the deck", () => {
    expect(() => challenge("1", -1)).toThrow(RangeError);
    expect(() => challenge("1", SEVEN_SECOND_MAX_ANSWERS)).toThrow(RangeError);
    expect(() => challenge("1", 1.5)).toThrow(RangeError);
  });

  it("refuses a seed that is not a whole number", () => {
    expect(() => challenge("not-a-seed", 0)).toThrow(TypeError);
    expect(() => challenge(1.5, 0)).toThrow(TypeError);
  });
});

describe("a run", () => {
  it("starts at zero, live, with the first challenge on screen", () => {
    const run = createRun("1");
    expect(run).toMatchObject({
      seed: "1",
      rulesVersion: SEVEN_SECOND_RULES_VERSION,
      answers: [],
      correct: 0,
      score: 0,
      outcome: "playing",
      endReason: null,
    });
    expect(currentChallenge(run)).toEqual(challenge("1", 0));
    expect(progress(run)).toEqual({ answered: 0, correct: 0, max: 60 });
  });

  it("scores ten for a right answer and nothing for a wrong one", () => {
    let run = createRun("1");
    run = answer(run, challenge("1", 0).correct);
    expect(run.correct).toBe(1);
    expect(run.score).toBe(10);

    run = answer(run, (challenge("1", 1).correct + 1) % 3);
    expect(run.correct).toBe(1);
    expect(run.score).toBe(10);
    expect(run.answers).toEqual([0, 1]);
  });

  it("replays the score line the database asserts", () => {
    // Right, wrong, right, right on seed 1: three cleared, thirty points. The
    // same line is submitted in tests/security/rls_test.sql and must record 30.
    let run = createRun("1");
    for (const option of [0, 1, 2, 1]) run = answer(run, option);
    expect(run.correct).toBe(3);
    expect(run.score).toBe(30);
    expect(submission(run)).toEqual({
      rulesVersion: "seven-second@1",
      actions: [0, 1, 2, 1],
      score: 30,
    });
  });

  it("scores a perfect sixty-answer run at six hundred", () => {
    let run = createRun("42");
    for (let index = 0; index < SEVEN_SECOND_MAX_ANSWERS; index += 1) {
      run = answer(run, challenge("42", index).correct);
    }
    expect(run.correct).toBe(60);
    expect(run.score).toBe(600);
    expect(run.outcome).toBe("over");
    expect(run.endReason).toBe("answers");
  });

  it("ends itself at the submission cap, because a deck has to end", () => {
    let run = createRun("1");
    for (let index = 0; index < SEVEN_SECOND_MAX_ANSWERS; index += 1) {
      run = answer(run, 0);
    }
    expect(run.outcome).toBe("over");
    expect(run.endReason).toBe("answers");
    expect(currentChallenge(run)).toBeNull();
    expect(answer(run, 0)).toBe(run);
  });

  it("ignores an impossible answer instead of recording it", () => {
    const run = createRun("1");
    expect(answer(run, 3)).toBe(run);
    expect(answer(run, -1)).toBe(run);
    expect(answer(run, 1.5)).toBe(run);

    const over = finish(run);
    expect(canAnswer(over, 0)).toBe(false);
    expect(answer(over, 0)).toBe(over);
  });

  it("ends when the clock does, keeping the answers already given", () => {
    let run = createRun("1");
    run = answer(run, challenge("1", 0).correct);
    const ended = finish(run);
    expect(ended.outcome).toBe("over");
    expect(ended.endReason).toBe("clock");
    expect(ended.score).toBe(10);
    expect(submission(ended).actions).toEqual([0]);
    // Finishing twice is not a second ending.
    expect(finish(ended)).toBe(ended);
  });

  it("allows an empty submission: a clock can run out before a first answer", () => {
    const ended = finish(createRun("9"));
    expect(submission(ended)).toEqual({ rulesVersion: "seven-second@1", actions: [], score: 0 });
  });

  it("takes its rules constants with it", () => {
    // The screen's timer reads these; a change to them is a change to the rules.
    expect(SEVEN_SECOND_BASE_MS).toBe(7000);
    expect(SEVEN_SECOND_BONUS_MS).toBe(1500);
    expect(SEVEN_SECOND_PENALTY_MS).toBe(2000);
    expect(SEVEN_SECOND_MAX_ANSWERS).toBe(60);
    expect(SEVEN_SECOND_RULES_VERSION).toBe("seven-second@1");
  });
});
