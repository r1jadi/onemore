import { useState } from "react";
import { EmptyState, ErrorState, GridSkeleton, Page, PageHeader, StateSwitcher, useMockLoad } from "@/components/common";
import { GameCard } from "./GameCard";
import type { Game } from "@/lib/mock";
import { cn } from "@/lib/utils";

export function GameListPage({ title, subtitle, items, filters = ["Today", "This week", "All time"], ranked }: { title: string; subtitle?: string; items: Game[]; filters?: string[]; ranked?: boolean }) {
  const loading = useMockLoad();
  const [filter, setFilter] = useState(filters[0]);
  const [state, setState] = useState("ready");
  const s = loading ? "loading" : state;
  return (
    <Page className="max-w-5xl">
      <PageHeader back title={title} subtitle={subtitle} actions={<div className="hidden md:block"><StateSwitcher value={state} onChange={setState} /></div>} />
      <div className="no-scrollbar mb-4 flex gap-2 overflow-x-auto px-4 md:px-0" role="tablist">
        {filters.map((f) => (
          <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)} className={cn("press shrink-0 rounded-full px-3.5 py-1.5 text-sm", filter === f ? "bg-foreground text-background font-medium" : "bg-surface text-muted-foreground")}>{f}</button>
        ))}
      </div>
      {s === "loading" && <GridSkeleton />}
      {s === "error" && <ErrorState onRetry={() => setState("ready")} />}
      {s === "empty" && <EmptyState title="Nothing here yet" body="Check back soon — new games are added every week." />}
      {s === "ready" && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-5 px-4 md:grid-cols-3 md:px-0 lg:grid-cols-4">
          {items.map((g, i) => <GameCard key={g.id} game={g} rank={ranked ? i + 1 : undefined} />)}
        </div>
      )}
    </Page>
  );
}
