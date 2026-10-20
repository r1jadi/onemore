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
 * popularity is a count of recorded plays — those are recorded now, one per
 * finished run — but nothing orders games by that count, so there is no ranking to
 * show. Saying "no plays are recorded" would be false; saying the ranking does not
 * exist, and linking to the one order the catalogue does have, is the honest page.
 */
function Popular() {
  return (
    <GameListPage title="Popular games" subtitle="The most played games on onemore.">
      <EmptyState
        title="Ranking is not available yet"
        body="Popularity is a count of recorded plays. Plays are recorded, but no game is ranked by them yet. Browse the newest games instead."
      />
    </GameListPage>
  );
}
