import { createFileRoute } from "@tanstack/react-router";
import { GameListPage } from "@/components/game/GameListPage";
import { games } from "@/lib/mock";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/trending")({
  head: () => seo("Trending games", "What everyone is playing right now."),
  component: () => <GameListPage title="Trending games" subtitle="What everyone is playing right now." items={games} ranked />,
});
