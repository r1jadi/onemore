import { createFileRoute } from "@tanstack/react-router";
import { GameListPage } from "@/components/game/GameListPage";
import { EmptyState } from "@/components/common";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/popular")({
  head: () => seo("Popular games", "The most played games on onemore."),
  component: Popular,
});

/**
 * Popularity, honestly reported as unavailable.
 *
 * The prototype sorted its fixture games by a fabricated `plays` field. Real
 * popularity is a count of recorded plays, and no service records plays yet — the
 * sessions and scores services are not implemented, so the plays table is empty.
 * Showing the newest games under this heading would be a fabricated ranking, so
 * the page says the ranking does not exist and links to the one order the
 * catalogue does have.
 */
function Popular() {
  return (
    <GameListPage title="Popular games" subtitle="The most played games on onemore.">
      <EmptyState
        title="Ranking is not available yet"
        body="Popularity is a real count of plays, and nothing records plays yet. Browse the newest games instead."
      />
    </GameListPage>
  );
}
