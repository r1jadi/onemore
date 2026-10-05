import { createFileRoute } from "@tanstack/react-router";
import { GameListPage } from "@/components/game/GameListPage";
import { games } from "@/lib/mock";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/saved")({
  head: () => seo("Saved games", "Games you saved to play later."),
  component: () => <GameListPage title="Saved games" subtitle="Games you saved to play later." items={games.slice(1, 5)} filters={["All", "Puzzle", "Arcade", "Memory"]} />,
});
