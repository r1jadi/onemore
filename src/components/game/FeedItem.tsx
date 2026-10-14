import { Link } from "@tanstack/react-router";
import { Bookmark, Clock, Heart, Info, MessageCircle, Play, Share2, Trophy } from "lucide-react";
import { useState } from "react";
import { GameArt } from "./GameArt";
import { Avatar } from "@/components/common";
import { CommentsSheet, ShareSheet } from "@/components/social/Sheets";
import { Button } from "@/components/ui/button";
import { categoryName, type Game } from "@/lib/games/catalog";
import { cn } from "@/lib/utils";

/**
 * One item in the swipeable feed.
 *
 * Two things changed when the catalogue became real, and both are about not
 * claiming more than is known:
 *
 *   - **Every engagement count is gone.** The old card showed likes, comments,
 *     saves and a personal best, all of which came from fixtures. No service
 *     records any of them, and a plausible number on screen cannot be told apart
 *     from a real one, so the icons stay (they are the existing affordances) and
 *     the numbers do not.
 *   - **Playability is stated.** No game has a runtime yet, so "Tap to play" would
 *     be a promise the product cannot keep. The board is a link to the game's
 *     page instead, and the button says what it does.
 */
function Action({
  icon: Icon,
  label,
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

  const category = categoryName(game);

  return (
    <article
      className="relative flex h-dvh snap-start snap-always items-stretch justify-center md:h-[calc(100dvh-0px)] md:py-6"
      aria-label={game.title}
    >
      <div className="relative flex w-full max-w-[460px] flex-col overflow-hidden md:rounded-2xl md:border md:border-glass-border">
        {/* Board — a playable game starts, an unplayable one opens its page. */}
        <Link
          to={game.playable ? "/play/$id" : "/games/$id"}
          params={{ id: game.slug }}
          className="group relative flex-1"
          aria-label={game.playable ? `Play ${game.title}` : `View ${game.title}`}
        >
          <GameArt id={game.slug} className="absolute inset-0" />
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="press flex items-center gap-2 rounded-full glass px-5 py-3 text-sm font-semibold group-hover:bg-surface-2">
              {game.playable ? (
                <>
                  <Play className="size-4 fill-current" /> Tap to play
                </>
              ) : (
                <>
                  <Clock className="size-4" /> Not playable yet
                </>
              )}
            </span>
          </div>
          <div className="absolute top-0 inset-x-0 flex items-center justify-between p-4 pt-[max(4rem,calc(env(safe-area-inset-top)+3rem))] md:pt-4">
            {category ? (
              <span className="rounded-md glass px-2 py-1 text-xs font-medium">{category}</span>
            ) : (
              <span />
            )}
            {game.playable ? (
              <span className="rounded-md glass px-2 py-1 text-xs font-medium">Playable</span>
            ) : (
              <span />
            )}
          </div>
        </Link>

        {/* Info */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-0 scrim-bottom">
          <div className="pointer-events-auto space-y-3 p-4 pr-20 md:pr-4">
            {game.isOfficial && (
              <div className="flex items-center gap-2 text-sm font-medium">
                <Avatar name="onemore" size="sm" />
                OneMore
              </div>
            )}
            <div>
              <h2 className="text-2xl font-semibold">{game.title}</h2>
              {game.tagline && <p className="text-sm text-muted-foreground">{game.tagline}</p>}
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span>{game.playable ? "Ready to play" : "Not playable yet"}</span>
              {category && (
                <>
                  <span aria-hidden>·</span>
                  <span>{category}</span>
                </>
              )}
            </div>
            <div className="flex gap-2">
              {game.playable ? (
                <>
                  <Button asChild variant="play" size="lg" className="flex-1">
                    <Link to="/play/$id" params={{ id: game.slug }}>
                      <Play className="fill-current" /> Play
                    </Link>
                  </Button>
                  <Button asChild variant="glass" size="lg" aria-label="Game details">
                    <Link to="/games/$id" params={{ id: game.slug }}>
                      <Info />
                    </Link>
                  </Button>
                </>
              ) : (
                <Button asChild variant="play" size="lg" className="flex-1">
                  <Link to="/games/$id" params={{ id: game.slug }}>
                    <Info /> Details
                  </Link>
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Action rail. The affordances are the ones the app always had; the counts
          they used to carry came from fixtures and are gone. */}
      <div className="absolute right-3 bottom-44 flex flex-col gap-4 md:static md:ml-4 md:self-end md:pb-6">
        <Action icon={Heart} label="Like" active={liked} onClick={() => setLiked(!liked)} />
        <Action icon={MessageCircle} label="Comments" onClick={() => setComments(true)} />
        <Action icon={Bookmark} label="Save" active={saved} onClick={() => setSaved(!saved)} />
        <Action icon={Trophy} label="Leaderboard" to={{ id: game.slug }} />
        <Action icon={Share2} label="Share" onClick={() => setShare(true)} />
      </div>

      <CommentsSheet open={comments} onOpenChange={setComments} />
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
