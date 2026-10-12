import { createFileRoute } from "@tanstack/react-router";
import { GameListPage } from "@/components/game/GameListPage";
import { EmptyState } from "@/components/common";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/likes")({
  head: () => seo("Liked games", "Games you liked."),
  component: Liked,
});

/**
 * Liked games.
 *
 * A like is a social interaction, and the social service that would store it is
 * not implemented. The prototype showed five catalog games as though the visitor
 * had liked them, which reports an action the person never took.
 */
function Liked() {
  return (
    <GameListPage title="Liked games" subtitle="Games you liked.">
      <EmptyState
        title="Nothing liked yet"
        body="Liking a game is not recorded yet, so there is nothing to list here."
      />
    </GameListPage>
  );
}
