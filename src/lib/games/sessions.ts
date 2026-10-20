/**
 * Play sessions, verified scores and the boards they produce.
 *
 * The API this talks to (`services/game-sessions`, mounted with the catalogue —
 * see `docs/deployment/vercel.md`):
 *
 *   - `POST /sessions` issues a run. The server picks the id and the seed, so the
 *     client cannot choose its own deck. Only a published, playable game can start
 *     one; anything else is a 404.
 *   - `POST /sessions/{id}/complete` submits a finished run. The score in the body
 *     is a *claim*: the server replays the action list from the session's seed,
 *     derives the score itself and compares. A disagreement is refused.
 *   - `GET /games/{slug}/leaderboard` reads the persisted ranking for one game.
 *
 * Three rules follow from that and are enforced here rather than in a screen:
 *
 *   - **Nothing declares a score saved until the server says so.** `useStack10Run`
 *     has no state in which a client-side number counts as recorded: it is
 *     `submitting` until the API answers, and the number it displays afterwards is
 *     the one the server returned.
 *   - **A retry is the same submission.** The body is derived from the run, and the
 *     server recognises a repeated submission as the run it already recorded, so a
 *     dropped connection costs nothing and can never score twice.
 *   - **The board is whatever the database ranked.** Entries, the caller's own
 *     standing and the empty case all come from one response; there is no local
 *     ranking and no fallback list.
 *
 * Storage rule: the run lives in memory. Nothing is written to `localStorage` or
 * `sessionStorage` — a token pair and a half-finished run are both things a page
 * should not leave behind on a shared machine.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, apiFetch } from "@/lib/api/client";
import { getAccessToken } from "@/lib/auth/session";
import {
  createRun as createChainRun,
  submission as chainSubmission,
  CHAIN_RULES_VERSION,
  tap as tapPad,
  type ChainRun,
} from "@/lib/games/chain";
import {
  createRun as createMemoryFlashRun,
  submission as memoryFlashSubmission,
  MEMORY_FLASH_RULES_VERSION,
  tap as tapCell,
  type MemoryFlashRun,
} from "@/lib/games/memory-flash";
import {
  createRun,
  place as placeTile,
  submission,
  STACK10_RULES_VERSION,
  type Stack10Run,
} from "@/lib/games/stack10";

/** Routes implemented by `services/game-sessions` and the catalogue's boards. */
const Routes = {
  sessions: "/sessions",
  complete: (sessionId: string) => `/sessions/${encodeURIComponent(sessionId)}/complete`,
  board: (slug: string) => `/games/${encodeURIComponent(slug)}/leaderboard`,
} as const;

/** Who is playing. Recorded with the session; never used to identify the caller. */
const CLIENT = "web/1.0";

/** The contract's board paging and windows. */
export const DEFAULT_BOARD_SIZE = 20;
export type BoardScope = "global" | "friends";
export type BoardPeriod = "all" | "day" | "week";

/** An issued run, as `POST /sessions` answers with it. */
export type PlaySession = {
  id: string;
  gameSlug: string;
  /** The rules the run is played and verified under. */
  rulesVersion: string;
  /** A decimal string: the seed is a `bigint` and may exceed a JS safe integer. */
  seed: string;
  tileCount: number;
  startedAt: string;
  expiresAt: string;
  /** False for a guest run: played and verified, and never eligible for a score. */
  ranked: boolean;
};

/** A verified run, as `POST /sessions/{id}/complete` answers with it. */
export type RunResult = {
  sessionId: string;
  gameSlug: string;
  /** The server's own arithmetic. Not the number the client sent. */
  score: number;
  clearedColumns: number;
  tilesPlaced: number;
  durationMs: number;
  ranked: boolean;
  recordedAt: string;
  /** The player's best score for the game, or null for an unranked run. */
  personalBest: number | null;
  /** Their rank on the all-time board, or null for an unranked run. */
  rank: number | null;
  /** True when this submission was a retry of the run already recorded. */
  duplicate: boolean;
};

/** One row of a board. The caller's own row is returned separately, as `me`. */
export type LeaderboardEntry = {
  rank: number;
  username: string;
  score: number;
  achievedAt: string | null;
  plays: number;
};

/** The caller's own place on the board they asked for. */
export type Standing = {
  rank: number;
  score: number;
  achievedAt: string | null;
  plays: number;
};

export type Leaderboard = {
  gameSlug: string;
  scope: BoardScope;
  period: BoardPeriod;
  entries: LeaderboardEntry[];
  hasMore: boolean;
  /** Null for an anonymous caller, and for one with no scored run in the window. */
  me: Standing | null;
};

/** The submitted run: what the server replays. */
export type RunSubmission = {
  rulesVersion: string;
  actions: readonly number[];
  score: number;
};

type RequestOptions = { signal?: AbortSignal; rulesVersion?: string };

// ── Requests ────────────────────────────────────────────────────────────────

/**
 * Starts a run of one game.
 *
 * The token is attached when the caller has a session, which is what makes the run
 * ranked; without one the run is still real, still verified, and simply not
 * eligible for a score. The request carries no user id — the token is the identity.
 * The rules default to Stack 10's; a Chain run passes its own version, which is
 * what the server's start gate matches against the game's runtime.
 */
export function startSession(gameSlug: string, options: RequestOptions = {}): Promise<PlaySession> {
  const token = getAccessToken();
  return apiFetch<PlaySession>(Routes.sessions, {
    method: "POST",
    body: {
      gameSlug,
      rulesVersion: options.rulesVersion ?? STACK10_RULES_VERSION,
      client: CLIENT,
    },
    token,
    signal: options.signal,
  });
}

/**
 * Submits a finished run for verification.
 *
 * `durationMs` is measured by the player's own clock between the session arriving
 * and the run ending — a client-side delta, so a wrong system clock cannot make the
 * server see an impossible duration. The server still checks it against the age of
 * the session.
 */
export function completeRun(
  sessionId: string,
  submissionBody: RunSubmission,
  durationMs: number,
  options: RequestOptions = {},
): Promise<RunResult> {
  const token = getAccessToken();
  return apiFetch<RunResult>(Routes.complete(sessionId), {
    method: "POST",
    body: {
      score: submissionBody.score,
      durationMs,
      progress: {
        rulesVersion: submissionBody.rulesVersion,
        actions: [...submissionBody.actions],
      },
    },
    token,
    signal: options.signal,
  });
}

/**
 * Reads one game's persisted ranking.
 *
 * The period is turned into the same window the server would compute; the board is
 * public, and a token only adds the caller's own standing to the same response.
 */
export function fetchLeaderboard(
  gameSlug: string,
  query: { scope?: BoardScope; period?: BoardPeriod; limit?: number; offset?: number } = {},
  options: RequestOptions = {},
): Promise<Leaderboard> {
  const token = getAccessToken();
  return apiFetch<Leaderboard>(Routes.board(gameSlug), {
    query: {
      scope: query.scope,
      period: query.period,
      limit: query.limit,
      offset: query.offset,
    },
    token,
    signal: options.signal,
  });
}

/**
 * The message to show a person when a session or board call fails.
 *
 * The API writes messages that are safe to display — "That run expired before it
 * was submitted. Start a new one." — so they are passed through. Anything else is a
 * transport failure or a bug and gets a generic sentence rather than a detail.
 */
export function playErrorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Something went wrong. Please try again.";
}

function asApiError(error: unknown): ApiError {
  return error instanceof ApiError
    ? error
    : new ApiError("Something went wrong. Please try again.");
}

// ── A run of Stack 10, from session to score ────────────────────────────────

export type Stack10RunState =
  | { status: "starting" }
  | { status: "playing"; session: PlaySession; run: Stack10Run }
  /** A finished run is being verified. No score is shown yet. */
  | { status: "submitting"; session: PlaySession; run: Stack10Run }
  | { status: "finished"; session: PlaySession; run: Stack10Run; result: RunResult }
  | {
      status: "error";
      /** Which half failed: the start of a run, or the submission of one. */
      stage: "start" | "submit";
      error: ApiError;
      session?: PlaySession;
      run?: Stack10Run;
    };

export type Stack10RunControls = Stack10RunState & {
  /** Places the run's next tile. Ignored unless the run is live. */
  place: (column: number) => void;
  /** Starts a fresh run, replacing whatever is on the board. */
  restart: () => void;
  /** Retries whichever step failed — a new session, or the same submission. */
  retry: () => void;
};

/**
 * Plays one run of Stack 10 against the session API.
 *
 * The lifecycle is a state machine with no shortcuts: a run exists only after the
 * server issued a session, a result exists only after the server verified the
 * submission, and an error is reported as an error rather than as a score of zero.
 * A submission is attempted exactly once per run — the effect that triggers it is
 * guarded — so a re-render cannot send it twice, and a player who retries a failed
 * submission sends the identical body, which the server recognises.
 */
export function useStack10Run(gameSlug: string): Stack10RunControls {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<Stack10RunState>({ status: "starting" });
  const startedAt = useRef(0);
  // When the run ended, captured once. A retry must send the duration the run
  // actually took, not the time the retry happened to be made: the submission is
  // meant to be the same submission, and a number that grows on every attempt
  // would describe a run that did not happen.
  const endedAt = useRef(0);
  const submitting = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    // A new run starts from nothing: keeping the previous board on screen while a
    // session is issued would show a playable board with no session behind it.
    startedAt.current = 0;
    endedAt.current = 0;
    submitting.current = false;
    setState({ status: "starting" });

    startSession(gameSlug, { signal: controller.signal })
      .then((session) => {
        if (controller.signal.aborted) return;
        startedAt.current = Date.now();
        setState({ status: "playing", session, run: createRun(session.seed) });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: "error", stage: "start", error: asApiError(error) });
      });

    return () => controller.abort();
  }, [gameSlug, attempt]);

  // Verification. It runs when a run has ended, once, and never for a run that is
  // still in progress.
  useEffect(() => {
    if (state.status !== "playing" || state.run.outcome === "playing") return;
    if (submitting.current) return;
    submitting.current = true;

    const { session, run } = state;
    if (endedAt.current === 0) endedAt.current = Date.now();
    const durationMs = Math.max(1, Math.round(endedAt.current - startedAt.current));
    setState({ status: "submitting", session, run });

    completeRun(session.id, { ...submission(run), rulesVersion: session.rulesVersion }, durationMs)
      .then((result) => {
        if (!mounted.current) return;
        setState({ status: "finished", session, run, result });
      })
      .catch((error: unknown) => {
        if (!mounted.current) return;
        setState({ status: "error", stage: "submit", error: asApiError(error), session, run });
      })
      .finally(() => {
        submitting.current = false;
      });
  }, [state]);

  const place = useCallback((column: number) => {
    setState((current) => {
      if (current.status !== "playing") return current;
      const next = placeTile(current.run, column);
      // An impossible move returns the same run, and the same reference means
      // there is nothing to re-render.
      return next === current.run ? current : { ...current, run: next };
    });
  }, []);

  const restart = useCallback(() => setAttempt((n) => n + 1), []);

  const retry = useCallback(() => {
    if (state.status !== "error") return;

    if (state.stage === "submit" && state.session && state.run) {
      // The identical submission, sent again. The server recognises a repeated
      // body as the run it already recorded, so this cannot score twice — and a
      // new session here would abandon a run that was only a retry away.
      submitting.current = false;
      setState({ status: "playing", session: state.session, run: state.run });
      return;
    }

    // The run never started: ask for a new session.
    setAttempt((n) => n + 1);
  }, [state]);

  return { ...state, place, restart, retry };
}

// ── A run of Chain, from session to score ─────────────────────────────────

export type ChainRunState =
  | { status: "starting" }
  | { status: "playing"; session: PlaySession; run: ChainRun }
  /** A finished run is being verified. No score is shown yet. */
  | { status: "submitting"; session: PlaySession; run: ChainRun }
  | { status: "finished"; session: PlaySession; run: ChainRun; result: RunResult }
  | {
      status: "error";
      /** Which half failed: the start of a run, or the submission of one. */
      stage: "start" | "submit";
      error: ApiError;
      session?: PlaySession;
      run?: ChainRun;
    };

export type ChainRunControls = ChainRunState & {
  /** Taps a pad. Ignored unless the run is live. */
  tap: (pad: number) => void;
  /** Starts a fresh run, replacing whatever is on the board. */
  restart: () => void;
  /** Retries whichever step failed — a new session, or the same submission. */
  retry: () => void;
};

/**
 * Plays one run of Chain against the session API.
 *
 * The same lifecycle as `useStack10Run`, because the server treats every game
 * the same way: a run exists only after the server issued a session under the
 * game's own rules version, a result exists only after the server verified the
 * submission, and an error is reported as an error rather than as a score of
 * zero. A submission is attempted exactly once per run — the effect that
 * triggers it is guarded — so a re-render cannot send it twice, and a player
 * who retries a failed submission sends the identical body, which the server
 * recognises.
 */
export function useChainRun(gameSlug: string): ChainRunControls {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ChainRunState>({ status: "starting" });
  const startedAt = useRef(0);
  // When the run ended, captured once. A retry must send the duration the run
  // actually took, not the time the retry happened to be made: the submission is
  // meant to be the same submission, and a number that grows on every attempt
  // would describe a run that did not happen.
  const endedAt = useRef(0);
  const submitting = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    // A new run starts from nothing: keeping the previous board on screen while a
    // session is issued would show playable pads with no session behind them.
    startedAt.current = 0;
    endedAt.current = 0;
    submitting.current = false;
    setState({ status: "starting" });

    startSession(gameSlug, { signal: controller.signal, rulesVersion: CHAIN_RULES_VERSION })
      .then((session) => {
        if (controller.signal.aborted) return;
        startedAt.current = Date.now();
        setState({ status: "playing", session, run: createChainRun(session.seed) });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: "error", stage: "start", error: asApiError(error) });
      });

    return () => controller.abort();
  }, [gameSlug, attempt]);

  // Verification. It runs when a run has ended, once, and never for a run that is
  // still in progress.
  useEffect(() => {
    if (state.status !== "playing" || state.run.outcome === "playing") return;
    if (submitting.current) return;
    submitting.current = true;

    const { session, run } = state;
    if (endedAt.current === 0) endedAt.current = Date.now();
    const durationMs = Math.max(1, Math.round(endedAt.current - startedAt.current));
    setState({ status: "submitting", session, run });

    completeRun(
      session.id,
      { ...chainSubmission(run), rulesVersion: session.rulesVersion },
      durationMs,
    )
      .then((result) => {
        if (!mounted.current) return;
        setState({ status: "finished", session, run, result });
      })
      .catch((error: unknown) => {
        if (!mounted.current) return;
        setState({ status: "error", stage: "submit", error: asApiError(error), session, run });
      })
      .finally(() => {
        submitting.current = false;
      });
  }, [state]);

  const tap = useCallback((pad: number) => {
    setState((current) => {
      if (current.status !== "playing") return current;
      const next = tapPad(current.run, pad);
      // An impossible tap returns the same run, and the same reference means
      // there is nothing to re-render.
      return next === current.run ? current : { ...current, run: next };
    });
  }, []);

  const restart = useCallback(() => setAttempt((n) => n + 1), []);

  const retry = useCallback(() => {
    if (state.status !== "error") return;

    if (state.stage === "submit" && state.session && state.run) {
      // The identical submission, sent again. The server recognises a repeated
      // body as the run it already recorded, so this cannot score twice — and a
      // new session here would abandon a run that was only a retry away.
      submitting.current = false;
      setState({ status: "playing", session: state.session, run: state.run });
      return;
    }

    // The run never started: ask for a new session.
    setAttempt((n) => n + 1);
  }, [state]);

  return { ...state, tap, restart, retry };
}

// ── A run of Memory Flash, from session to score ───────────────────────────

export type MemoryFlashRunState =
  | { status: "starting" }
  | { status: "playing"; session: PlaySession; run: MemoryFlashRun }
  /** A finished run is being verified. No score is shown yet. */
  | { status: "submitting"; session: PlaySession; run: MemoryFlashRun }
  | { status: "finished"; session: PlaySession; run: MemoryFlashRun; result: RunResult }
  | {
      status: "error";
      /** Which half failed: the start of a run, or the submission of one. */
      stage: "start" | "submit";
      error: ApiError;
      session?: PlaySession;
      run?: MemoryFlashRun;
    };

export type MemoryFlashRunControls = MemoryFlashRunState & {
  /** Taps a cell. Ignored unless the run is live. */
  tap: (cell: number) => void;
  /** Starts a fresh run, replacing whatever is on the board. */
  restart: () => void;
  /** Retries whichever step failed — a new session, or the same submission. */
  retry: () => void;
};

/**
 * Plays one run of Memory Flash against the session API.
 *
 * The same lifecycle as `useStack10Run` and `useChainRun`, because the server
 * treats every game the same way: a run exists only after the server issued a
 * session under the game's own rules version, a result exists only after the
 * server verified the submission, and an error is reported as an error rather
 * than as a score of zero. A submission is attempted exactly once per run — the
 * effect that triggers it is guarded — so a re-render cannot send it twice, and a
 * player who retries a failed submission sends the identical body, which the
 * server recognises.
 */
export function useMemoryFlashRun(gameSlug: string): MemoryFlashRunControls {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<MemoryFlashRunState>({ status: "starting" });
  const startedAt = useRef(0);
  // When the run ended, captured once. A retry must send the duration the run
  // actually took, not the time the retry happened to be made: the submission is
  // meant to be the same submission, and a number that grows on every attempt
  // would describe a run that did not happen.
  const endedAt = useRef(0);
  const submitting = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    // A new run starts from nothing: keeping the previous pattern on screen while
    // a session is issued would show a board with no session behind it.
    startedAt.current = 0;
    endedAt.current = 0;
    submitting.current = false;
    setState({ status: "starting" });

    startSession(gameSlug, { signal: controller.signal, rulesVersion: MEMORY_FLASH_RULES_VERSION })
      .then((session) => {
        if (controller.signal.aborted) return;
        startedAt.current = Date.now();
        setState({ status: "playing", session, run: createMemoryFlashRun(session.seed) });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: "error", stage: "start", error: asApiError(error) });
      });

    return () => controller.abort();
  }, [gameSlug, attempt]);

  // Verification. It runs when a run has ended, once, and never for a run that is
  // still in progress.
  useEffect(() => {
    if (state.status !== "playing" || state.run.outcome === "playing") return;
    if (submitting.current) return;
    submitting.current = true;

    const { session, run } = state;
    if (endedAt.current === 0) endedAt.current = Date.now();
    const durationMs = Math.max(1, Math.round(endedAt.current - startedAt.current));
    setState({ status: "submitting", session, run });

    completeRun(
      session.id,
      { ...memoryFlashSubmission(run), rulesVersion: session.rulesVersion },
      durationMs,
    )
      .then((result) => {
        if (!mounted.current) return;
        setState({ status: "finished", session, run, result });
      })
      .catch((error: unknown) => {
        if (!mounted.current) return;
        setState({ status: "error", stage: "submit", error: asApiError(error), session, run });
      })
      .finally(() => {
        submitting.current = false;
      });
  }, [state]);

  const tap = useCallback((cell: number) => {
    setState((current) => {
      if (current.status !== "playing") return current;
      const next = tapCell(current.run, cell);
      // An impossible tap returns the same run, and the same reference means
      // there is nothing to re-render.
      return next === current.run ? current : { ...current, run: next };
    });
  }, []);

  const restart = useCallback(() => setAttempt((n) => n + 1), []);

  const retry = useCallback(() => {
    if (state.status !== "error") return;

    if (state.stage === "submit" && state.session && state.run) {
      // The identical submission, sent again. The server recognises a repeated
      // body as the run it already recorded, so this cannot score twice — and a
      // new session here would abandon a run that was only a retry away.
      submitting.current = false;
      setState({ status: "playing", session: state.session, run: state.run });
      return;
    }

    // The run never started: ask for a new session.
    setAttempt((n) => n + 1);
  }, [state]);

  return { ...state, tap, restart, retry };
}

// ── Boards ──────────────────────────────────────────────────────────────────

export type LeaderboardState =
  | { status: "loading" }
  | { status: "ready"; board: Leaderboard }
  | { status: "error"; error: ApiError };

/**
 * Reads one game's board.
 *
 * A board with no scores is `ready` and empty — an answer, not an error — and the
 * screen renders its empty state from that. There is no cached board to fall back
 * to, so a failed read is reported as a failure.
 */
export function useLeaderboard(
  gameSlug: string,
  query: { scope?: BoardScope; period?: BoardPeriod; limit?: number } = {},
): LeaderboardState & { retry: () => void } {
  const scope = query.scope ?? "global";
  const period = query.period ?? "all";
  const limit = query.limit ?? DEFAULT_BOARD_SIZE;

  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<LeaderboardState>({ status: "loading" });

  useEffect(() => {
    if (!gameSlug) return;
    const controller = new AbortController();
    setState({ status: "loading" });

    fetchLeaderboard(gameSlug, { scope, period, limit }, { signal: controller.signal })
      .then((board) => {
        if (controller.signal.aborted) return;
        setState({ status: "ready", board });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: "error", error: asApiError(error) });
      });

    return () => controller.abort();
  }, [gameSlug, scope, period, limit, attempt]);

  return { ...state, retry: useCallback(() => setAttempt((n) => n + 1), []) };
}
