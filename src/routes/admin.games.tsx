import { createFileRoute, Link } from "@tanstack/react-router";
import { Archive, CheckCircle2, Eye, MoreHorizontal, Play, RotateCcw, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  AdminListStates,
  AdminPage,
  AdminTable,
  ConfirmDialog,
  FilterSelect,
  MobileRow,
  OffsetPager,
  PromptDialog,
  SearchField,
  SectionCard,
  StatusBadge,
  statusTone,
  Toolbar,
  useDebounced,
  type Column,
} from "@/components/admin/ui";
import { GameArt } from "@/components/game/GameArt";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
  ADMIN_LIMIT,
  asApiError,
  formatAgo,
  moderateGame,
  useAdminGames,
  type AdminGame,
  type GameStatus,
} from "@/lib/admin/api";
import { fmt } from "@/lib/format";

export const Route = createFileRoute("/admin/games")({
  head: () => ({
    meta: [{ title: "Games — admin onemore" }, { name: "robots", content: "noindex" }],
  }),
  component: GamesAdmin,
});

const statusOptions = [
  { value: "", label: "All statuses" },
  { value: "published", label: "Published" },
  { value: "review", label: "In review" },
  { value: "draft", label: "Draft" },
  { value: "rejected", label: "Rejected" },
  { value: "archived", label: "Archived" },
];

/** A decision a moderator is about to make, waiting on the dialog. */
type Pending = { game: AdminGame; status: Exclude<GameStatus, "draft"> } | null;

/**
 * The catalogue, including everything players cannot see.
 *
 * Rows are the database's, and the status shown is the stored one — this page
 * computes nothing about a game that the API did not send. A decision goes to the
 * database and is reported only after it is accepted: a failed write toasts its
 * own error and leaves the row as it was.
 */
export function GamesAdmin() {
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const term = useDebounced(q.trim());

  const games = useAdminGames({
    status: status ? (status as GameStatus) : undefined,
    q: term || undefined,
    limit: ADMIN_LIMIT,
    offset: page * ADMIN_LIMIT,
  });

  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const rows = games.status === "ready" ? games.data.items : [];
  const hasMore = games.status === "ready" ? games.data.hasMore : false;

  const decide = (game: AdminGame, next: Exclude<GameStatus, "draft">, reason?: string) => {
    setBusy(game.id);
    moderateGame(game.id, next, reason)
      .then((result) => {
        toast.success(`“${game.title}” is now ${result.status ?? next}.`);
        games.retry();
      })
      .catch((error: unknown) => toast.error(asApiError(error).message))
      .finally(() => setBusy(null));
  };

  const columns: Column<AdminGame>[] = [
    {
      key: "game",
      head: "Game",
      className: "min-w-64",
      cell: (g) => (
        <div className="flex min-w-0 items-center gap-3">
          <span className="relative block size-10 shrink-0 overflow-hidden rounded-lg border border-glass-border">
            <GameArt
              id={g.id}
              className="absolute top-0 left-0 size-36 origin-top-left scale-[0.28]"
            />
          </span>
          <span className="min-w-0">
            <Link
              to="/games/$id"
              params={{ id: g.slug }}
              className="block truncate text-sm font-medium hover:underline"
            >
              {g.title}
            </Link>
            <span className="block truncate text-xs text-muted-foreground">
              {g.slug}
              {g.categoryName ? ` · ${g.categoryName}` : ""}
            </span>
          </span>
        </div>
      ),
    },
    {
      key: "status",
      head: "Status",
      cell: (g) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <StatusBadge tone={statusTone(g.status)}>{g.status}</StatusBadge>
          {!g.playable && <StatusBadge tone="muted">no runtime</StatusBadge>}
        </span>
      ),
    },
    {
      key: "owner",
      head: "Owner",
      cell: (g) => (
        <span className="text-sm text-muted-foreground">
          {g.ownerUsername ? `@${g.ownerUsername}` : g.isOfficial ? "official" : "—"}
        </span>
      ),
    },
    {
      key: "plays",
      head: "Runs",
      className: "text-right",
      cell: (g) => <span className="font-mono text-sm tabular">{fmt(g.plays)}</span>,
    },
    {
      key: "players",
      head: "Players",
      className: "text-right",
      cell: (g) => <span className="font-mono text-sm tabular">{fmt(g.players)}</span>,
    },
    {
      key: "best",
      head: "Best score",
      className: "text-right",
      cell: (g) => (
        <span className="font-mono text-sm tabular">
          {g.bestScore === null ? "—" : fmt(g.bestScore)}
        </span>
      ),
    },
    {
      key: "updated",
      head: "Updated",
      cell: (g) => (
        <span className="text-xs text-muted-foreground">{formatAgo(g.updatedAt) ?? "—"}</span>
      ),
    },
    {
      key: "actions",
      head: "",
      className: "w-12 text-right",
      cell: (g) => <RowActions game={g} busy={busy === g.id} onDecide={setPending} />,
    },
  ];

  return (
    <AdminPage
      title="Games"
      subtitle="Every game the database holds, published or not. A decision here is written to the moderation log."
    >
      <Toolbar>
        <SearchField
          value={q}
          onChange={(value) => {
            setQ(value);
            setPage(0);
          }}
          label="Search games"
          placeholder="Search title, slug or owner"
        />
        <FilterSelect
          label="Status"
          value={status}
          onChange={(value) => {
            setStatus(value);
            setPage(0);
          }}
          options={statusOptions}
        />
      </Toolbar>

      {games.status === "error" ? (
        <SectionCard>
          <AdminListStates
            state={games.error.status === 403 ? "forbidden" : "error"}
            onRetry={games.retry}
            emptyTitle=""
            emptyBody={games.error.message}
          />
        </SectionCard>
      ) : games.status === "loading" ? (
        <AdminListStates state="loading" emptyTitle="" rows={8} />
      ) : rows.length === 0 ? (
        <SectionCard>
          <AdminListStates
            state="ready"
            emptyTitle={term || status ? "No game matches this filter" : "No games yet"}
            emptyBody={
              term || status
                ? "Clear the search or choose another status."
                : "Games appear here once the catalogue has one."
            }
          />
        </SectionCard>
      ) : (
        <>
          <AdminTable
            columns={columns}
            rows={rows}
            rowKey={(g) => g.id}
            mobileRow={(g) => (
              <MobileRow>
                <span className="relative block size-10 shrink-0 overflow-hidden rounded-lg border border-glass-border">
                  <GameArt
                    id={g.id}
                    className="absolute top-0 left-0 size-36 origin-top-left scale-[0.28]"
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{g.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {g.status} · {fmt(g.plays)} runs · {fmt(g.players)} players
                  </span>
                </span>
                <RowActions game={g} busy={busy === g.id} onDecide={setPending} />
              </MobileRow>
            )}
          />
          <OffsetPager
            page={page}
            setPage={setPage}
            perPage={ADMIN_LIMIT}
            rows={rows.length}
            hasMore={hasMore}
            label="games"
          />
        </>
      )}

      <ConfirmDialog
        open={pending?.status === "published"}
        onOpenChange={(open) => !open && setPending(null)}
        title="Publish this game?"
        description={
          pending
            ? `“${pending.game.title}” becomes visible in the catalogue and playable by everyone. The decision is recorded against your account.`
            : undefined
        }
        confirmLabel="Publish"
        onConfirm={() => {
          if (pending) decide(pending.game, "published");
          setPending(null);
        }}
      />

      <ConfirmDialog
        open={pending?.status === "review"}
        onOpenChange={(open) => !open && setPending(null)}
        title="Send back to review?"
        description={
          pending
            ? `“${pending.game.title}” leaves the public catalogue until it is published again.`
            : undefined
        }
        confirmLabel="Move to review"
        onConfirm={() => {
          if (pending) decide(pending.game, "review");
          setPending(null);
        }}
      />

      <PromptDialog
        open={pending?.status === "rejected"}
        onOpenChange={(open) => !open && setPending(null)}
        title="Reject this game"
        description={
          pending
            ? `“${pending.game.title}” will not be published. The reason is stored with the decision.`
            : undefined
        }
        label="Reason for rejection"
        placeholder="What has to change before this can be published?"
        confirmLabel="Reject"
        destructive
        onConfirm={(reason) => {
          if (pending) decide(pending.game, "rejected", reason);
          setPending(null);
        }}
      />

      <PromptDialog
        open={pending?.status === "archived"}
        onOpenChange={(open) => !open && setPending(null)}
        title="Archive this game"
        description={
          pending
            ? `“${pending.game.title}” is removed from the catalogue but its runs and scores are kept.`
            : undefined
        }
        label="Reason for archiving"
        placeholder="Why is this game being archived?"
        confirmLabel="Archive"
        destructive
        onConfirm={(reason) => {
          if (pending) decide(pending.game, "archived", reason);
          setPending(null);
        }}
      />
    </AdminPage>
  );
}

function RowActions({
  game,
  busy,
  onDecide,
}: {
  game: AdminGame;
  busy: boolean;
  onDecide: (pending: Pending) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Actions for ${game.title}`}
          disabled={busy}
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem asChild>
          <Link to="/games/$id" params={{ id: game.slug }}>
            <Eye />
            Open page
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/play/$id" params={{ id: game.slug }}>
            <Play className="fill-current" />
            Play
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {game.status !== "published" && (
          <DropdownMenuItem onClick={() => onDecide({ game, status: "published" })}>
            <CheckCircle2 />
            Publish
          </DropdownMenuItem>
        )}
        {game.status !== "review" && (
          <DropdownMenuItem onClick={() => onDecide({ game, status: "review" })}>
            <RotateCcw />
            Move to review
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => onDecide({ game, status: "rejected" })}>
          <XCircle />
          Reject
        </DropdownMenuItem>
        {game.status !== "archived" && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive"
              onClick={() => onDecide({ game, status: "archived" })}
            >
              <Archive />
              Archive
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
