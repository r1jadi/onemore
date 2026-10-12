import { Link } from "@tanstack/react-router";
import { Play } from "lucide-react";
import { GameArt } from "./GameArt";
import { fmt, type Game } from "@/lib/mock";
import { cn } from "@/lib/utils";

export function GameCard({
  game,
  className,
  rank,
}: {
  game: Game;
  className?: string;
  rank?: number;
}) {
  return (
    <Link
      to="/games/$id"
      params={{ id: game.id }}
      className={cn("press group block enter", className)}
    >
      <div className="relative overflow-hidden rounded-xl border border-glass-border">
        <GameArt id={game.id} className="aspect-[4/5] w-full" />
        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between p-2.5 scrim-bottom">
          <span className="inline-flex items-center gap-1 text-xs font-medium tabular">
            <Play className="size-3 fill-current" />
            {fmt(game.plays)}
          </span>
          {rank && <span className="font-mono text-xs text-muted-foreground">#{rank}</span>}
        </div>
        {(game.isNew || game.isDaily) && (
          <span className="absolute top-2 left-2 rounded-md glass px-1.5 py-0.5 text-[11px] font-medium">
            {game.isDaily ? "Daily" : "New"}
          </span>
        )}
      </div>
      <p className="mt-2 truncate text-sm font-medium">{game.title}</p>
      <p className="truncate text-xs text-muted-foreground">
        {game.category} · @{game.creator}
      </p>
    </Link>
  );
}

export function GameRow({
  game,
  meta,
  action,
}: {
  game: Game;
  meta?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="enter flex items-center gap-3 px-4 py-3 md:px-0">
      <Link
        to="/games/$id"
        params={{ id: game.id }}
        className="press flex min-w-0 flex-1 items-center gap-3"
      >
        <GameThumb game={game} />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{game.title}</p>
          <p className="truncate text-xs text-muted-foreground">
            {meta ?? `${game.category} · ${fmt(game.plays)} plays`}
          </p>
        </div>
      </Link>
      {action}
    </div>
  );
}

export function GameThumb({ game, className }: { game: Game; className?: string }) {
  return (
    <span
      className={cn(
        "relative block size-14 shrink-0 overflow-hidden rounded-lg border border-glass-border",
        className,
      )}
    >
      <GameArt
        id={game.id}
        className="absolute top-0 left-0 size-40 origin-top-left scale-[0.35]"
      />
    </span>
  );
}
