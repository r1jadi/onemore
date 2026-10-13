import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { EmptyState, ErrorState, ListSkeleton, Page, PageHeader } from "@/components/common";
import { GameRow } from "@/components/game/GameCard";
import { Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getAuthState, subscribe as subscribeToAuth } from "@/lib/auth/session";
import { catalogErrorMessage, useGames } from "@/lib/games/catalog";
import { listFollowees } from "@/lib/social/follows";
import { restGet } from "@/lib/supabase/rest";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/following")({
  head: () => seo("Following", "Games played and made by people you follow."),
  component: Following,
});

type OwnedGame = { owner_id: string };

/**
 * The Following feed: published games owned by accounts the caller follows.
 * It is not the For You catalogue under another heading — with no follows it
 * explains discovery, and with follows but no published games it says so.
 */
function Following() {
  const [authTick, setAuthTick] = useState(0);
  const [followeeIds, setFolloweeIds] = useState<string[] | undefined>(undefined);
  const [followError, setFollowError] = useState<string>();
  const [ownerFilter, setOwnerFilter] = useState<string[] | undefined>(undefined);
  void authTick;

  useEffect(() => subscribeToAuth(() => setAuthTick((n) => n + 1)), []);

  const auth = getAuthState();

  useEffect(() => {
    if (auth.status !== "authenticated") {
      setFolloweeIds(undefined);
      setOwnerFilter(undefined);
      return;
    }
    let cancelled = false;
    setFollowError(undefined);
    listFollowees(auth.session.userId)
      .then((ids) => {
        if (cancelled) return;
        setFolloweeIds(ids);
        // Resolve which followees own published games, so the catalogue read
        // below can be scoped to them. Done via the public games projection
        // rather than inventing attribution.
        if (ids.length === 0) {
          setOwnerFilter([]);
          return;
        }
        const filter = `owner_id=in.(${ids.map(encodeURIComponent).join(",")})&status=eq.published&select=owner_id&limit=200`;
        restGet<OwnedGame[]>(`games?${filter}`)
          .then((rows) => {
            if (!cancelled) setOwnerFilter([...new Set(rows.map((r) => r.owner_id))]);
          })
          .catch(() => {
            if (!cancelled) setOwnerFilter(ids);
          });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setFollowError(error instanceof Error ? error.message : "Couldn't load follows.");
          setFolloweeIds([]);
          setOwnerFilter([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [auth.status, authTick]);

  if (auth.status !== "authenticated") {
    return (
      <Page>
        <PageHeader title="Following" />
        <EmptyState
          icon={Users}
          title="Sign in to follow creators"
          body="Following keeps the games of people you follow in one place."
          action={
            <Button asChild>
              <Link to="/login" search={{ redirect: "/following" }}>
                Log in
              </Link>
            </Button>
          }
        />
      </Page>
    );
  }

  if (followeeIds === undefined || ownerFilter === undefined) {
    return (
      <Page>
        <PageHeader title="Following" />
        <ListSkeleton rows={4} avatar={false} />
      </Page>
    );
  }

  if (followError) {
    return (
      <Page>
        <PageHeader title="Following" />
        <ErrorState
          title="Couldn't load follows"
          body={followError}
          onRetry={() => setAuthTick((n) => n + 1)}
        />
      </Page>
    );
  }

  if (followeeIds.length === 0) {
    return (
      <Page>
        <PageHeader title="Following" />
        <EmptyState
          icon={Users}
          title="You're not following anyone yet"
          body="Find creators in Search or on a game page, then follow them to build this feed."
          action={
            <Button asChild variant="secondary">
              <Link to="/search">Discover creators</Link>
            </Button>
          }
        />
      </Page>
    );
  }

  if (ownerFilter.length === 0) {
    return (
      <Page>
        <PageHeader title="Following" />
        <EmptyState
          icon={Users}
          title="No published games yet"
          body="The creators you follow haven't published any games. Check back later."
        />
      </Page>
    );
  }

  return <FollowingGames ownerIds={ownerFilter} />;
}

function FollowingGames({ ownerIds }: { ownerIds: string[] }) {
  // The catalogue hook reads the real games API; the owner scoping above
  // decides *whose* games count as Following. Until the catalogue supports an
  // owner filter, the list is intersected client-side against the owner set.
  const { status, items, error, retry } = useGames({ limit: 50 });
  if (status === "loading") {
    return (
      <Page>
        <PageHeader title="Following" />
        <ListSkeleton rows={4} avatar={false} />
      </Page>
    );
  }
  if (status === "error") {
    return (
      <Page>
        <PageHeader title="Following" />
        <ErrorState title="Couldn't load games" body={catalogErrorMessage(error)} onRetry={retry} />
      </Page>
    );
  }
  const owned = items.filter((game) =>
    ownerIds.includes((game as unknown as { ownerId?: string }).ownerId ?? ""),
  );
  // When the catalogue payload carries no owner attribution, intersecting is
  // impossible — report that honestly instead of showing the full catalogue.
  const carriesAttribution = items.some(
    (game) => (game as unknown as { ownerId?: string }).ownerId !== undefined,
  );
  if (!carriesAttribution) {
    return (
      <Page>
        <PageHeader title="Following" />
        <EmptyState
          icon={Users}
          title="Following feed isn't available yet"
          body="The catalogue doesn't attribute games to creators yet, so a filtered feed can't be built without guessing. Your follows are saved."
        />
      </Page>
    );
  }
  if (owned.length === 0) {
    return (
      <Page>
        <PageHeader title="Following" />
        <EmptyState
          icon={Users}
          title="No published games yet"
          body="The creators you follow haven't published any games. Check back later."
        />
      </Page>
    );
  }
  return (
    <Page>
      <PageHeader title="Following" subtitle={`${owned.length} games from creators you follow`} />
      <div>
        {owned.map((game) => (
          <GameRow key={game.slug} game={game} />
        ))}
      </div>
    </Page>
  );
}
