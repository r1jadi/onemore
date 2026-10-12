import { createFileRoute } from "@tanstack/react-router";
import { Feed } from "@/components/game/Feed";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/following")({
  head: () => seo("Following", "Games played and made by people you follow."),
  component: Following,
});

/**
 * The "Following" feed.
 *
 * It cannot be built yet: a personalised feed needs a follow graph and an
 * attribution of games to the people you follow, and neither exists — following
 * is a separate, unimplemented feature and the catalogue does not name a game's
 * creator. The prototype solved this by showing three hard-coded games, which is
 * a fabricated feed.
 */
function Following() {
  return (
    <Feed
      tab="following"
      items={[]}
      empty={{
        title: "Nothing to show yet",
        body: "Following creators is not available yet. Everything published is in For You.",
      }}
    />
  );
}
