import type { ReactNode } from "react";
import { EmptyState, ErrorState, GridSkeleton, Page, PageHeader } from "@/components/common";
import { GameCard } from "./GameCard";
import { Button } from "@/components/ui/button";
import { catalogErrorMessage, useGames, type GameQuery } from "@/lib/games/catalog";

/**
 * A grid of catalogue games.
 *
 * Two deliberate removals from the prototype's version:
 *
 *   - the **filter chips** ("Today", "This week", "All time") never filtered
 *     anything — they were local state with no query behind them. The API has no
 *     date window (nothing records when a game was played), so a control that
 *     looks like it filters is worse than no control.
 *   - the **preview-state switcher**, which let a developer force the loading,
 *     empty and error screens. The states are real now: they follow the request.
 */
export function GameListPage({
  title,
  subtitle,
  query,
  ranked,
  empty = { title: "Nothing here yet", body: "Check back soon — new games are added every week." },
  children,
  action,
}: {
  title: string;
  subtitle?: string;
  /** The catalogue query this page lists. Omit it when `children` supplies the body. */
  query?: GameQuery;
  ranked?: boolean;
  empty?: { title: string; body?: string };
  /** Rendered instead of a list, for a page whose data does not exist yet. */
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Page className="max-w-5xl">
      <PageHeader back title={title} subtitle={subtitle} actions={action} />
      {query ? (
        <CatalogueList query={query} ranked={ranked} empty={empty} />
      ) : (
        <div className="px-4 md:px-0">{children}</div>
      )}
    </Page>
  );
}

/** The list itself. A separate component so `useGames` is never called conditionally. */
function CatalogueList({
  query,
  ranked,
  empty,
}: {
  query: GameQuery;
  ranked?: boolean;
  empty: { title: string; body?: string };
}) {
  const { status, items, nextCursor, loadingMore, error, loadMoreError, retry, loadMore } =
    useGames(query);

  if (status === "loading") return <GridSkeleton />;

  if (status === "error") {
    return (
      <ErrorState title="Couldn't load games" body={catalogErrorMessage(error)} onRetry={retry} />
    );
  }

  if (items.length === 0) {
    return <EmptyState title={empty.title} body={empty.body} />;
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-x-3 gap-y-5 px-4 md:grid-cols-3 md:px-0 lg:grid-cols-4">
        {items.map((game, i) => (
          <GameCard key={game.slug} game={game} rank={ranked ? i + 1 : undefined} />
        ))}
      </div>
      {loadMoreError && (
        <p className="mt-4 px-4 text-sm text-destructive md:px-0">
          {catalogErrorMessage(loadMoreError)}
        </p>
      )}
      {nextCursor && (
        <div className="mt-6 flex justify-center">
          <Button variant="secondary" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
    </>
  );
}
