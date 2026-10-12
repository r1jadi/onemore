import { createFileRoute } from "@tanstack/react-router";
import { GameListPage } from "@/components/game/GameListPage";
import { EmptyState } from "@/components/common";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/saved")({
  head: () => seo("Saved games", "Games you saved to play later."),
  component: Saved,
});

/**
 * Saved games.
 *
 * Saving is stored by no service yet. The prototype listed four catalog games as
 * though the visitor had saved them, which reports an action the person never
 * took — the same problem as the liked list.
 */
function Saved() {
  return (
    <GameListPage title="Saved games" subtitle="Games you saved to play later.">
      <EmptyState
        title="Nothing saved yet"
        body="Saving a game is not recorded yet, so there is nothing to list here."
      />
    </GameListPage>
  );
}
