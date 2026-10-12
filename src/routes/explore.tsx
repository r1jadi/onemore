import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, Search } from "lucide-react";
import { GridSkeleton, Page, PageHeader, Section, useMockLoad } from "@/components/common";
import { GameArt } from "@/components/game/GameArt";
import { GameCard } from "@/components/game/GameCard";
import { Button } from "@/components/ui/button";
import { categories, games } from "@/lib/mock";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/explore")({
  head: () => seo("Explore", "Discover trending, new and popular games by category."),
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

function Explore() {
  const loading = useMockLoad();
  const daily = games.find((g) => g.isDaily)!;
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
          Search games and people
        </Link>
        <Link
          to="/games/$id"
          params={{ id: daily.id }}
          className="press mt-4 flex items-center gap-4 overflow-hidden rounded-2xl border border-glass-border bg-surface p-4"
        >
          <div className="flex-1">
            <p className="text-xs font-medium text-primary">Today's challenge</p>
            <p className="mt-1 text-lg font-semibold">{daily.title}</p>
            <p className="text-sm text-muted-foreground">One attempt. Resets in 9h 12m.</p>
          </div>
          <GameArt
            id={daily.id}
            className="size-24 shrink-0 rounded-xl [&_span.text-6xl]:text-2xl [&>div>div]:size-20 [&>div>div]:border-4 [&>div>span]:hidden"
          />
        </Link>
      </div>
      <Section title="Categories" action={<More to="/categories" />}>
        <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 md:flex-wrap md:px-0">
          {categories.map((c) => (
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
      </Section>
      {[
        ["Trending", "/trending", games.slice(0, 6)],
        ["New", "/new", games.filter((g) => g.isNew).concat(games.slice(5))],
        ["Popular", "/popular", [...games].sort((a, b) => b.plays - a.plays).slice(0, 6)],
      ].map(([title, to, list]) => (
        <Section key={title as string} title={title as string} action={<More to={to as string} />}>
          {loading ? (
            <GridSkeleton count={3} />
          ) : (
            <div className="no-scrollbar flex gap-3 overflow-x-auto px-4 md:grid md:grid-cols-4 md:px-0 lg:grid-cols-5">
              {(list as typeof games).slice(0, 5).map((g) => (
                <GameCard key={g.id} game={g} className="w-36 shrink-0 md:w-auto" />
              ))}
            </div>
          )}
        </Section>
      ))}
    </Page>
  );
}
