import { createFileRoute, Link } from "@tanstack/react-router";
import { Clock, Search as SearchIcon, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Avatar,
  EmptyState,
  ErrorState,
  FollowButton,
  ListSkeleton,
  Page,
  UserName,
} from "@/components/common";
import { GameRow } from "@/components/game/GameCard";
import { Label } from "@/components/ui/label";
import { catalogErrorMessage, useGames } from "@/lib/games/catalog";
import { users } from "@/lib/mock";
import { seo } from "@/lib/seo";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/search")({
  head: () => seo("Search", "Search games, creators and players."),
  component: SearchPage,
});

/** Delays a value until typing settles, so a search box is one request, not one per key. */
function useDebounced<T>(value: T, ms = 250): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

function SearchPage() {
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"top" | "games" | "people">("top");
  const [recent, setRecent] = useState(["stack 10", "memory", "nora.k"]);
  const term = useDebounced(q.trim());
  const people = users.filter(
    (u) =>
      u.username.includes(q.trim().toLowerCase()) ||
      u.name.toLowerCase().includes(q.trim().toLowerCase()),
  );

  return (
    <Page>
      <div className="sticky top-0 z-30 bg-background/90 px-4 pt-3 pb-2 backdrop-blur-xl md:static md:px-0 md:pt-8">
        <Label htmlFor="q" className="sr-only">
          Search
        </Label>
        <div className="relative">
          <SearchIcon className="absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            id="q"
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search games and people"
            className="h-11 w-full rounded-xl bg-surface pr-10 pl-10 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {q && (
            <button
              aria-label="Clear search"
              onClick={() => setQ("")}
              className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
        {q && (
          <div className="mt-3 flex gap-5 border-b border-border text-sm" role="tablist">
            {(["top", "games", "people"] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={cn(
                  "-mb-px border-b-2 pb-2 capitalize",
                  tab === t
                    ? "border-foreground font-medium"
                    : "border-transparent text-muted-foreground",
                )}
              >
                {t}
              </button>
            ))}
          </div>
        )}
      </div>

      {!q && (
        <div className="px-4 md:px-0">
          <div className="mt-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Recent</h2>
            {recent.length > 0 && (
              <button className="text-xs text-muted-foreground" onClick={() => setRecent([])}>
                Clear all
              </button>
            )}
          </div>
          {recent.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">No recent searches.</p>
          ) : (
            <ul className="mt-2">
              {recent.map((r) => (
                <li key={r} className="flex items-center gap-3 py-2.5">
                  <Clock className="size-4 text-muted-foreground" />
                  <button className="flex-1 text-left text-sm" onClick={() => setQ(r)}>
                    {r}
                  </button>
                  <button
                    aria-label={`Remove ${r}`}
                    onClick={() => setRecent(recent.filter((x) => x !== r))}
                  >
                    <X className="size-4 text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <h2 className="mt-6 text-sm font-semibold">Popular searches</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {["daily", "puzzle", "reaction", "color merge"].map((s) => (
              <button
                key={s}
                onClick={() => setQ(s)}
                className="press rounded-full bg-surface px-3.5 py-1.5 text-sm"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {q && tab !== "people" && <GameResults term={term} />}
      {q &&
        tab !== "games" &&
        (people.length === 0 ? (
          tab === "people" ? (
            <EmptyState
              icon={SearchIcon}
              title={`No people for "${q}"`}
              body="Try a different spelling."
            />
          ) : null
        ) : (
          <div>
            {people.map((x) => (
              <div key={x.username} className="enter flex items-center gap-3 px-4 py-3 md:px-0">
                <Link
                  to="/u/$username"
                  params={{ username: x.username }}
                  className="flex min-w-0 flex-1 items-center gap-3"
                >
                  <Avatar name={x.username} />
                  <div className="min-w-0 text-sm">
                    <UserName username={x.username} verified={x.verified} />
                    <p className="truncate text-xs text-muted-foreground">{x.name}</p>
                  </div>
                </Link>
                <FollowButton initial={x.isFollowing} />
              </div>
            ))}
          </div>
        ))}
    </Page>
  );
}

/**
 * Game results from the catalogue.
 *
 * It is mounted only once there is a term, so an empty search box never causes a
 * request for the whole catalogue. There is no fallback list: a failed search
 * offers a retry, not a different set of games under the visitor's query.
 */
function GameResults({ term }: { term: string }) {
  const { status, items, error, retry } = useGames({ q: term });

  if (status === "loading") return <ListSkeleton rows={5} />;
  if (status === "error") {
    return (
      <ErrorState title="Couldn't search games" body={catalogErrorMessage(error)} onRetry={retry} />
    );
  }
  if (items.length === 0) {
    return (
      <EmptyState
        icon={SearchIcon}
        title={`No games for "${term}"`}
        body="Try a different spelling or a category name."
      />
    );
  }
  return (
    <div>
      {items.map((game) => (
        <GameRow key={game.slug} game={game} />
      ))}
    </div>
  );
}
