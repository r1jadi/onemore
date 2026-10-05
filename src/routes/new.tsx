import { createFileRoute } from "@tanstack/react-router";
import { GameListPage } from "@/components/game/GameListPage";
import { games } from "@/lib/mock";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/new")({
  head: () => seo("New games", "Fresh releases from creators."),
  component: () => <GameListPage title="New games" subtitle="Fresh releases from creators." items={[...games].reverse()} filters={["All", "This week", "This month"]} />,
});
