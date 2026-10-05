import { createFileRoute, Link } from "@tanstack/react-router";
import { Clock, Search as SearchIcon, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Avatar, EmptyState, FollowButton, ListSkeleton, Page, UserName } from "@/components/common";
import { GameRow } from "@/components/game/GameCard";
import { Label } from "@/components/ui/label";
import { games, users } from "@/lib/mock";
import { seo } from "@/lib/seo";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/search")({
  head: () => seo("Search", "Search games, creators and players."),
  component: SearchPage,
});

function SearchPage() {
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"top" | "games" | "people">("top");
  const [loading, setLoading] = useState(false);
  const [recent, setRecent] = useState(["stack 10", "memory", "nora.k"]);

  useEffect(() => {
    if (!q) return;
    setLoading(true);
    const t = setTimeout(() => setLoading(false), 350);
    return () => clearTimeout(t);
  }, [q]);

  const term = q.toLowerCase();
  const g = games.filter((x) => x.title.toLowerCase().includes(term) || x.category.toLowerCase().includes(term));
  const u = users.filter((x) => x.username.includes(term) || x.name.toLowerCase().includes(term));

  return (
    <Page>
      <div className="sticky top-0 z-30 bg-background/90 px-4 pt-3 pb-2 backdrop-blur-xl md:static md:px-0 md:pt-8">
        <Label htmlFor="q" className="sr-only">Search</Label>
        <div className="relative">
          <SearchIcon className="absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <input id="q" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search games and people" className="h-11 w-full rounded-xl bg-surface pr-10 pl-10 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          {q && <button aria-label="Clear search" onClick={() => setQ("")} className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground"><X className="size-4" /></button>}
        </div>
        {q && (
          <div className="mt-3 flex gap-5 border-b border-border text-sm" role="tablist">
            {(["top", "games", "people"] as const).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cn("-mb-px border-b-2 pb-2 capitalize", tab === t ? "border-foreground font-medium" : "border-transparent text-muted-foreground")}>{t}</button>
            ))}
          </div>
        )}
      </div>

      {!q && (
        <div className="px-4 md:px-0">
          <div className="mt-4 flex items-center justify-between"><h2 className="text-sm font-semibold">Recent</h2>{recent.length > 0 && <button className="text-xs text-muted-foreground" onClick={() => setRecent([])}>Clear all</button>}</div>
          {recent.length === 0 ? <p className="py-6 text-sm text-muted-foreground">No recent searches.</p> : (
            <ul className="mt-2">{recent.map((r) => (
              <li key={r} className="flex items-center gap-3 py-2.5"><Clock className="size-4 text-muted-foreground" /><button className="flex-1 text-left text-sm" onClick={() => setQ(r)}>{r}</button><button aria-label={`Remove ${r}`} onClick={() => setRecent(recent.filter((x) => x !== r))}><X className="size-4 text-muted-foreground" /></button></li>
            ))}</ul>
          )}
          <h2 className="mt-6 text-sm font-semibold">Popular searches</h2>
          <div className="mt-3 flex flex-wrap gap-2">{["daily", "puzzle", "reaction", "lumen.studio", "color merge"].map((s) => <button key={s} onClick={() => setQ(s)} className="press rounded-full bg-surface px-3.5 py-1.5 text-sm">{s}</button>)}</div>
        </div>
      )}

      {q && loading && <ListSkeleton rows={5} />}
      {q && !loading && g.length + u.length === 0 && <EmptyState icon={SearchIcon} title={`No results for "${q}"`} body="Try a different spelling or a category name." />}
      {q && !loading && (
        <div>
          {tab !== "people" && g.map((x) => <GameRow key={x.id} game={x} />)}
          {tab !== "games" && u.map((x) => (
            <div key={x.username} className="enter flex items-center gap-3 px-4 py-3 md:px-0">
              <Link to="/u/$username" params={{ username: x.username }} className="flex min-w-0 flex-1 items-center gap-3"><Avatar name={x.username} /><div className="min-w-0 text-sm"><UserName username={x.username} verified={x.verified} /><p className="truncate text-xs text-muted-foreground">{x.name}</p></div></Link>
              <FollowButton initial={x.isFollowing} />
            </div>
          ))}
        </div>
      )}
    </Page>
  );
}
