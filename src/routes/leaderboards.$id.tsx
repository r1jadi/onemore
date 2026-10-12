import { createFileRoute } from "@tanstack/react-router";
import { LeaderboardPage } from "@/components/game/LeaderboardPage";
import { titleFromSlug } from "@/lib/games/catalog";

export const Route = createFileRoute("/leaderboards/$id")({
  head: ({ params }) => {
    const title = titleFromSlug(params.id);
    return {
      meta: [
        { title: `${title} leaderboard — onemore` },
        { name: "description", content: `Top scores on ${title}.` },
        { property: "og:title", content: `${title} leaderboard — onemore` },
        { property: "og:description", content: `Top scores on ${title}.` },
      ],
    };
  },
  component: Board,
});

/**
 * The per-game board.
 *
 * The slug is passed straight through. The prototype resolved an unknown id to
 * the first game in its list, so a mistyped URL silently showed somebody else's
 * leaderboard; now an unknown slug simply has no matching game to title the page.
 */
function Board() {
  const { id } = Route.useParams();
  return <LeaderboardPage gameId={id} />;
}
