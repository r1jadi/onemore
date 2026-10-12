import { createFileRoute, Link } from "@tanstack/react-router";
import { Clock, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { titleFromSlug, useGame } from "@/lib/games/catalog";

export const Route = createFileRoute("/play/$id")({
  head: ({ params }) => {
    const title = titleFromSlug(params.id);
    return {
      meta: [
        { title: `${title} — onemore` },
        { name: "description", content: `${title} on onemore.` },
        { property: "og:title", content: `${title} — onemore` },
      ],
    };
  },
  component: PlayScreen,
});

/**
 * The play screen.
 *
 * It used to be a working prototype that scored `10 + random(15)` points on every
 * tap and then reported a global rank and a personal best. None of that was real:
 * there was no game, and no score was ever stored. Presenting it as a playable
 * game was the most misleading thing in the app, so the screen now states the
 * truth — no runtime exists for any catalogue game yet — and keeps the way back to
 * the game's page.
 *
 * The runtime and the session/scoring engine are a later phase. This screen is
 * where a real one will mount, keyed by the game's `runtime` identifier.
 */
function PlayScreen() {
  const { id } = Route.useParams();
  const state = useGame(id);
  const title = state.status === "ready" ? state.game.title : titleFromSlug(id);

  return (
    <div className="fixed inset-0 flex flex-col bg-background">
      <header className="flex items-center gap-3 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
        <Button asChild variant="glass" size="icon" aria-label="Quit game">
          <Link to="/games/$id" params={{ id }}>
            <X />
          </Link>
        </Button>
        <div className="flex-1 text-center">
          <p className="text-xs text-muted-foreground">{title}</p>
        </div>
      </header>

      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-surface-2">
          <Clock className="size-5 text-muted-foreground" />
        </div>
        <h1 className="text-xl font-semibold">
          {state.status === "missing" ? "No such game" : "Not playable yet"}
        </h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          {state.status === "missing"
            ? "That game is not in the catalogue."
            : `${title} has no runtime yet, so there is nothing to start. Scores, sessions and leaderboards arrive with it.`}
        </p>
        <Button asChild variant="play" size="lg" className="mt-2">
          <Link to="/games/$id" params={{ id }}>
            Back to the game
          </Link>
        </Button>
      </div>
    </div>
  );
}
