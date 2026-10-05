import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, Eye, Play, Star, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { AdminPage, SectionCard, StatusBadge } from "@/components/admin/ui";
import { ErrorState, ListSkeleton, StateSwitcher, useMockLoad } from "@/components/common";
import { GameArt } from "@/components/game/GameArt";
import { Button } from "@/components/ui/button";
import { featureableGames, featuredGames, type FeaturedSlot } from "@/lib/admin-mock";
import { fmt } from "@/lib/mock";

export const Route = createFileRoute("/admin/featured")({
  head: () => ({
    meta: [{ title: "Featured games — admin onemore" }, { name: "robots", content: "noindex" }],
  }),
  component: FeaturedAdmin,
});

const MAX_SLOTS = 6;

function FeaturedAdmin() {
  const loading = useMockLoad(500);
  const [slots, setSlots] = useState<FeaturedSlot[]>(featuredGames);
  const [state, setState] = useState("ready");
  const s = loading ? "loading" : state;
  const available = featureableGames.filter((g) => !slots.some((slot) => slot.id === g.id));

  const move = (index: number, dir: -1 | 1) => {
    const next = [...slots];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setSlots(next.map((slot, i) => ({ ...slot, rank: i + 1 })));
    toast.success(`Moved to slot ${target + 1}`);
  };

  const unfeature = (slot: FeaturedSlot) => {
    setSlots((list) => list.filter((x) => x.id !== slot.id).map((x, i) => ({ ...x, rank: i + 1 })));
    toast.success(`${slot.title} removed from featured`);
  };

  const feature = (id: string) => {
    if (slots.length >= MAX_SLOTS) {
      toast.error("All featured slots are in use");
      return;
    }
    const game = featureableGames.find((g) => g.id === id);
    if (!game) return;
    setSlots((list) => [
      ...list,
      {
        id: game.id,
        title: game.title,
        creator: game.creator,
        plays: game.plays,
        rank: list.length + 1,
      },
    ]);
    toast.success(`${game.title} featured`);
  };

  return (
    <AdminPage
      title="Featured games"
      subtitle={`${slots.length} of ${MAX_SLOTS} featured slots in use. Order decides what shows first in the feed and Explore.`}
      actions={
        <div className="hidden md:block">
          <StateSwitcher value={state} onChange={setState} />
        </div>
      }
    >
      {s === "error" ? (
        <ErrorState onRetry={() => setState("ready")} />
      ) : s === "loading" ? (
        <ListSkeleton rows={5} />
      ) : (
        <div className="space-y-4 md:space-y-5">
          <SectionCard
            title="Featured lineup"
            action={
              <StatusBadge tone={slots.length >= MAX_SLOTS ? "warning" : "muted"}>
                {slots.length}/{MAX_SLOTS} slots
              </StatusBadge>
            }
            bodyClassName="p-0"
          >
            {slots.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                Nothing is featured right now. Add a game below to show it first.
              </p>
            ) : (
              <ol className="divide-y divide-border">
                {slots.map((slot, i) => (
                  <li key={slot.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <span className="w-6 shrink-0 text-center font-mono text-sm font-semibold tabular">
                      {i + 1}
                    </span>
                    <span className="relative block size-14 shrink-0 overflow-hidden rounded-lg border border-glass-border">
                      <GameArt
                        id={slot.id}
                        className="absolute top-0 left-0 size-40 origin-top-left scale-[0.35]"
                      />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                        <span className="truncate">{slot.title}</span>
                        {i === 0 && (
                          <Star
                            className="size-3.5 shrink-0 fill-primary text-primary"
                            aria-label="Headline slot"
                          />
                        )}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        @{slot.creator} · {fmt(slot.plays)} plays{i === 0 ? " · headline slot" : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Move ${slot.title} up`}
                        disabled={i === 0}
                        onClick={() => move(i, -1)}
                      >
                        <ArrowUp />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Move ${slot.title} down`}
                        disabled={i === slots.length - 1}
                        onClick={() => move(i, 1)}
                      >
                        <ArrowDown />
                      </Button>
                    </div>
                    <Button asChild variant="secondary" size="sm">
                      <Link to="/games/$id" params={{ id: slot.id }}>
                        <Eye />
                        Preview
                      </Link>
                    </Button>
                    <Button asChild variant="play" size="sm">
                      <Link to="/play/$id" params={{ id: slot.id }}>
                        <Play className="fill-current" />
                        Play
                      </Link>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${slot.title} from featured`}
                      onClick={() => unfeature(slot)}
                    >
                      <X />
                    </Button>
                  </li>
                ))}
              </ol>
            )}
          </SectionCard>

          <SectionCard title="Available to feature" bodyClassName="p-4">
            {available.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Every live game is already featured.
              </p>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {available.map((g) => (
                  <li
                    key={g.id}
                    className="flex items-center gap-3 rounded-xl border border-border p-3"
                  >
                    <span className="relative block size-12 shrink-0 overflow-hidden rounded-lg border border-glass-border">
                      <GameArt
                        id={g.id}
                        className="absolute top-0 left-0 size-36 origin-top-left scale-[0.34]"
                      />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{g.title}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {g.category} · {fmt(g.plays)} plays
                      </p>
                    </div>
                    <Button size="sm" variant="secondary" onClick={() => feature(g.id)}>
                      <Star />
                      Feature
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-4 text-xs text-muted-foreground">
              Featured games appear in the For You feed for new players and at the top of Explore.
            </p>
          </SectionCard>
        </div>
      )}
    </AdminPage>
  );
}
