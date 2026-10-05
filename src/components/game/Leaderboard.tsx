import { Link } from "@tanstack/react-router";
import { Avatar, ListSkeleton } from "@/components/common";
import { fmt, leaderboard, me } from "@/lib/mock";
import { cn } from "@/lib/utils";

export function LeaderboardList({ limit, friends, loading, showMe = false }: { limit?: number; friends?: boolean; loading?: boolean; showMe?: boolean }) {
  if (loading) return <ListSkeleton rows={limit ?? 7} />;
  const rows = (friends ? leaderboard.filter((_, i) => i % 2 === 0).map((r, i) => ({ ...r, rank: i + 1 })) : leaderboard).slice(0, limit);
  return (
    <div>
      <ol className="divide-y divide-border">
        {rows.map((r) => (
          <li key={r.user} className="enter">
            <Link to="/u/$username" params={{ username: r.user }} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface md:rounded-lg md:px-2">
              <span className={cn("w-6 text-center font-mono text-sm tabular", r.rank <= 3 ? "font-semibold text-foreground" : "text-muted-foreground")}>{r.rank}</span>
              <Avatar name={r.user} size="sm" />
              <span className="flex-1 truncate text-sm">@{r.user}</span>
              <span className="font-mono text-sm font-semibold tabular">{fmt(r.score)}</span>
            </Link>
          </li>
        ))}
      </ol>
      {showMe && (
        <div className="sticky bottom-16 mt-2 flex items-center gap-3 border-y border-primary/30 bg-surface px-4 py-3 md:bottom-0 md:rounded-lg md:border md:px-2">
          <span className="w-6 text-center font-mono text-sm text-primary tabular">212</span>
          <Avatar name={me.username} size="sm" />
          <span className="flex-1 text-sm font-medium">You</span>
          <span className="font-mono text-sm font-semibold tabular">2,140</span>
        </div>
      )}
    </div>
  );
}
