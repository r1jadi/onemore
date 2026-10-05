import { createFileRoute, Link } from "@tanstack/react-router";
import { Bookmark, Heart, MessageCircle, Play, Share2 } from "lucide-react";
import { useState } from "react";
import { Avatar, FollowButton, Page, PageHeader, Section, useMockLoad } from "@/components/common";
import { GameArt } from "@/components/game/GameArt";
import { GameCard } from "@/components/game/GameCard";
import { LeaderboardList } from "@/components/game/Leaderboard";
import { CommentsSheet, ShareSheet } from "@/components/social/Sheets";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { fmt, games, getGame } from "@/lib/mock";

export const Route = createFileRoute("/games/$id")({
  head: ({ params }) => {
    const g = getGame(params.id);
    return {
      meta: [
        { title: `${g.title} — onemore` },
        { name: "description", content: g.description },
        { property: "og:title", content: `${g.title} — onemore` },
        { property: "og:description", content: g.description },
      ],
    };
  },
  component: GameDetails,
});

function GameDetails() {
  const { id } = Route.useParams();
  const g = getGame(id);
  const loading = useMockLoad();
  const [liked, setLiked] = useState(false);
  const [saved, setSaved] = useState(false);
  const [c, setC] = useState(false);
  const [s, setS] = useState(false);

  return (
    <Page className="max-w-5xl pb-40 md:pb-12">
      <PageHeader back title={g.title} />
      <div className="md:grid md:grid-cols-[minmax(0,1fr)_340px] md:gap-8">
        <div>
          {loading ? (
            <Skeleton className="aspect-square w-full md:rounded-2xl" />
          ) : (
            <GameArt
              id={g.id}
              className="aspect-square w-full border-glass-border md:rounded-2xl md:border"
            />
          )}
          <div className="px-4 pt-4 md:px-0">
            <div className="flex items-center gap-2">
              <Link
                to="/u/$username"
                params={{ username: g.creator }}
                className="flex items-center gap-2 text-sm font-medium"
              >
                <Avatar name={g.creator} size="sm" />@{g.creator}
              </Link>
              <FollowButton />
            </div>
            <p className="mt-3 text-muted-foreground">{g.description}</p>
            <dl className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-surface p-3 text-center">
              {[
                ["Plays", fmt(g.plays)],
                ["Avg session", g.avgSession],
                ["Category", g.category],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-muted-foreground">{k}</dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular">{v}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-4 flex gap-2">
              <Button
                variant="secondary"
                className="flex-1"
                aria-pressed={liked}
                onClick={() => setLiked(!liked)}
              >
                <Heart className={liked ? "fill-primary text-primary" : ""} />
                {fmt(g.likes + (liked ? 1 : 0))}
              </Button>
              <Button variant="secondary" className="flex-1" onClick={() => setC(true)}>
                <MessageCircle />
                {fmt(g.comments)}
              </Button>
              <Button
                variant="secondary"
                size="icon"
                aria-label="Save"
                aria-pressed={saved}
                onClick={() => setSaved(!saved)}
              >
                <Bookmark className={saved ? "fill-primary text-primary" : ""} />
              </Button>
              <Button variant="secondary" size="icon" aria-label="Share" onClick={() => setS(true)}>
                <Share2 />
              </Button>
            </div>
          </div>
        </div>
        <aside className="md:sticky md:top-8 md:self-start">
          <div className="hidden rounded-2xl border border-border bg-surface p-4 md:block">
            <p className="text-xs text-muted-foreground">Your best</p>
            <p className="font-mono text-3xl font-semibold tabular">
              {g.yourBest ? fmt(g.yourBest) : "—"}
            </p>
            <Button asChild variant="play" size="xl" className="mt-4 w-full">
              <Link to="/play/$id" params={{ id: g.id }}>
                <Play className="fill-current" />
                Play
              </Link>
            </Button>
          </div>
          <Section
            title="Top scores"
            action={
              <Link
                to="/leaderboards/$id"
                params={{ id: g.id }}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Full board
              </Link>
            }
          >
            <LeaderboardList limit={5} />
          </Section>
        </aside>
      </div>
      <Section title="More like this">
        <div className="no-scrollbar flex gap-3 overflow-x-auto px-4 md:grid md:grid-cols-4 md:px-0">
          {games
            .filter((x) => x.id !== g.id)
            .slice(0, 4)
            .map((x) => (
              <GameCard key={x.id} game={x} className="w-36 shrink-0 md:w-auto" />
            ))}
        </div>
      </Section>
      <div className="fixed inset-x-0 bottom-16 z-30 glass border-x-0 border-b-0 p-3 md:hidden">
        <Button asChild variant="play" size="lg" className="w-full">
          <Link to="/play/$id" params={{ id: g.id }}>
            <Play className="fill-current" />
            Play {g.title}
          </Link>
        </Button>
      </div>
      <CommentsSheet open={c} onOpenChange={setC} count={g.comments} />
      <ShareSheet open={s} onOpenChange={setS} title={g.title} />
    </Page>
  );
}
