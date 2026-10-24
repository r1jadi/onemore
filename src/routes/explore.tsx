import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, Search } from "lucide-react";
import type { ReactNode } from "react";
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
 * One section whose read failed.
 *
 * The sections that did load stay, the failed one says so, and it offers the
 * only action that can help. It never fills the gap with a different set of
 * games — there is nothing to fall back to, and a plausible-looking grid under
 * a heading that failed would be indistinguishable from a real one.
 */
function SectionError({ children, onRetry }: { children: ReactNode; onRetry: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <p className="text-muted-foreground">{children}</p>
      <button
        type="button"
        onClick={onRetry}
        className="font-medium underline underline-offset-4 transition-colors hover:text-primary"
      >
        Retry
      </button>
    </div>
  );
}

/**
 * Explore.
 *
 * The daily challenge and the category list are real. "Trending" and "Popular"
 * are not, and say so rather than reusing the newest games under a ranking
 * heading: both need a ranking of recorded plays over a window, and the catalogue
 * has no ranking endpoint. Plays themselves are recorded (each finished run is a
 * play), so the absence is the ranking, not the data. Showing the catalogue in
 * publication order under "Trending" would be a fabricated ranking.
 */
export function Explore() {
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
        {daily.status === "error" ? (
          <div className="mt-4">
            <SectionError onRetry={daily.retry}>
              Today's challenge is unavailable right now.
            </SectionError>
          </div>
        ) : challenge ? (
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
            <GameArt id={challenge.slug} className="size-24 shrink-0 rounded-xl" />
          </Link>
        ) : null}
      </div>

      <Section title="Categories" action={<More to="/categories" />}>
        {categories.status === "loading" ? (
          <div className="px-4 md:px-0">
            <GridSkeleton count={3} />
          </div>
        ) : categories.status === "error" ? (
          <div className="px-4 md:px-0">
            <SectionError onRetry={categories.retry}>
              Categories are unavailable right now.
            </SectionError>
          </div>
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
          <div className="px-4 md:px-0">
            <SectionError onRetry={newest.retry}>
              The catalogue is unavailable right now.
            </SectionError>
          </div>
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
            "Trending needs plays ranked over time. Plays are recorded, but the catalogue does not rank them yet, so no game can be listed here.",
          ],
          [
            "Popular",
            "/popular",
            "Popularity needs plays counted and ranked. Plays are recorded, but the catalogue does not rank them yet, so no game can be listed here.",
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
