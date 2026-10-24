import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { LeaderboardList } from "./Leaderboard";
import { EmptyState, ListSkeleton, Page, PageHeader } from "@/components/common";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDocumentTitle } from "@/lib/document-title";
import { DEFAULT_PAGE_SIZE, useGames } from "@/lib/games/catalog";
import type { BoardPeriod, BoardScope } from "@/lib/games/sessions";
import { cn } from "@/lib/utils";

/**
 * The leaderboard screen.
 *
 * Both halves are real. The game strip comes from the catalogue, so a game
 * published tomorrow appears without a code change; the board under it is the
 * persisted ranking from `GET /api/v1/games/{slug}/leaderboard`, which is derived
 * from verified scores only. A game nobody has finished shows an empty board that
 * says so — never a plausible-looking fixture list.
 *
 * The all-time window is the default because it is the one that can show every
 * recorded score; the shorter windows are real filters over the same data.
 *
 * `gameId` is a catalogue slug, matching the URL the game pages use. Scores belong
 * to a game, so `/leaderboards` on its own opens the first game's board rather
 * than an empty "pick a game" screen.
 */
export function LeaderboardPage({ gameId }: { gameId?: string }) {
  const [scope, setScope] = useState<BoardScope>("global");
  const [period, setPeriod] = useState<BoardPeriod>("all");
  const { status, items } = useGames({ limit: DEFAULT_PAGE_SIZE });
  const game = items.find((g) => g.slug === gameId);
  useDocumentTitle(game ? `${game.title} leaderboard` : undefined);

  const navigate = useNavigate();
  const first = items[0]?.slug;
  useEffect(() => {
    if (gameId || !first) return;
    void navigate({ to: "/leaderboards/$id", params: { id: first }, replace: true });
  }, [gameId, first, navigate]);

  return (
    <Page>
      <PageHeader
        // No back arrow: Leaderboards is a top-level tab, and its index already
        // redirects to a game's board, so there is no list page to go back to.
        back={false}
        title={game ? `${game.title} leaderboard` : "Leaderboards"}
        subtitle="Verified scores only."
      />
      <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 pb-3 md:px-0">
        {items.map((g) => (
          <Link
            key={g.slug}
            to="/leaderboards/$id"
            params={{ id: g.slug }}
            className={cn(
              "press shrink-0 rounded-full px-3.5 py-1.5 text-sm",
              gameId === g.slug
                ? "bg-foreground font-medium text-background"
                : "bg-surface text-muted-foreground",
            )}
          >
            {g.title}
          </Link>
        ))}
        {status === "error" && (
          <span className="self-center text-sm text-muted-foreground">
            The catalogue is unavailable, so the game list is empty.
          </span>
        )}
      </div>
      <div className="flex items-center justify-between gap-3 px-4 pb-2 md:px-0">
        <Tabs value={scope} onValueChange={(value) => setScope(value as BoardScope)}>
          <TabsList>
            <TabsTrigger value="global">Global</TabsTrigger>
            <TabsTrigger value="friends">Following</TabsTrigger>
          </TabsList>
        </Tabs>
        <select
          aria-label="Time period"
          value={period}
          onChange={(e) => setPeriod(e.target.value as BoardPeriod)}
          className="h-9 rounded-lg bg-surface px-3 text-sm"
        >
          <option value="day">Today</option>
          <option value="week">This week</option>
          <option value="all">All time</option>
        </select>
      </div>
      {gameId ? (
        <LeaderboardList gameSlug={gameId} scope={scope} period={period} showMe />
      ) : status === "error" ? null : status === "loading" || first ? (
        <ListSkeleton rows={7} />
      ) : (
        <EmptyState title="No games yet" body="Leaderboards appear once a game is published." />
      )}
    </Page>
  );
}
