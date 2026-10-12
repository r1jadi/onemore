import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { LeaderboardList } from "./Leaderboard";
import { Page, PageHeader } from "@/components/common";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DEFAULT_PAGE_SIZE, useGames } from "@/lib/games/catalog";
import { cn } from "@/lib/utils";

/**
 * The leaderboard screen.
 *
 * The game strip is real: it lists published games from the catalogue, so a game
 * published tomorrow appears here without a code change. The board under it is
 * empty and says so — nothing records scores yet, and a ranking is the last place
 * a plausible number should appear.
 *
 * `gameId` is a catalogue slug, matching the URL the game pages use.
 */
export function LeaderboardPage({ gameId }: { gameId?: string }) {
  const [scope, setScope] = useState("global");
  const [period, setPeriod] = useState("week");
  const { status, items } = useGames({ limit: DEFAULT_PAGE_SIZE });
  const game = items.find((g) => g.slug === gameId);

  return (
    <Page>
      <PageHeader
        back={!!gameId}
        title={game ? `${game.title} leaderboard` : "Leaderboards"}
        subtitle="Updated every few minutes."
      />
      <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 pb-3 md:px-0">
        <Link
          to="/leaderboards"
          className={cn(
            "press shrink-0 rounded-full px-3.5 py-1.5 text-sm",
            !gameId
              ? "bg-foreground font-medium text-background"
              : "bg-surface text-muted-foreground",
          )}
        >
          All games
        </Link>
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
        <Tabs value={scope} onValueChange={setScope}>
          <TabsList>
            <TabsTrigger value="global">Global</TabsTrigger>
            <TabsTrigger value="friends">Following</TabsTrigger>
          </TabsList>
        </Tabs>
        <select
          aria-label="Time period"
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          className="h-9 rounded-lg bg-surface px-3 text-sm"
        >
          <option value="day">Today</option>
          <option value="week">This week</option>
          <option value="all">All time</option>
        </select>
      </div>
      <LeaderboardList friends={scope === "friends"} showMe />
    </Page>
  );
}
