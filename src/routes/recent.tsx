import { createFileRoute } from "@tanstack/react-router";
import { GameListPage } from "@/components/game/GameListPage";
import { games } from "@/lib/mock";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/recent")({
  head: () => seo("Recently played", "Pick up where you left off."),
  component: () => <GameListPage title="Recently played" subtitle="Pick up where you left off." items={games.slice(0, 6)} filters={["All", "Today", "This week"]} />,
});
