import { createFileRoute } from "@tanstack/react-router";
import { GameListPage } from "@/components/game/GameListPage";
import { DEFAULT_PAGE_SIZE } from "@/lib/games/catalog";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/new")({
  head: () => seo("New games", "The newest additions to the catalogue."),
  component: NewGames,
});

/**
 * Newest first.
 *
 * The catalogue's only order is publication order, which is exactly what this
 * page wants, so it is a plain listing rather than a ranking. The prototype's
 * "This week / This month" chips are gone: nothing records a play date and the
 * catalogue has no date-window filter, so they filtered nothing.
 */
function NewGames() {
  return (
    <GameListPage
      title="New games"
      subtitle="The newest additions to the catalogue."
      query={{ limit: DEFAULT_PAGE_SIZE }}
      empty={{
        title: "No games published yet",
        body: "New games appear here as they are published.",
      }}
    />
  );
}
