import { createFileRoute, Link } from "@tanstack/react-router";
import { Clock, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { titleFromSlug, useGame } from "@/lib/games/catalog";

export const Route = createFileRoute("/results/$id")({
  head: ({ params }) => {
    const title = titleFromSlug(params.id);
    return {
      meta: [
        { title: `${title} results — onemore` },
        { name: "description", content: `${title} on onemore.` },
        { property: "og:title", content: `${title} results — onemore` },
      ],
    };
  },
  component: Results,
});

/**
 * The end-of-run screen.
 *
 * Nothing reaches it yet: a run needs a runtime, and a score needs a session and a
 * scores service. The prototype showed a "global rank", a "friends" position and a
 * top-percentile figure computed from nothing, next to a personal best that was
 * never stored. Real ranks and personal bests arrive with the scoring engine; until
 * then this screen says so instead of inventing a number.
 */
function Results() {
  const { id } = Route.useParams();
  const state = useGame(id);
  const title = state.status === "ready" ? state.game.title : titleFromSlug(id);

  return (
    <div className="min-h-dvh bg-background">
      <div className="mx-auto flex min-h-dvh max-w-md flex-col px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="flex justify-end">
          <Button asChild variant="ghost" size="icon" aria-label="Close">
            <Link to="/">
              <X />
            </Link>
          </Button>
        </div>
        <div className="enter mt-10 flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-surface-2">
            <Clock className="size-5 text-muted-foreground" />
          </div>
          <h1 className="text-xl font-semibold">No run to show</h1>
          <p className="max-w-sm text-sm text-muted-foreground">
            {title} is not playable yet, so no score was recorded. Ranks and personal bests arrive
            with the scoring engine.
          </p>
          <Button asChild variant="play" size="lg" className="mt-2">
            <Link to="/games/$id" params={{ id }}>
              Back to the game
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
