import { Link } from "@tanstack/react-router";
import { Bookmark, Heart, Info, MessageCircle, Play, Share2, Trophy } from "lucide-react";
import { useState } from "react";
import { GameArt } from "./GameArt";
import { Avatar, FollowButton } from "@/components/common";
import { CommentsSheet, ShareSheet } from "@/components/social/Sheets";
import { Button } from "@/components/ui/button";
import { fmt, type Game } from "@/lib/mock";
import { cn } from "@/lib/utils";

function Action({
  icon: Icon,
  label,
  count,
  active,
  onClick,
  to,
}: {
  icon: typeof Heart;
  label: string;
  count?: number;
  active?: boolean;
  onClick?: () => void;
  to?: { id: string };
}) {
  const body = (
    <>
      <span
        className={cn(
          "flex size-12 items-center justify-center rounded-full glass",
          active && "border-primary/40",
        )}
      >
        <Icon
          className={cn("size-[22px]", active && "fill-primary text-primary")}
          strokeWidth={1.75}
        />
      </span>
      {count !== undefined && <span className="text-xs font-medium tabular">{fmt(count)}</span>}
    </>
  );
  const cls = "press flex flex-col items-center gap-1";
  return to ? (
    <Link to="/leaderboards/$id" params={to} aria-label={label} className={cls}>
      {body}
    </Link>
  ) : (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cls}
    >
      {body}
    </button>
  );
}

export function FeedItem({ game }: { game: Game }) {
  const [liked, setLiked] = useState(false);
  const [saved, setSaved] = useState(false);
  const [comments, setComments] = useState(false);
  const [share, setShare] = useState(false);

  return (
    <article
      className="relative flex h-dvh snap-start snap-always items-stretch justify-center md:h-[calc(100dvh-0px)] md:py-6"
      aria-label={game.title}
    >
      <div className="relative flex w-full max-w-[460px] flex-col overflow-hidden md:rounded-2xl md:border md:border-glass-border">
        {/* Board — tapping it starts the game */}
        <Link
          to="/play/$id"
          params={{ id: game.id }}
          className="group relative flex-1"
          aria-label={`Play ${game.title}`}
        >
          <GameArt id={game.id} className="absolute inset-0" />
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="press flex items-center gap-2 rounded-full glass px-5 py-3 text-sm font-semibold group-hover:bg-surface-2">
              <Play className="size-4 fill-current" /> Tap to play
            </span>
          </div>
          <div className="absolute top-0 inset-x-0 flex items-center justify-between p-4 pt-[max(4rem,calc(env(safe-area-inset-top)+3rem))] md:pt-4">
            <span className="rounded-md glass px-2 py-1 text-xs font-medium">{game.category}</span>
            <span className="rounded-md glass px-2 py-1 font-mono text-xs tabular">
              Best {fmt(game.bestScore)}
            </span>
          </div>
        </Link>

        {/* Info */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 pb-20 md:pb-0 scrim-bottom">
          <div className="pointer-events-auto space-y-3 p-4 pr-20 md:pr-4">
            <div className="flex items-center gap-2">
              <Link
                to="/u/$username"
                params={{ username: game.creator }}
                className="flex items-center gap-2 text-sm font-medium"
              >
                <Avatar name={game.creator} size="sm" />@{game.creator}
              </Link>
              <FollowButton />
            </div>
            <div>
              <h2 className="text-2xl font-semibold">{game.title}</h2>
              <p className="text-sm text-muted-foreground">{game.tagline}</p>
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              {game.yourBest ? (
                <span>
                  Your best{" "}
                  <span className="font-mono text-foreground tabular">{fmt(game.yourBest)}</span>
                </span>
              ) : (
                <span>Not played yet</span>
              )}
              <span aria-hidden>·</span>
              <span>{fmt(game.plays)} plays</span>
            </div>
            <div className="flex gap-2">
              <Button asChild variant="play" size="lg" className="flex-1">
                <Link to="/play/$id" params={{ id: game.id }}>
                  <Play className="fill-current" /> Play
                </Link>
              </Button>
              <Button asChild variant="glass" size="lg" aria-label="Game details">
                <Link to="/games/$id" params={{ id: game.id }}>
                  <Info />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Action rail */}
      <div className="absolute right-3 bottom-44 flex flex-col gap-4 md:static md:ml-4 md:self-end md:pb-6">
        <Action
          icon={Heart}
          label="Like"
          count={game.likes + (liked ? 1 : 0)}
          active={liked}
          onClick={() => setLiked(!liked)}
        />
        <Action
          icon={MessageCircle}
          label="Comments"
          count={game.comments}
          onClick={() => setComments(true)}
        />
        <Action
          icon={Bookmark}
          label="Save"
          count={game.saves + (saved ? 1 : 0)}
          active={saved}
          onClick={() => setSaved(!saved)}
        />
        <Action icon={Trophy} label="Leaderboard" to={{ id: game.id }} />
        <Action icon={Share2} label="Share" onClick={() => setShare(true)} />
      </div>

      <CommentsSheet open={comments} onOpenChange={setComments} count={game.comments} />
      <ShareSheet open={share} onOpenChange={setShare} title={game.title} />
    </article>
  );
}

export function FeedSkeleton() {
  return (
    <div
      className="flex h-dvh items-center justify-center md:py-6"
      aria-busy="true"
      aria-label="Loading feed"
    >
      <div className="relative h-full w-full max-w-[460px] animate-pulse bg-surface md:rounded-2xl">
        <div className="absolute bottom-24 left-4 right-20 space-y-3">
          <div className="h-3 w-28 rounded bg-surface-2" />
          <div className="h-6 w-48 rounded bg-surface-2" />
          <div className="h-3 w-56 rounded bg-surface-2" />
          <div className="h-12 w-full rounded-lg bg-surface-2" />
        </div>
      </div>
    </div>
  );
}
