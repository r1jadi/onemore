import { createFileRoute } from "@tanstack/react-router";
import { GameListPage } from "@/components/game/GameListPage";
import { categories, games } from "@/lib/mock";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/categories/$slug")({
  head: () => seo("Category", "Browse games in this category."),
  component: Cat,
});

function Cat() {
  const { slug } = Route.useParams();
  const c = categories.find((x) => x.slug === slug);
  const list = games.filter((g) => g.category.toLowerCase() === slug);
  return <GameListPage title={c?.name ?? "Category"} subtitle="Browse games in this category." items={list.length ? list : games} ranked />;
}
