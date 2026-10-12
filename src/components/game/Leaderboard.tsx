import { CircleSlash } from "lucide-react";
import { Avatar, EmptyState, ListSkeleton } from "@/components/common";
import { avatarUrl, useProfile } from "@/lib/users/profile";

/**
 * A leaderboard.
 *
 * There is no board to draw. A ranking needs recorded scores, and nothing in the
 * product stores one yet — the sessions and scores services are not implemented,
 * so `public.scores` is empty. The prototype filled this list with seven invented
 * players and scores; showing a fabricated ranking is the single most misleading
 * thing this app could do, because a rank looks like a measurement.
 *
 * The row shape is kept so the real board can slot in, and the signed-in row stays
 * available for it — but it is only drawn when the caller has something real to be
 * ranked against.
 */
export function LeaderboardList({
  limit,
  friends,
  loading,
  showMe = false,
}: {
  limit?: number;
  friends?: boolean;
  loading?: boolean;
  showMe?: boolean;
}) {
  const state = useProfile();
  const profile = state.status === "ready" ? state.profile : undefined;

  if (loading) return <ListSkeleton rows={limit ?? 7} />;

  // No rows exist yet, so the signed-in row is never drawn: a "You" pinned under
  // an empty board implies a position that was not computed.
  const ranks: Array<{ rank: number; username: string }> = [];

  if (ranks.length === 0) {
    return (
      <EmptyState
        icon={CircleSlash}
        title={friends ? "No scores from people you follow" : "No scores yet"}
        body="Scores are not recorded yet, so there is no board to rank. This is an empty board, not an empty week."
      />
    );
  }

  return (
    <div>
      <ol className="divide-y divide-border">
        {ranks.slice(0, limit).map((row) => (
          <li
            key={row.username}
            className="enter flex items-center gap-3 px-4 py-2.5 md:rounded-lg md:px-2"
          >
            <span className="w-6 text-center font-mono text-sm tabular text-muted-foreground">
              {row.rank}
            </span>
            <Avatar name={row.username} size="sm" />
            <span className="flex-1 truncate text-sm">@{row.username}</span>
          </li>
        ))}
      </ol>
      {showMe && profile && (
        <div className="sticky bottom-16 mt-2 flex items-center gap-3 border-y border-primary/30 bg-surface px-4 py-3 md:bottom-0 md:rounded-lg md:border md:px-2">
          <Avatar name={profile.username} src={avatarUrl(profile)} size="sm" />
          <span className="flex-1 text-sm font-medium">You</span>
        </div>
      )}
    </div>
  );
}
