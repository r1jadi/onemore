import { Link } from "@tanstack/react-router";
import { Loader2, RotateCcw, ShieldCheck, Trophy, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";

import { ErrorState } from "@/components/common";
import { ExitGameLink } from "@/components/game/ExitGameLink";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useReportRunProgress } from "@/lib/games/run-progress";
import {
  playErrorMessage,
  useMemoryFlashRun,
  type PlaySession,
  type RunResult,
} from "@/lib/games/sessions";
import {
  MEMORY_FLASH_CELLS,
  MEMORY_FLASH_COLUMNS,
  MEMORY_FLASH_ROUNDS,
  patternAt,
  type MemoryFlashRun,
} from "@/lib/games/memory-flash";

/**
 * Memory Flash, playing for real.
 *
 * The board is a view onto `useMemoryFlashRun`, which owns the whole lifecycle: a
 * session issued by the server, the run played against its seed's patterns, and
 * the score the server derived from the submitted tap list. Nothing on this screen
 * decides a number — the score shown at the end is the one that came back from
 * verification, and until it does the screen says the run is being verified rather
 * than showing a provisional total.
 *
 * Three things the component refuses to do, because each would be a lie:
 *
 *   - **it never offers a tap while the pattern is showing.** The cells are
 *     disabled and say why; a tap that arrives one frame after the run ended lands
 *     on a disabled board rather than throwing inside a render.
 *   - **it never keeps the pattern lit during input.** The cells light only while
 *     showing; rebuilding the pattern is the player's memory, not the board's.
 *   - **it never claims a score was saved.** A failed submission is an error with
 *     the server's own message and a retry that re-sends the identical run, not a
 *     local "saved" that a reload would disprove.
 */
export function MemoryFlashRuntime({ slug, title }: { slug: string; title: string }) {
  const state = useMemoryFlashRun(slug);

  if (state.status === "starting") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Starting a run…</p>
      </div>
    );
  }

  if (state.status === "error" && state.stage === "start") {
    return (
      <div className="flex flex-1 flex-col justify-center px-6">
        <ErrorState
          title="Couldn't start a run"
          body={playErrorMessage(state.error)}
          onRetry={state.retry}
        />
      </div>
    );
  }

  // A submission failure keeps the board: the run exists, it is just not verified,
  // and offering to throw it away would be the one thing the player cannot undo.
  if (state.status === "error" && state.stage === "submit" && state.run && state.session) {
    return (
      <div className="flex flex-1 flex-col justify-center gap-4 px-6 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-surface-2">
          <TriangleAlert className="size-5 text-muted-foreground" />
        </div>
        <h2 className="text-xl font-semibold">Your run was not verified</h2>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">
          {playErrorMessage(state.error)} Nothing was saved, and nothing needs to be — sending the
          same run again is safe.
        </p>
        <div className="mx-auto flex w-full max-w-xs flex-col gap-2">
          <Button variant="play" size="lg" onClick={state.retry}>
            Try submitting again
          </Button>
          <Button variant="secondary" size="lg" onClick={state.restart}>
            <RotateCcw />
            Start a new run
          </Button>
          <Button asChild variant="ghost" size="lg">
            <ExitGameLink slug={slug}>
              {title}
            </ExitGameLink>
          </Button>
        </div>
      </div>
    );
  }

  if (state.status === "playing" || state.status === "submitting") {
    return (
      <Board
        // A fresh board per run: the showing always starts at round one, even
        // when the next session deals the same seed.
        key={state.session.id}
        run={state.run}
        session={state.session}
        verifying={state.status === "submitting"}
        onTap={state.tap}
      />
    );
  }

  if (state.status === "finished") {
    return (
      <Finished
        slug={slug}
        title={title}
        run={state.run}
        result={state.result}
        onRestart={state.restart}
      />
    );
  }

  // The only remaining shape is an error with no run to show, which the branches
  // above have already handled; a spinner is a truthful fallback rather than a
  // screen that invents a state.
  return (
    <div className="flex flex-1 items-center justify-center">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}

/** The beat before the pattern lights, so the board settles first. */
const LEAD_IN_MS = 250;
/** How long the pattern stays lit. Long enough to read, short enough to be memory. */
const SHOW_MS = 700;

/** The live board: a showing phase, then an input phase, per round. */
function Board({
  run,
  session,
  verifying,
  onTap,
}: {
  run: MemoryFlashRun;
  session: PlaySession;
  verifying: boolean;
  onTap: (cell: number) => void;
}) {
  const round = run.round;
  const seed = run.seed;
  const [showing, setShowing] = useState(true);

  // Each round starts by lighting its pattern, then hands over to the player.
  // The effect re-runs only when the round (or run) changes: entering a cell
  // within a round must not restart the showing.
  useEffect(() => {
    setShowing(true);
    const hide = setTimeout(() => setShowing(false), LEAD_IN_MS + SHOW_MS);
    return () => {
      clearTimeout(hide);
      setShowing(false);
    };
  }, [round, seed]);

  const accepting = !showing && !verifying && run.outcome === "playing";

  // From the first showing beat the run is live: leaving loses it.
  useReportRunProgress(!verifying && run.outcome === "playing");

  const pattern = patternAt(seed, round);
  const remaining = Math.max(0, round - run.entered.length);

  return (
    <div className="flex flex-1 flex-col px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="flex items-center justify-between gap-3 py-2">
        <dl className="flex items-baseline gap-1">
          <dt className="text-xs text-muted-foreground">Score</dt>
          <dd className="text-2xl font-semibold tabular">{run.score}</dd>
        </dl>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="tabular">
            Round {Math.min(round, MEMORY_FLASH_ROUNDS)}/{MEMORY_FLASH_ROUNDS}
          </span>
          {session.ranked ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-1">
              <ShieldCheck className="size-3.5" />
              Ranked
            </span>
          ) : (
            <span className="rounded-full bg-surface-2 px-2 py-1">Guest run</span>
          )}
        </div>
      </div>

      <p className="py-1 text-center text-sm text-muted-foreground" aria-live="polite">
        {verifying
          ? "Verifying your run with the server…"
          : showing
            ? `Watch the pattern — ${round} ${round === 1 ? "cell" : "cells"} lit.`
            : run.outcome === "over"
              ? "Pattern broken."
              : `Your turn — ${remaining} more ${remaining === 1 ? "cell" : "cells"} in this pattern.`}
      </p>

      {/* A square board, centred in whatever height is left: the grid's own
          aspect ratio sizes the cells, so they stay square at every viewport
          instead of stretching to fill a tall column. */}
      <div className="flex flex-1 items-center justify-center py-3">
        <div
          className="grid aspect-square w-full max-w-md grid-cols-4 grid-rows-4 gap-2"
          role="group"
          aria-label="Pattern grid"
        >
          {Array.from({ length: MEMORY_FLASH_CELLS }, (_, index) => {
            const lit = showing ? pattern.includes(index) : run.entered.includes(index);
            const entered = !showing && run.entered.includes(index);
            return (
              <button
                key={index}
                type="button"
                disabled={!accepting}
                onClick={() => onTap(index)}
                aria-label={cellLabel(index, run, showing, verifying, entered)}
                className={cn(
                  "press flex items-center justify-center rounded-xl border transition-colors",
                  "motion-reduce:transition-none",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  "active:scale-[0.97]",
                  lit
                    ? entered
                      ? "border-primary/60 bg-primary/70"
                      : "border-transparent bg-foreground"
                    : accepting
                      ? "border-border bg-surface hover:bg-surface-2"
                      : "border-transparent bg-surface/40 opacity-60",
                )}
              >
                <span className="sr-only">{`Cell ${index + 1}`}</span>
              </button>
            );
          })}
        </div>
      </div>

      <p className="pt-1 text-center text-xs text-muted-foreground" aria-live="polite">
        {verifying
          ? "The cells entered so far are your score if the server agrees."
          : "Rebuild each pattern in any order. A wrong cell ends the run. Ten points a round."}
      </p>
    </div>
  );
}

/** The accessible name of a cell, which states why a tap is or is not playable. */
function cellLabel(
  index: number,
  run: MemoryFlashRun,
  showing: boolean,
  verifying: boolean,
  entered: boolean,
): string {
  const row = Math.floor(index / MEMORY_FLASH_COLUMNS) + 1;
  const column = (index % MEMORY_FLASH_COLUMNS) + 1;
  const position = `Cell ${index + 1}, row ${row} column ${column}`;
  if (verifying) return `${position}. The run is being verified.`;
  if (run.outcome !== "playing") return `${position}. The run has ended.`;
  if (showing) return `${position}. Watch the pattern.`;
  if (entered) return `${position}. Already lit in this round.`;
  return `${position}. Tap to rebuild the pattern.`;
}

/** The end of a run: the score the server verified, or a guest's unranked result. */
function Finished({
  slug,
  title,
  run,
  result,
  onRestart,
}: {
  slug: string;
  title: string;
  run: MemoryFlashRun;
  result: RunResult;
  onRestart: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col justify-center gap-4 px-6 pb-[max(1rem,env(safe-area-inset-bottom))] text-center">
      <div className="enter flex flex-col items-center gap-2">
        <div className="flex size-12 items-center justify-center rounded-full bg-surface-2">
          {result.ranked ? (
            <Trophy className="size-5 text-muted-foreground" />
          ) : (
            <ShieldCheck className="size-5 text-muted-foreground" />
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {run.outcome === "cleared" ? "Pattern complete" : "Pattern broken"}
        </p>
        <p className="text-5xl font-semibold tabular">{result.score}</p>
        <p className="text-sm text-muted-foreground">
          {run.outcome === "cleared"
            ? `All ten patterns rebuilt — ${result.tilesPlaced} cells.`
            : `${result.tilesPlaced} cells tapped, ${result.clearedColumns} rounds cleared.`}
        </p>
      </div>

      <dl className="mx-auto grid w-full max-w-xs grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl bg-surface p-3">
          <dt className="text-xs text-muted-foreground">Duration</dt>
          <dd className="font-semibold tabular">{formatDuration(result.durationMs)}</dd>
        </div>
        <div className="rounded-xl bg-surface p-3">
          <dt className="text-xs text-muted-foreground">Rounds cleared</dt>
          <dd className="font-semibold tabular">{result.clearedColumns}</dd>
        </div>
        {result.personalBest !== null && (
          <div className="rounded-xl bg-surface p-3">
            <dt className="text-xs text-muted-foreground">Your best</dt>
            <dd className="font-semibold tabular">{result.personalBest}</dd>
          </div>
        )}
        {result.rank !== null && (
          <div className="rounded-xl bg-surface p-3">
            <dt className="text-xs text-muted-foreground">Rank</dt>
            <dd className="font-semibold tabular">#{result.rank}</dd>
          </div>
        )}
      </dl>

      <p className="mx-auto max-w-sm text-xs text-muted-foreground">
        {result.ranked
          ? "Verified by replaying your taps on the server, then saved to the leaderboard."
          : "Verified by replaying your taps on the server. This was a guest run, so it is not on the leaderboard."}
        {result.duplicate && " This run was already recorded, so nothing was counted twice."}
      </p>

      <div className="mx-auto flex w-full max-w-xs flex-col gap-2">
        <Button variant="play" size="lg" onClick={onRestart}>
          <RotateCcw />
          Play again
        </Button>
        <Button asChild variant="secondary" size="lg">
          <Link to="/leaderboards/$id" params={{ id: slug }}>
            See the leaderboard
          </Link>
        </Button>
        {!result.ranked && (
          <Button asChild variant="ghost" size="lg">
            <Link to="/login" search={{ redirect: `/games/${slug}` }}>
              Sign in to rank your scores
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}

/** Milliseconds as `m:ss`. */
function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
