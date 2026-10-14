import { createFileRoute, Link } from "@tanstack/react-router";
import { Heart } from "lucide-react";
import { EmptyState, ErrorState, GridSkeleton, Page, PageHeader } from "@/components/common";
import { GameCard } from "@/components/game/GameCard";
import { Button } from "@/components/ui/button";
import { useLikedGames } from "@/lib/social/engagement";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/likes")({
  head: () => seo("Liked games", "Games you liked."),
  component: Liked,
});

/**
 * Liked games.
 *
 * Likes are stored per player in `public.likes` and read back here newest
 * first. A game that no longer resolves is omitted rather than listed as a
 * dead row.
 */
function Liked() {
  const list = useLikedGames();

  if (list.status === "anonymous") {
    return (
      <Page className="max-w-5xl">
        <PageHeader back title="Liked games" subtitle="Games you liked." />
        <div className="px-4 md:px-0">
          <EmptyState
            icon={Heart}
            title="Sign in to like games"
            body="Liking keeps the games you love in one place."
            action={
              <Button asChild>
                <Link to="/login" search={{ redirect: "/likes" }}>
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
        <PageHeader back title="Liked games" subtitle="Games you liked." />
        <GridSkeleton />
      </Page>
    );
  }

  if (list.status === "error") {
    return (
      <Page className="max-w-5xl">
        <PageHeader back title="Liked games" subtitle="Games you liked." />
        <div className="px-4 md:px-0">
          <ErrorState title="Couldn't load liked games" body={list.error} onRetry={list.retry} />
        </div>
      </Page>
    );
  }

  if (list.games.length === 0) {
    return (
      <Page className="max-w-5xl">
        <PageHeader back title="Liked games" subtitle="Games you liked." />
        <div className="px-4 md:px-0">
          <EmptyState
            icon={Heart}
            title="Nothing liked yet"
            body="Tap the heart on any game and it shows up here."
          />
        </div>
      </Page>
    );
  }

  return (
    <Page className="max-w-5xl">
      <PageHeader back title="Liked games" subtitle="Games you liked." />
      <div className="grid grid-cols-2 gap-x-3 gap-y-5 px-4 md:grid-cols-3 md:px-0 lg:grid-cols-4">
        {list.games.map((game) => (
          <GameCard key={game.slug} game={game} />
        ))}
      </div>
    </Page>
  );
}
