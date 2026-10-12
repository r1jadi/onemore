import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, Eye, MoreHorizontal, Play, Star, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AdminListStates,
  AdminPage,
  AdminTable,
  ConfirmDialog,
  FilterSelect,
  MetaRow,
  MobileRow,
  Pager,
  SearchField,
  StatusBadge,
  statusTone,
  Toolbar,
  usePaged,
  type Column,
} from "@/components/admin/ui";
import { Avatar, ErrorState, ListSkeleton, StateSwitcher, useMockLoad } from "@/components/common";
import { GameArt } from "@/components/game/GameArt";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { featuredGames } from "@/lib/admin-mock";
import { fmt } from "@/lib/format";
import { games, type Game, type GameId } from "@/lib/admin-mock";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/games")({
  head: () => ({
    meta: [{ title: "Games — admin onemore" }, { name: "robots", content: "noindex" }],
  }),
  component: GamesAdmin,
});

type Status = "published" | "review" | "draft" | "rejected";

type CatalogRow = {
  key: string;
  gameId: GameId;
  title: string;
  tagline: string;
  creator: string;
  category: string;
  plays: number;
  likes: number;
  comments: number;
  saves: number;
  bestScore: number;
  status: Status;
  featured: boolean;
  version: string;
  updated: string;
  reports: number;
};

const updates = ["2h ago", "5h ago", "1d ago", "1d ago", "2d ago", "3d ago", "8h ago"];

const fromGame = (g: Game, i: number): CatalogRow => ({
  key: g.id,
  gameId: g.id,
  title: g.title,
  tagline: g.tagline,
  creator: g.creator,
  category: g.category,
  plays: g.plays,
  likes: g.likes,
  comments: g.comments,
  saves: g.saves,
  bestScore: g.bestScore,
  status: "published",
  featured: featuredGames.some((f) => f.id === g.id),
  version: ["1.4.2", "2.1.0", "3.0.1", "1.0.3", "1.2.0", "1.5.1", "1.1.0"][i] ?? "1.0.0",
  updated: updates[i] ?? "1d ago",
  reports: [0, 0, 0, 1, 0, 0, 0][i] ?? 0,
});

const catalogSeed: CatalogRow[] = [
  ...games.map(fromGame),
  {
    key: "chain-hard",
    gameId: "dont-break-the-chain",
    title: "Chain: Hard Mode",
    tagline: "25 links. No mistakes.",
    creator: "linkhouse",
    category: "Reaction",
    plays: 0,
    likes: 0,
    comments: 0,
    saves: 0,
    bestScore: 0,
    status: "review",
    featured: false,
    version: "1.3.0",
    updated: "2d ago",
    reports: 0,
  },
  {
    key: "black-daily",
    gameId: "dont-touch-the-black",
    title: "Black: Daily ladder",
    tagline: "One ladder, refreshed daily.",
    creator: "monochrome",
    category: "Arcade",
    plays: 0,
    likes: 0,
    comments: 0,
    saves: 0,
    bestScore: 0,
    status: "review",
    featured: false,
    version: "3.1.0",
    updated: "3d ago",
    reports: 0,
  },
  {
    key: "stack-blitz",
    gameId: "stack-10",
    title: "Stack 10 — Blitz",
    tagline: "Half the time, double the pressure.",
    creator: "lumen.studio",
    category: "Puzzle",
    plays: 0,
    likes: 0,
    comments: 0,
    saves: 0,
    bestScore: 0,
    status: "draft",
    featured: false,
    version: "0.4.0",
    updated: "4d ago",
    reports: 0,
  },
  {
    key: "color-zen",
    gameId: "color-merge",
    title: "Color Merge — Zen",
    tagline: "No timer, endless board.",
    creator: "tilework",
    category: "Puzzle",
    plays: 0,
    likes: 0,
    comments: 0,
    saves: 0,
    bestScore: 0,
    status: "draft",
    featured: false,
    version: "0.2.1",
    updated: "5d ago",
    reports: 0,
  },
  {
    key: "memory-endless",
    gameId: "memory-flash",
    title: "Memory Flash — Endless",
    tagline: "A rising difficulty curve.",
    creator: "lumen.studio",
    category: "Memory",
    plays: 0,
    likes: 0,
    comments: 0,
    saves: 0,
    bestScore: 0,
    status: "rejected",
    featured: false,
    version: "1.6.0",
    updated: "6d ago",
    reports: 2,
  },
];

function GamesAdmin() {
  const loading = useMockLoad(500);
  const [rows, setRows] = useState(catalogSeed);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [category, setCategory] = useState("all");
  const [state, setState] = useState("ready");
  const [detail, setDetail] = useState<CatalogRow | null>(null);
  const [confirm, setConfirm] = useState<{ row: CatalogRow; kind: "unpublish" | "remove" } | null>(
    null,
  );

  const categories = useMemo(
    () => Array.from(new Set(catalogSeed.map((r) => r.category))).sort(),
    [],
  );

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      const hit =
        !term ||
        r.title.toLowerCase().includes(term) ||
        r.creator.toLowerCase().includes(term) ||
        r.category.toLowerCase().includes(term);
      return (
        hit &&
        (status === "all" || r.status === status) &&
        (category === "all" || r.category === category)
      );
    });
  }, [rows, q, status, category]);

  const { page, setPage, pages, slice, total, perPage } = usePaged(filtered, 8);
  const s = loading ? "loading" : state;

  const patch = (key: string, next: Partial<CatalogRow>, message: string) => {
    setRows((list) => list.map((r) => (r.key === key ? { ...r, ...next } : r)));
    setDetail((d) => (d && d.key === key ? { ...d, ...next } : d));
    if (message) toast.success(message);
  };

  const toggleFeature = (row: CatalogRow) =>
    patch(
      row.key,
      { featured: !row.featured },
      row.featured ? `${row.title} removed from featured` : `${row.title} added to featured`,
    );

  const columns: Column<CatalogRow>[] = [
    {
      key: "game",
      head: "Game",
      cell: (r) => (
        <div className="flex min-w-0 items-center gap-3">
          <span className="relative block size-10 shrink-0 overflow-hidden rounded-lg border border-glass-border">
            <GameArt
              id={r.gameId}
              className="absolute top-0 left-0 size-32 origin-top-left scale-[0.3]"
            />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{r.title}</p>
            <p className="truncate text-xs text-muted-foreground">{r.tagline}</p>
          </div>
        </div>
      ),
    },
    {
      key: "creator",
      head: "Creator",
      cell: (r) => <span className="text-sm text-muted-foreground">@{r.creator}</span>,
    },
    {
      key: "category",
      head: "Category",
      className: "hidden xl:table-cell",
      cell: (r) => (
        <span className="rounded-md bg-surface-2 px-2 py-0.5 text-xs">{r.category}</span>
      ),
    },
    {
      key: "plays",
      head: "Plays",
      className: "text-right",
      cell: (r) => <span className="font-mono text-sm tabular">{fmt(r.plays)}</span>,
    },
    {
      key: "likes",
      head: "Likes",
      className: "hidden 2xl:table-cell text-right",
      cell: (r) => <span className="font-mono text-sm tabular">{fmt(r.likes)}</span>,
    },
    {
      key: "status",
      head: "Status",
      cell: (r) => <StatusBadge tone={statusTone(r.status)}>{r.status}</StatusBadge>,
    },
    {
      key: "featured",
      head: "Featured",
      cell: (r) => (
        <Button
          variant="ghost"
          size="icon"
          aria-label={r.featured ? `Unfeature ${r.title}` : `Feature ${r.title}`}
          aria-pressed={r.featured}
          disabled={r.status !== "published"}
          onClick={(e) => {
            e.stopPropagation();
            toggleFeature(r);
          }}
        >
          <Star className={cn("size-4", r.featured && "fill-primary text-primary")} />
        </Button>
      ),
    },
    {
      key: "updated",
      head: "Updated",
      className: "hidden 2xl:table-cell",
      cell: (r) => <span className="text-xs text-muted-foreground">{r.updated}</span>,
    },
    {
      key: "actions",
      head: <span className="sr-only">Actions</span>,
      className: "w-12 text-right",
      cell: (r) => (
        <div onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={`Actions for ${r.title}`}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setDetail(r)}>View details</DropdownMenuItem>
              <DropdownMenuItem
                disabled={r.status !== "published"}
                asChild={r.status === "published"}
              >
                {r.status === "published" ? (
                  <Link to="/games/$id" params={{ id: r.gameId }}>
                    <Eye />
                    Open public page
                  </Link>
                ) : (
                  <span>
                    <Eye />
                    Preview (unpublished)
                  </span>
                )}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {r.status === "published" ? (
                <DropdownMenuItem onClick={() => setConfirm({ row: r, kind: "unpublish" })}>
                  <Upload />
                  Unpublish
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  onClick={() =>
                    patch(
                      r.key,
                      { status: "published", updated: "just now" },
                      `${r.title} published`,
                    )
                  }
                >
                  <Upload />
                  Publish
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => setConfirm({ row: r, kind: "remove" })}
              >
                Remove from catalog
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ];

  return (
    <AdminPage
      title="Games"
      subtitle={`${total} games in the catalog. Publish, feature and preview games.`}
      actions={
        <div className="hidden md:block">
          <StateSwitcher value={state} onChange={setState} />
        </div>
      }
    >
      <Toolbar>
        <SearchField
          value={q}
          onChange={(v) => {
            setQ(v);
            setPage(1);
          }}
          placeholder="Search title, creator or category"
          label="Search games"
        />
        <FilterSelect
          label="Game status"
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          options={[
            { value: "all", label: "All statuses" },
            { value: "published", label: "Published" },
            { value: "review", label: "In review" },
            { value: "draft", label: "Draft" },
            { value: "rejected", label: "Rejected" },
          ]}
        />
        <FilterSelect
          label="Game category"
          value={category}
          onChange={(v) => {
            setCategory(v);
            setPage(1);
          }}
          options={[
            { value: "all", label: "All categories" },
            ...categories.map((c) => ({ value: c, label: c })),
          ]}
        />
      </Toolbar>

      {s === "loading" ? (
        <ListSkeleton rows={8} />
      ) : s === "error" ? (
        <ErrorState onRetry={() => setState("ready")} />
      ) : s === "empty" || filtered.length === 0 ? (
        <AdminListStates
          state="empty"
          emptyTitle="No games match"
          emptyBody="Try a different search term or clear the filters."
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setQ("");
                setStatus("all");
                setCategory("all");
              }}
            >
              Clear filters
            </Button>
          }
        />
      ) : (
        <>
          <AdminTable
            columns={columns}
            rows={slice}
            rowKey={(r) => r.key}
            onRow={(r) => setDetail(r)}
            mobileRow={(r) => (
              <MobileRow ariaLabel={`Open ${r.title}`} onClick={() => setDetail(r)}>
                <span className="relative block size-11 shrink-0 overflow-hidden rounded-lg border border-glass-border">
                  <GameArt
                    id={r.gameId}
                    className="absolute top-0 left-0 size-32 origin-top-left scale-[0.34]"
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                    <span className="truncate">{r.title}</span>
                    {r.featured && <Star className="size-3.5 shrink-0 fill-primary text-primary" />}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {r.category} · {fmt(r.plays)} plays · {r.updated}
                  </p>
                </div>
                <StatusBadge tone={statusTone(r.status)}>{r.status}</StatusBadge>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </MobileRow>
            )}
          />
          <Pager
            page={page}
            pages={pages}
            setPage={setPage}
            total={total}
            perPage={perPage}
            label="games"
          />
        </>
      )}

      {/* Game details */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-h-[88dvh] max-w-lg overflow-y-auto">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {detail.title}
                  {detail.featured && <Star className="size-4 fill-primary text-primary" />}
                </DialogTitle>
                <DialogDescription>{detail.tagline}</DialogDescription>
              </DialogHeader>
              <div className="overflow-hidden rounded-xl border border-glass-border">
                <GameArt id={detail.gameId} className="aspect-[16/9] w-full" />
              </div>
              <dl className="divide-y divide-border rounded-xl border border-border bg-surface px-4 py-1">
                <MetaRow label="Status">
                  <StatusBadge tone={statusTone(detail.status)}>{detail.status}</StatusBadge>
                </MetaRow>
                <MetaRow label="Creator">
                  <span className="inline-flex items-center gap-2">
                    <Avatar name={detail.creator} size="sm" className="size-6 text-[10px]" />@
                    {detail.creator}
                  </span>
                </MetaRow>
                <MetaRow label="Category">{detail.category}</MetaRow>
                <MetaRow label="Version">
                  <span className="font-mono tabular">{detail.version}</span>
                </MetaRow>
                <MetaRow label="Last updated">{detail.updated}</MetaRow>
                <MetaRow label="Plays / likes">
                  {fmt(detail.plays)} · {fmt(detail.likes)}
                </MetaRow>
                <MetaRow label="Comments / saves">
                  {fmt(detail.comments)} · {fmt(detail.saves)}
                </MetaRow>
                <MetaRow label="Open reports">
                  {detail.reports === 0 ? "None" : detail.reports}
                </MetaRow>
              </dl>
              <div className="flex flex-wrap gap-2">
                {detail.status === "published" ? (
                  <>
                    <Button asChild variant="secondary" size="sm">
                      <Link to="/games/$id" params={{ id: detail.gameId }}>
                        <Play className="fill-current" />
                        Open public page
                      </Link>
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => toggleFeature(detail)}>
                      <Star className={cn(detail.featured && "fill-primary text-primary")} />
                      {detail.featured ? "Unfeature" : "Feature"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirm({ row: detail, kind: "unpublish" })}
                    >
                      <Upload />
                      Unpublish
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        patch(
                          detail.key,
                          { status: "published", updated: "just now" },
                          `${detail.title} published`,
                        )
                      }
                    >
                      <Upload />
                      Publish
                    </Button>
                    {detail.status === "review" && (
                      <Button asChild variant="ghost" size="sm">
                        <Link to="/admin/review">
                          <StatusBadge tone="info">Open review queue</StatusBadge>
                        </Link>
                      </Button>
                    )}
                  </>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Unpublished games are not visible in the public feed until they are published.
              </p>
            </>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm?.kind === "remove" ? "Remove from catalog?" : "Unpublish this game?"}
        description={
          confirm?.kind === "remove"
            ? `${confirm?.row.title} will be hidden from the catalog. Existing scores stay on record.`
            : `${confirm?.row.title} will disappear from the feed and search, and new plays will be blocked.`
        }
        confirmLabel={confirm?.kind === "remove" ? "Remove" : "Unpublish"}
        destructive
        onConfirm={() => {
          if (!confirm) return;
          if (confirm.kind === "remove") {
            setRows((list) => list.filter((r) => r.key !== confirm.row.key));
            setDetail(null);
            toast.success(`${confirm.row.title} removed`);
          } else {
            patch(
              confirm.row.key,
              { status: "draft", featured: false, updated: "just now" },
              `${confirm.row.title} unpublished`,
            );
          }
          setConfirm(null);
        }}
      />
    </AdminPage>
  );
}
