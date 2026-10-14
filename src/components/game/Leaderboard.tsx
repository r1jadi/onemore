import { CircleSlash } from "lucide-react";
import { Avatar, EmptyState, ErrorState, ListSkeleton } from "@/components/common";
import {
  playErrorMessage,
  useLeaderboard,
  type BoardPeriod,
  type BoardScope,
} from "@/lib/games/sessions";

/**
 * A game's leaderboard.
 *
 * The board is the database's: `/api/v1/games/{slug}/leaderboard` derives it from
 * recorded scores, one row per player at their best, with ties sharing a rank. This
 * component renders that response and nothing else — there is no local ranking, no
 * fixture list and no fallback. The prototype filled this list with seven invented
 * players, which is the most misleading thing the app could show, because a rank
 * looks like a measurement.
 *
 * What each state means, and why they are different screens:
 *
 *   - **empty** — nobody has finished a scored run of this game yet. That is an
 *     answer, so it gets the empty state rather than an error or a zero.
 *   - **error** — the read failed. Retryable, and never silently replaced with a
 *     blank board.
 *   - **following** — no friends board exists, because there is no following graph
 *     to compute one from. The tab stays so the feature is visible, and says so.
 */
export function LeaderboardList({
  gameSlug,
  limit,
  period = "all",
  scope = "global",
  showMe = false,
}: {
  /** The game's slug. A board only exists for a game. */
  gameSlug?: string;
  limit?: number;
  period?: BoardPeriod;
  scope?: BoardScope;
  showMe?: boolean;
}) {
  // A following board cannot be computed, so no request is made for one rather
  // than a request that is refused.
  const state = useLeaderboard(scope === "friends" ? "" : (gameSlug ?? ""), {
    scope,
    period,
    limit,
  });

  if (!gameSlug) {
    return (
      <EmptyState
        icon={CircleSlash}
        title="No game selected"
        body="Scores belong to a game, so pick one to see its board."
      />
    );
  }

  if (scope === "friends") {
    return (
      <EmptyState
        icon={CircleSlash}
        title="No following board yet"
        body="A friends board needs a following graph, which does not exist yet. Switch to Global for the real ranking."
      />
    );
  }

  if (state.status === "loading") return <ListSkeleton rows={limit ?? 7} />;

  if (state.status === "error") {
    return (
      <ErrorState
        title="Couldn't load the leaderboard"
        body={playErrorMessage(state.error)}
        onRetry={state.retry}
      />
    );
  }

  const { entries, me } = state.board;

  if (entries.length === 0) {
    return (
      <EmptyState
        icon={CircleSlash}
        title={period === "all" ? "No scores yet" : "No scores in this window"}
        body="A score appears here once a run has been verified and saved. Nothing is ranked until then."
      />
    );
  }

  // The caller's own row is pinned only when it is below the visible page: showing
  // it twice, or under a rank they do not hold, would be a different claim.
  const lastVisibleRank = entries[entries.length - 1].rank;
  const pinMe = showMe && me !== null && me.rank > lastVisibleRank;

  return (
    <div>
      <ol className="divide-y divide-border">
        {entries.map((row) => (
          <li
            key={`${row.rank}-${row.username}`}
            className="enter flex items-center gap-3 px-4 py-2.5 md:rounded-lg md:px-2"
          >
            <span className="w-6 text-center font-mono text-sm tabular text-muted-foreground">
              {row.rank}
            </span>
            <Avatar name={row.username || "player"} size="sm" />
            <span className="flex-1 truncate text-sm">
              {row.username ? `@${row.username}` : "A former player"}
            </span>
            <span className="font-semibold tabular">{row.score}</span>
          </li>
        ))}
      </ol>
      {pinMe && me && (
        <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] mt-2 flex items-center gap-3 border-y border-primary/30 bg-surface px-4 py-3 md:bottom-0 md:rounded-lg md:border md:px-2">
          <span className="w-6 text-center font-mono text-sm tabular text-muted-foreground">
            {me.rank}
          </span>
          <span className="flex-1 text-sm font-medium">You</span>
          <span className="font-semibold tabular">{me.score}</span>
        </div>
      )}
    </div>
  );
}
