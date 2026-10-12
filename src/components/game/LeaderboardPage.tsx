import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { LeaderboardList } from "./Leaderboard";
import {
  ErrorState,
  Page,
  PageHeader,
  StateSwitcher,
  useMockLoad,
  EmptyState,
} from "@/components/common";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { games, type GameId } from "@/lib/mock";
import { cn } from "@/lib/utils";
import { Trophy } from "lucide-react";

export function LeaderboardPage({ gameId }: { gameId?: GameId }) {
  const loading = useMockLoad();
  const [scope, setScope] = useState("global");
  const [period, setPeriod] = useState("week");
  const [state, setState] = useState("ready");
  const game = games.find((g) => g.id === gameId);

  return (
    <Page>
      <PageHeader
        back={!!gameId}
        title={game ? `${game.title} leaderboard` : "Leaderboards"}
        subtitle="Updated every few minutes."
        actions={
          <div className="hidden md:block">
            <StateSwitcher value={state} onChange={setState} />
          </div>
        }
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
        {games.map((g) => (
          <Link
            key={g.id}
            to="/leaderboards/$id"
            params={{ id: g.id }}
            className={cn(
              "press shrink-0 rounded-full px-3.5 py-1.5 text-sm",
              gameId === g.id
                ? "bg-foreground font-medium text-background"
                : "bg-surface text-muted-foreground",
            )}
          >
            {g.title}
          </Link>
        ))}
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
      {state === "error" ? (
        <ErrorState onRetry={() => setState("ready")} />
      ) : state === "empty" ? (
        <EmptyState
          icon={Trophy}
          title="No scores yet"
          body="Be the first to set a score this week."
        />
      ) : (
        <LeaderboardList
          friends={scope === "friends"}
          loading={loading || state === "loading"}
          showMe
        />
      )}
    </Page>
  );
}
