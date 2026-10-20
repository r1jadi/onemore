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
 * A trend is a change in play activity over a window. Plays are recorded — every
 * finished run adds one — but nothing ranks them, and there is no windowed trend
 * query behind this page. The prototype listed its fixture games in insertion
 * order and called them trending. There is no honest way to show that yet, so the
 * page says what is missing: the ranking, not the plays.
 */
function Trending() {
  return (
    <GameListPage title="Trending games" subtitle="What everyone is playing right now.">
      <EmptyState
        title="Trending is not available yet"
        body="A trend ranks plays over a window of time. Plays are recorded, but no game is ranked from them yet. Browse the newest games instead."
      />
    </GameListPage>
  );
}
