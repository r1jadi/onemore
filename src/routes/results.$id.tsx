import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, RotateCcw, Share2, Trophy, X } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { GameArt } from "@/components/game/GameArt";
import { LeaderboardList } from "@/components/game/Leaderboard";
import { ShareSheet } from "@/components/social/Sheets";
import { Button } from "@/components/ui/button";
import { fmt, games, getGame } from "@/lib/mock";

export const Route = createFileRoute("/results/$id")({
  validateSearch: z.object({ score: z.number().optional() }),
  head: ({ params }) => {
    const g = getGame(params.id);
    return { meta: [{ title: `${g.title} results — onemore` }, { name: "description", content: `Your run on ${g.title}.` }, { property: "og:title", content: `${g.title} results — onemore` }, { property: "og:description", content: `Can you beat this score on ${g.title}?` }] };
  },
  component: Results,
});

function Results() {
  const { id } = Route.useParams();
  const { score = 1840 } = Route.useSearch();
  const g = getGame(id);
  const best = g.yourBest ?? 0;
  const isBest = score > best;
  const next = games[(games.findIndex((x) => x.id === g.id) + 1) % games.length];
  const [share, setShare] = useState(false);

  return (
    <div className="min-h-dvh bg-background">
      <div className="mx-auto flex min-h-dvh max-w-md flex-col px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="flex justify-end"><Button asChild variant="ghost" size="icon" aria-label="Close"><Link to="/"><X /></Link></Button></div>
        <div className="enter mt-4 text-center">
          <p className="text-sm text-muted-foreground">{g.title}</p>
          <p className="mt-2 font-mono text-6xl font-semibold tabular">{fmt(score)}</p>
          {isBest ? <p className="mt-3 inline-flex rounded-full bg-primary/15 px-3 py-1 text-sm font-medium text-primary">New personal best</p> : <p className="mt-3 text-sm text-muted-foreground">Best <span className="font-mono text-foreground tabular">{fmt(best)}</span> · {fmt(best - score)} to go</p>}
        </div>
        <dl className="mt-8 grid grid-cols-3 divide-x divide-border rounded-xl bg-surface py-3 text-center">
          {[["Global rank", "#212"], ["Friends", "3rd"], ["Top", "8%"]].map(([k, v]) => (
            <div key={k}><dt className="text-xs text-muted-foreground">{k}</dt><dd className="mt-0.5 font-semibold tabular">{v}</dd></div>
          ))}
        </dl>
        <div className="mt-6">
          <div className="mb-1 flex items-center justify-between"><h2 className="text-sm font-semibold">Friends</h2><Link to="/leaderboards/$id" params={{ id }} className="flex items-center gap-1 text-sm text-muted-foreground"><Trophy className="size-4" />Leaderboard</Link></div>
          <LeaderboardList friends limit={3} />
        </div>
        <div className="mt-auto space-y-2 pt-8">
          <Button asChild variant="play" size="xl" className="w-full"><Link to="/play/$id" params={{ id }}><RotateCcw />One more</Link></Button>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" size="lg" onClick={() => setShare(true)}><Share2 />Share score</Button>
            <Button asChild variant="secondary" size="lg"><Link to="/games/$id" params={{ id: next.id }}>Next game<ArrowRight /></Link></Button>
          </div>
          <Link to="/games/$id" params={{ id: next.id }} className="press mt-3 flex items-center gap-3 rounded-xl border border-border p-2">
            <span className="relative block size-12 shrink-0 overflow-hidden rounded-lg"><GameArt id={next.id} className="absolute top-0 left-0 size-40 origin-top-left scale-[0.3]" /></span>
            <span className="text-sm"><span className="block text-xs text-muted-foreground">Up next</span>{next.title}</span>
          </Link>
        </div>
      </div>
      <ShareSheet open={share} onOpenChange={setShare} title={`my ${fmt(score)} on ${g.title}`} />
    </div>
  );
}
