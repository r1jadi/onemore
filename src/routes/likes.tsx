import { createFileRoute } from "@tanstack/react-router";
import { GameListPage } from "@/components/game/GameListPage";
import { games } from "@/lib/mock";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/likes")({
  head: () => seo("Liked games", "Games you liked."),
  component: () => (
    <GameListPage
      title="Liked games"
      subtitle="Games you liked."
      items={games.slice(2, 7)}
      filters={["All", "Puzzle", "Arcade"]}
    />
  ),
});
