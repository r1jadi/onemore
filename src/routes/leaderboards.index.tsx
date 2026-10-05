import { createFileRoute } from "@tanstack/react-router";
import { LeaderboardPage } from "@/components/game/LeaderboardPage";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/leaderboards/")({
  head: () => seo("Leaderboards", "Global and friends leaderboards across every game."),
  component: () => <LeaderboardPage />,
});
