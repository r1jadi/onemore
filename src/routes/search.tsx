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
import { listBlockedIds } from "@/lib/settings/blocked";
import {
  fetchProfilesByIds,
  listFollowees,
  searchProfiles,
  type PublicProfile,
} from "@/lib/social/follows";
import { getAuthState } from "@/lib/auth/session";
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

const RECENT_KEY = "onemore-recent-searches";

function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string").slice(0, 8)
      : [];
  } catch {
    return [];
  }
}

function writeRecent(entries: string[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(entries.slice(0, 8)));
  } catch {
    // Best effort.
  }
}

function SearchPage() {
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"top" | "games" | "people">("top");
  const [recent, setRecent] = useState<string[]>(() =>
    typeof window === "undefined" ? [] : readRecent(),
  );
  const term = useDebounced(q.trim());

  function remember(value: string) {
    const next = [value, ...recent.filter((x) => x !== value)].slice(0, 8);
    setRecent(next);
    writeRecent(next);
  }

  function clearRecent() {
    setRecent([]);
    writeRecent([]);
  }

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
            onKeyDown={(e) => {
              if (e.key === "Enter" && q.trim() !== "") remember(q.trim());
            }}
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
              <button className="text-xs text-muted-foreground" onClick={clearRecent}>
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
                    onClick={() => {
                      const next = recent.filter((x) => x !== r);
                      setRecent(next);
                      writeRecent(next);
                    }}
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
      {q && tab !== "games" && <PeopleResults query={term} only={tab === "people"} />}
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

/**
 * People results from the public profile projection. Blocked accounts are
 * filtered out, and follow state comes from the real follow graph.
 */
function PeopleResults({ query, only }: { query: string; only: boolean }) {
  const [people, setPeople] = useState<PublicProfile[] | undefined>(undefined);
  const [followingIds, setFollowingIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (query.trim() === "") {
      setPeople([]);
      return;
    }
    let cancelled = false;
    setError(undefined);
    searchProfiles(query, 8)
      .then(async (rows) => {
        if (cancelled) return;
        const blocked = await listBlockedIds();
        const visible = rows.filter((row) => !blocked.has(row.id));
        if (!cancelled) setPeople(visible);
        const auth = getAuthState();
        if (!cancelled && auth.status === "authenticated") {
          try {
            const followees = await listFollowees(auth.session.userId);
            if (!cancelled) setFollowingIds(new Set(followees));
          } catch {
            // Follow state is best effort; the rows are still real.
          }
        }
        // Prefetch display names for followees is unnecessary: rows carry them.
        void fetchProfilesByIds;
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Couldn't search people.");
          setPeople([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [query]);

  if (people === undefined) return <ListSkeleton rows={3} />;
  if (error) {
    return (
      <ErrorState
        title="Couldn't search people"
        body={error}
        onRetry={() => setPeople(undefined)}
      />
    );
  }
  if (people.length === 0) {
    if (!only) return null;
    return (
      <EmptyState
        icon={SearchIcon}
        title={`No people for "${query}"`}
        body="Try a different spelling."
      />
    );
  }
  return (
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
              <UserName username={x.username} />
              <p className="truncate text-xs text-muted-foreground">{x.display_name}</p>
            </div>
          </Link>
          <FollowButton userId={x.id} initial={followingIds.has(x.id)} />
        </div>
      ))}
    </div>
  );
}
