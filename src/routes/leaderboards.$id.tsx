import { createFileRoute } from "@tanstack/react-router";
import { LeaderboardPage } from "@/components/game/LeaderboardPage";
import { getGame } from "@/lib/mock";

export const Route = createFileRoute("/leaderboards/$id")({
  head: ({ params }) => {
    const g = getGame(params.id);
    return { meta: [{ title: `${g.title} leaderboard — onemore` }, { name: "description", content: `Top scores on ${g.title}.` }, { property: "og:title", content: `${g.title} leaderboard — onemore` }, { property: "og:description", content: `Top scores on ${g.title}.` }] };
  },
  component: Board,
});

function Board() {
  const { id } = Route.useParams();
  return <LeaderboardPage gameId={getGame(id).id} />;
}
