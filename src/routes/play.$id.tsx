import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Pause, Play, RotateCcw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { GameArt } from "@/components/game/GameArt";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { fmt, getGame } from "@/lib/mock";

export const Route = createFileRoute("/play/$id")({
  head: ({ params }) => {
    const g = getGame(params.id);
    return {
      meta: [
        { title: `Playing ${g.title} — onemore` },
        { name: "description", content: g.tagline },
        { property: "og:title", content: `Play ${g.title} on onemore` },
        { property: "og:description", content: g.tagline },
      ],
    };
  },
  component: PlayScreen,
});

const DURATION = 20;

function PlayScreen() {
  const { id } = Route.useParams();
  const g = getGame(id);
  const nav = useNavigate();
  const [phase, setPhase] = useState<"ready" | "playing" | "paused">("ready");
  const [score, setScore] = useState(0);
  const [time, setTime] = useState(DURATION);

  useEffect(() => {
    if (phase !== "playing") return;
    const t = setInterval(() => setTime((s) => s - 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  useEffect(() => {
    if (time <= 0) nav({ to: "/results/$id", params: { id }, search: { score } });
  }, [time, id, nav, score]);

  const finish = () => nav({ to: "/results/$id", params: { id }, search: { score } });

  return (
    <div className="fixed inset-0 flex flex-col bg-background">
      <header className="flex items-center gap-3 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
        <Button asChild variant="glass" size="icon" aria-label="Quit game">
          <Link to="/games/$id" params={{ id }}>
            <X />
          </Link>
        </Button>
        <div className="flex-1 text-center">
          <p className="text-xs text-muted-foreground">{g.title}</p>
          <p className="font-mono text-2xl font-semibold tabular" aria-live="polite">
            {fmt(score)}
          </p>
        </div>
        <Button
          variant="glass"
          size="icon"
          aria-label="Pause"
          disabled={phase !== "playing"}
          onClick={() => setPhase("paused")}
        >
          <Pause />
        </Button>
      </header>
      <div
        className="mx-4 h-1 overflow-hidden rounded-full bg-surface-2"
        role="progressbar"
        aria-valuenow={time}
        aria-valuemax={DURATION}
        aria-label="Time left"
      >
        <div
          className="h-full bg-primary transition-[width] duration-1000 ease-linear"
          style={{ width: `${(time / DURATION) * 100}%` }}
        />
      </div>

      <button
        className="relative mx-auto my-4 w-full max-w-[460px] flex-1 overflow-hidden md:rounded-2xl"
        aria-label={phase === "playing" ? "Game board — tap to score" : "Start game"}
        onClick={() =>
          phase === "playing"
            ? setScore((s) => s + 10 + Math.floor(Math.random() * 15))
            : phase === "ready" && setPhase("playing")
        }
      >
        <GameArt id={g.id} live={phase === "playing"} className="absolute inset-0" />
        {phase === "ready" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/60 backdrop-blur-sm">
            <p className="max-w-60 text-center text-sm text-muted-foreground">{g.tagline}</p>
            <span className="flex h-14 items-center gap-2 rounded-xl bg-primary px-8 font-semibold text-primary-foreground">
              <Play className="size-4 fill-current" />
              Start game
            </span>
            <span className="text-xs text-muted-foreground">Prototype: tap the board to score</span>
          </div>
        )}
      </button>

      <footer className="flex items-center justify-between px-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-sm text-muted-foreground">
        <span>
          Best <span className="font-mono text-foreground tabular">{fmt(g.yourBest ?? 0)}</span>
        </span>
        <span className="font-mono tabular">{time}s</span>
        <button
          className="underline-offset-4 hover:underline disabled:opacity-40"
          disabled={phase === "ready"}
          onClick={finish}
        >
          End run
        </button>
      </footer>

      <Dialog open={phase === "paused"} onOpenChange={(o) => !o && setPhase("playing")}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>Paused</DialogTitle>
            <DialogDescription>
              Score {fmt(score)} · {time}s left
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Button size="lg" onClick={() => setPhase("playing")}>
              <Play className="fill-current" />
              Resume
            </Button>
            <Button
              size="lg"
              variant="secondary"
              onClick={() => {
                setScore(0);
                setTime(DURATION);
                setPhase("ready");
              }}
            >
              <RotateCcw />
              Restart
            </Button>
            <Button size="lg" variant="ghost" onClick={finish}>
              End run
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
