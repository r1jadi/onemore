import { createFileRoute, Link } from "@tanstack/react-router";
import { Bookmark } from "lucide-react";
import { EmptyState, ErrorState, GridSkeleton, Page, PageHeader } from "@/components/common";
import { GameCard } from "@/components/game/GameCard";
import { Button } from "@/components/ui/button";
import { useSavedGames } from "@/lib/social/engagement";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/saved")({
  head: () => seo("Saved games", "Games you saved to play later."),
  component: Saved,
});

/**
 * Saved games.
 *
 * Saves are stored per player in `public.saves` and read back here newest
 * first. A game that no longer resolves is omitted rather than listed as a
 * dead row.
 */
function Saved() {
  const list = useSavedGames();

  if (list.status === "anonymous") {
    return (
      <Page className="max-w-5xl">
        <PageHeader back title="Saved games" subtitle="Games you saved to play later." />
        <div className="px-4 md:px-0">
          <EmptyState
            icon={Bookmark}
            title="Sign in to save games"
            body="Saving keeps the games you want to play later in one place."
            action={
              <Button asChild>
                <Link to="/login" search={{ redirect: "/saved" }}>
                  Log in
                </Link>
              </Button>
            }
          />
        </div>
      </Page>
    );
  }

  if (list.status === "loading") {
    return (
      <Page className="max-w-5xl">
        <PageHeader back title="Saved games" subtitle="Games you saved to play later." />
        <GridSkeleton />
      </Page>
    );
  }

  if (list.status === "error") {
    return (
      <Page className="max-w-5xl">
        <PageHeader back title="Saved games" subtitle="Games you saved to play later." />
        <div className="px-4 md:px-0">
          <ErrorState title="Couldn't load saved games" body={list.error} onRetry={list.retry} />
        </div>
      </Page>
    );
  }

  if (list.games.length === 0) {
    return (
      <Page className="max-w-5xl">
        <PageHeader back title="Saved games" subtitle="Games you saved to play later." />
        <div className="px-4 md:px-0">
          <EmptyState
            icon={Bookmark}
            title="Nothing saved yet"
            body="Tap the bookmark on any game and it shows up here."
          />
        </div>
      </Page>
    );
  }

  return (
    <Page className="max-w-5xl">
      <PageHeader back title="Saved games" subtitle="Games you saved to play later." />
      <div className="grid grid-cols-2 gap-x-3 gap-y-5 px-4 md:grid-cols-3 md:px-0 lg:grid-cols-4">
        {list.games.map((game) => (
          <GameCard key={game.slug} game={game} />
        ))}
      </div>
    </Page>
  );
}
