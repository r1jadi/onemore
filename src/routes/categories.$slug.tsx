import { createFileRoute, notFound } from "@tanstack/react-router";
import { GameListPage } from "@/components/game/GameListPage";
import { breadcrumbJsonLd, seo } from "@/lib/seo";
import { categories, games } from "@/lib/mock";

export const Route = createFileRoute("/categories/$slug")({
  // Unknown slugs must 404 rather than fall back to the full catalogue, which
  // would publish the same content under unlimited URLs.
  beforeLoad: ({ params }) => {
    if (!categories.some((c) => c.slug === params.slug)) throw notFound();
  },
  head: ({ params }) => {
    const c = categories.find((x) => x.slug === params.slug);
    const title = c?.name ?? "Category";
    const description = `Play the best ${title.toLowerCase()} games on onemore.`;
    return seo(title, description, {
      jsonLd: breadcrumbJsonLd([
        { name: "Categories", path: "/categories" },
        { name: title, path: `/categories/${params.slug}` },
      ]),
    });
  },
  component: Cat,
});

function Cat() {
  const { slug } = Route.useParams();
  const c = categories.find((x) => x.slug === slug);
  const list = games.filter((g) => g.category.toLowerCase() === slug);
  return (
    <GameListPage
      title={c?.name ?? "Category"}
      subtitle="Browse games in this category."
      items={list.length ? list : games}
      ranked
    />
  );
}
