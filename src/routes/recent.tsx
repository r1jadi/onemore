import { createFileRoute } from "@tanstack/react-router";
import { GameListPage } from "@/components/game/GameListPage";
import { EmptyState } from "@/components/common";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/recent")({
  head: () => seo("Recently played", "Pick up where you left off."),
  component: Recent,
});

/**
 * Recently played.
 *
 * The list would come from the caller's own play sessions. No session is recorded
 * yet, and there is no per-user play history endpoint, so the prototype's six
 * hard-coded games were a fabrication of the caller's own behaviour — the least
 * defensible kind, because it looks like a memory of something they did.
 */
function Recent() {
  return (
    <GameListPage title="Recently played" subtitle="Pick up where you left off.">
      <EmptyState
        title="No play history yet"
        body="Games you play will appear here once plays are recorded. Playing is not available yet."
      />
    </GameListPage>
  );
}
