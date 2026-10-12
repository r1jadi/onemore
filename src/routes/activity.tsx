import { createFileRoute } from "@tanstack/react-router";
import { EmptyState, Page, PageHeader } from "@/components/common";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/activity")({
  head: () => seo("Activity", "Your recent plays, scores, likes and comments."),
  component: Activity,
});

/**
 * Your activity.
 *
 * Every row the prototype showed — "Scored 2,140 on Stack 10", "Liked Color
 * Merge" — was invented. An activity feed is also the one place a fabrication is
 * indistinguishable from a memory: it reports actions the visitor took. Nothing
 * records plays, scores, likes or comments yet, so the feed is empty and says why.
 */
function Activity() {
  return (
    <Page>
      <PageHeader back title="Your activity" subtitle="Plays, likes, comments and saves." />
      <EmptyState
        title="No activity yet"
        body="Plays, scores, likes, comments and saves are not recorded yet. When they are, they show up here."
      />
    </Page>
  );
}
