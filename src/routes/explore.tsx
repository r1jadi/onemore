import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, Search } from "lucide-react";
import { EmptyState, GridSkeleton, Page, PageHeader, Section } from "@/components/common";
import { GameArt } from "@/components/game/GameArt";
import { GameCard } from "@/components/game/GameCard";
import { Button } from "@/components/ui/button";
import { useCategories, useGames } from "@/lib/games/catalog";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/explore")({
  head: () => seo("Explore", "Discover new games and browse every category."),
  component: Explore,
});

function More({ to }: { to: string }) {
  return (
    <Link to={to} className="flex items-center text-sm text-muted-foreground hover:text-foreground">
      See all
      <ChevronRight className="size-4" />
    </Link>
  );
}

/**
 * Explore.
 *
 * The daily challenge and the category list are real. "Trending" and "Popular"
 * are not, and say so rather than reusing the newest games under a ranking
 * heading: both need play counts, and nothing records a play yet. Showing the
 * catalogue in publication order under "Trending" would be a fabricated ranking.
 */
function Explore() {
  const daily = useGames({ category: "daily", limit: 1 });
  const newest = useGames({ limit: 5 });
  const categories = useCategories();
  const challenge = daily.items[0];

  return (
    <Page className="max-w-5xl">
      <PageHeader
        title="Explore"
        subtitle="Find your next game."
        actions={
          <Button asChild variant="ghost" size="icon" aria-label="Search">
            <Link to="/search">
              <Search />
            </Link>
          </Button>
        }
      />
      <div className="px-4 md:px-0">
        <Link
          to="/search"
          className="press flex h-11 items-center gap-2 rounded-xl bg-surface px-4 text-sm text-muted-foreground md:hidden"
        >
          <Search className="size-4" />
          Search games
        </Link>
        {challenge && (
          <Link
            to="/games/$id"
            params={{ id: challenge.slug }}
            className="press mt-4 flex items-center gap-4 overflow-hidden rounded-2xl border border-glass-border bg-surface p-4"
          >
            <div className="flex-1">
              <p className="text-xs font-medium text-primary">Today's challenge</p>
              <p className="mt-1 text-lg font-semibold">{challenge.title}</p>
              <p className="text-sm text-muted-foreground">
                {challenge.playable ? "One attempt." : "Not playable yet."}
              </p>
            </div>
            <GameArt
              id={challenge.slug}
              className="size-24 shrink-0 rounded-xl [&_span.text-6xl]:text-2xl [&>div>div]:size-20 [&>div>div]:border-4 [&>div>span]:hidden"
            />
          </Link>
        )}
      </div>

      <Section title="Categories" action={<More to="/categories" />}>
        {categories.status === "loading" ? (
          <div className="px-4 md:px-0">
            <GridSkeleton count={3} />
          </div>
        ) : categories.status === "error" ? (
          <p className="px-4 text-sm text-muted-foreground md:px-0">
            Categories are unavailable right now.
          </p>
        ) : (
          <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 md:flex-wrap md:px-0">
            {categories.items.map((c) => (
              <Link
                key={c.slug}
                to="/categories/$slug"
                params={{ slug: c.slug }}
                className="press shrink-0 rounded-full border border-border px-4 py-2 text-sm hover:bg-surface"
              >
                {c.name}
              </Link>
            ))}
          </div>
        )}
      </Section>

      <Section title="New" action={<More to="/new" />}>
        {newest.status === "loading" ? (
          <GridSkeleton count={3} />
        ) : newest.status === "error" ? (
          <p className="px-4 text-sm text-muted-foreground md:px-0">
            The catalogue is unavailable right now.
          </p>
        ) : newest.items.length === 0 ? (
          <EmptyState title="No games published yet" />
        ) : (
          <div className="no-scrollbar flex gap-3 overflow-x-auto px-4 md:grid md:grid-cols-4 md:px-0 lg:grid-cols-5">
            {newest.items.map((game) => (
              <GameCard key={game.slug} game={game} className="w-36 shrink-0 md:w-auto" />
            ))}
          </div>
        )}
      </Section>

      {(
        [
          [
            "Trending",
            "/trending",
            "Trending needs play counts. Nothing records plays yet, so no game can be ranked.",
          ],
          [
            "Popular",
            "/popular",
            "Popularity needs play counts. Nothing records plays yet, so no game can be ranked.",
          ],
        ] as const
      ).map(([title, to, body]) => (
        <Section key={title} title={title} action={<More to={to} />}>
          <div className="px-4 md:px-0">
            <EmptyState title={`${title} is not available yet`} body={body} />
          </div>
        </Section>
      ))}
    </Page>
  );
}
