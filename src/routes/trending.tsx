import { createFileRoute } from "@tanstack/react-router";
import { GameListPage } from "@/components/game/GameListPage";
import { EmptyState } from "@/components/common";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/trending")({
  head: () => seo("Trending games", "What everyone is playing right now."),
  component: Trending,
});

/**
 * Trending, honestly reported as unavailable.
 *
 * A trend is a change in play activity over a window. That needs recorded plays
 * and a ranking algorithm, and neither exists — the prototype listed its fixture
 * games in insertion order and called them trending. There is no honest way to
 * show this page yet, so it says so.
 */
function Trending() {
  return (
    <GameListPage title="Trending games" subtitle="What everyone is playing right now.">
      <EmptyState
        title="Trending is not available yet"
        body="A trend needs recorded plays over time, and nothing records plays yet. Browse the newest games instead."
      />
    </GameListPage>
  );
}
