import { createFileRoute } from "@tanstack/react-router";
import { GameListPage } from "@/components/game/GameListPage";
import { games } from "@/lib/mock";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/popular")({
  head: () => seo("Popular games", "The most played games on onemore."),
  component: () => (
    <GameListPage
      title="Popular games"
      subtitle="The most played games on onemore."
      items={[...games].sort((a, b) => b.plays - a.plays)}
      ranked
    />
  ),
});
