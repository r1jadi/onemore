import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  ChevronRight,
  MoreHorizontal,
  RotateCcw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
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
  PromptDialog,
  StatusBadge,
  Toolbar,
  usePaged,
  type Column,
} from "@/components/admin/ui";
import { Avatar, ErrorState, ListSkeleton, StateSwitcher, useMockLoad } from "@/components/common";
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
import { adminScores, type AdminScoreRow } from "@/lib/admin-mock";
import { fmt, games, getGame, type GameId } from "@/lib/mock";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/leaderboards")({
  head: () => ({
    meta: [{ title: "Leaderboards — admin onemore" }, { name: "robots", content: "noindex" }],
  }),
  component: LeaderboardsAdmin,
});

const periods = [
  { value: "day", label: "Today", factor: 0.18 },
  { value: "week", label: "This week", factor: 0.62 },
  { value: "all", label: "All time", factor: 1 },
];

type Row = AdminScoreRow & { gameId?: GameId; verified: boolean };

function LeaderboardsAdmin() {
  const loading = useMockLoad(500);
  const [scope, setScope] = useState<string>("all");
  const [period, setPeriod] = useState("week");
  const [q, setQ] = useState("");
  const [state, setState] = useState("ready");
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [removed, setRemoved] = useState<string[]>([]);
  const [verified, setVerified] = useState<string[]>(
    adminScores.filter((s) => s.rank <= 5).map(keyOf),
  );
  const [detail, setDetail] = useState<Row | null>(null);
  const [adjust, setAdjust] = useState<Row | null>(null);
  const [confirm, setConfirm] = useState<Row | null>(null);

  const factor = periods.find((p) => p.value === period)?.factor ?? 1;

  const rows: Row[] = useMemo(() => {
    const term = q.trim().toLowerCase();
    return adminScores
      .filter((s) => !removed.includes(keyOf(s)))
      .filter((s) => !term || s.user.toLowerCase().includes(term))
      .map((s) => {
        const score = overrides[keyOf(s)] ?? Math.round(s.score * factor);
        const scaledPlays = period === "all" ? s.plays : Math.max(1, Math.round(s.plays * factor));
        return {
          ...s,
          score,
          plays: scaledPlays,
          gameId: scope === "all" ? undefined : (scope as GameId),
          verified: verified.includes(keyOf(s)),
        };
      })
      .sort((a, b) => b.score - a.score)
      .map((s, i) => ({ ...s, rank: i + 1 }));
  }, [q, scope, factor, period, overrides, removed, verified]);

  const { page, setPage, pages, slice, total, perPage } = usePaged(rows, 8);
  const s = loading ? "loading" : state;
  const scopeTitle = scope === "all" ? "Global leaderboard" : `${getGame(scope).title} leaderboard`;

  function keyOf(row: AdminScoreRow) {
    return `${row.user}`;
  }

  const columns: Column<Row>[] = [
    {
      key: "rank",
      head: "Rank",
      className: "w-16",
      cell: (r) => (
        <span className={cn("font-mono text-sm tabular", r.rank <= 3 && "font-semibold")}>
          {r.rank}
        </span>
      ),
    },
    {
      key: "user",
      head: "Player",
      cell: (r) => (
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={r.user} size="sm" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">@{r.user}</p>
            <p className="truncate text-xs text-muted-foreground">
              {r.country} · {r.time}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: "score",
      head: "Score",
      className: "text-right",
      cell: (r) => (
        <span className="inline-flex items-center gap-2">
          {r.flagged && (
            <AlertTriangle className="size-3.5 text-destructive" aria-label="Flagged" />
          )}
          <span className="font-mono text-sm font-semibold tabular">{fmt(r.score)}</span>
        </span>
      ),
    },
    {
      key: "plays",
      head: "Runs",
      className: "text-right",
      cell: (r) => (
        <span className="font-mono text-sm text-muted-foreground tabular">{r.plays}</span>
      ),
    },
    {
      key: "verified",
      head: "Verification",
      cell: (r) => (
        <StatusBadge tone={r.flagged ? "destructive" : r.verified ? "success" : "muted"}>
          {r.flagged ? "flagged" : r.verified ? "verified" : "unverified"}
        </StatusBadge>
      ),
    },
    {
      key: "actions",
      head: <span className="sr-only">Actions</span>,
      className: "w-12 text-right",
      cell: (r) => (
        <div onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={`Actions for @${r.user}`}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setDetail(r)}>View score</DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setVerified((v) => [...v, keyOf(r)]);
                  toast.success(`@${r.user}'s score verified`);
                }}
              >
                <ShieldCheck />
                Verify score
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setAdjust(r)}>Adjust score</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive" onClick={() => setConfirm(r)}>
                <Trash2 />
                Remove score
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ];

  return (
    <AdminPage
      title="Leaderboards"
      subtitle={`${scopeTitle} · ${periods.find((p) => p.value === period)?.label.toLowerCase()}. Remove or verify scores that look manipulated.`}
      actions={
        <div className="hidden md:block">
          <StateSwitcher value={state} onChange={setState} />
        </div>
      }
    >
      <div className="no-scrollbar mb-3 flex gap-2 overflow-x-auto pb-1">
        <button
          onClick={() => {
            setScope("all");
            setPage(1);
          }}
          className={cn(
            "press shrink-0 rounded-full px-3.5 py-1.5 text-sm",
            scope === "all"
              ? "bg-foreground font-medium text-background"
              : "bg-surface text-muted-foreground",
          )}
        >
          All games
        </button>
        {games.map((g) => (
          <button
            key={g.id}
            onClick={() => {
              setScope(g.id);
              setPage(1);
            }}
            className={cn(
              "press shrink-0 rounded-full px-3.5 py-1.5 text-sm",
              scope === g.id
                ? "bg-foreground font-medium text-background"
                : "bg-surface text-muted-foreground",
            )}
          >
            {g.title}
          </button>
        ))}
      </div>

      <Toolbar>
        <FilterSelect
          label="Time period"
          value={period}
          onChange={(v) => {
            setPeriod(v);
            setPage(1);
          }}
          options={periods.map((p) => ({ value: p.value, label: p.label }))}
        />
        <input
          aria-label="Search players"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          placeholder="Search player"
          className="h-10 w-full rounded-xl bg-surface px-4 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring md:max-w-xs"
        />
        <span className="text-xs text-muted-foreground">
          Scores are copied from the runtime every few minutes.
        </span>
      </Toolbar>

      {s === "loading" ? (
        <ListSkeleton rows={8} />
      ) : s === "error" ? (
        <ErrorState onRetry={() => setState("ready")} />
      ) : s === "empty" || rows.length === 0 ? (
        <AdminListStates
          state="empty"
          emptyTitle={removed.length > 0 ? "No scores left in this view" : "No scores yet"}
          emptyBody={
            removed.length > 0
              ? "Removed scores can be restored below."
              : "Scores appear once players finish a run."
          }
          action={
            removed.length > 0 ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setRemoved([]);
                  toast.success("Removed scores restored");
                }}
              >
                <RotateCcw />
                Restore removed scores
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <AdminTable
            columns={columns}
            rows={slice}
            rowKey={(r) => `${scope}-${r.rank}-${r.user}`}
            onRow={(r) => setDetail(r)}
            mobileRow={(r) => (
              <MobileRow ariaLabel={`Open score for @${r.user}`} onClick={() => setDetail(r)}>
                <span className="w-6 shrink-0 text-center font-mono text-sm text-muted-foreground tabular">
                  {r.rank}
                </span>
                <Avatar name={r.user} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">@{r.user}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {r.plays} runs · {r.country}
                  </p>
                </div>
                <span
                  className={cn(
                    "font-mono text-sm font-semibold tabular",
                    r.flagged && "text-destructive",
                  )}
                >
                  {fmt(r.score)}
                </span>
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
            label="scores"
          />
        </>
      )}

      {/* Score detail */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-h-[88dvh] max-w-md overflow-y-auto">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  Score {fmt(detail.score)}
                  {detail.flagged && <StatusBadge tone="destructive">flagged</StatusBadge>}
                </DialogTitle>
                <DialogDescription>
                  {scopeTitle} · {periods.find((p) => p.value === period)?.label}
                </DialogDescription>
              </DialogHeader>
              <div className="flex items-center gap-3">
                <Avatar name={detail.user} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">@{detail.user}</p>
                  <p className="text-xs text-muted-foreground">
                    {detail.country} · rank #{detail.rank}
                  </p>
                </div>
                <Button asChild size="sm" variant="secondary">
                  <Link to="/u/$username" params={{ username: detail.user }}>
                    Profile
                  </Link>
                </Button>
              </div>
              <dl className="divide-y divide-border rounded-xl border border-border bg-surface px-4 py-1">
                <MetaRow label="Score">
                  <span className="font-mono tabular">{fmt(detail.score)}</span>
                </MetaRow>
                <MetaRow label="Runs">{detail.plays}</MetaRow>
                <MetaRow label="Last run">{detail.time}</MetaRow>
                <MetaRow label="Verification">
                  <StatusBadge
                    tone={detail.flagged ? "destructive" : detail.verified ? "success" : "muted"}
                  >
                    {detail.flagged ? "flagged" : detail.verified ? "verified" : "unverified"}
                  </StatusBadge>
                </MetaRow>
              </dl>
              {detail.flagged && (
                <p className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  Flagged automatically: score jumped 4× in under 10 minutes and the run pattern
                  repeats.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setVerified((v) => [...v, keyOf(detail)]);
                    setDetail({ ...detail, verified: true, flagged: false });
                    toast.success(`@${detail.user}'s score verified`);
                  }}
                >
                  <ShieldCheck />
                  Verify score
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setAdjust(detail)}>
                  Adjust score
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  onClick={() => setConfirm(detail)}
                >
                  <Trash2 />
                  Remove score
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <PromptDialog
        open={!!adjust}
        onOpenChange={(o) => !o && setAdjust(null)}
        title="Adjust score"
        description={`Set a corrected score for @${adjust?.user}. Leaderboards update immediately.`}
        label="Corrected score"
        placeholder="e.g. 4820"
        confirmLabel="Save score"
        onConfirm={(text) => {
          if (!adjust) return;
          const value = Number(text.replace(/[^0-9]/g, ""));
          if (!value) {
            toast.error("Enter a number");
            return;
          }
          setOverrides((o) => ({ ...o, [keyOf(adjust)]: value }));
          setDetail((d) => (d && keyOf(d) === keyOf(adjust) ? { ...d, score: value } : d));
          toast.success(`@${adjust.user}'s score set to ${fmt(value)}`);
          setAdjust(null);
        }}
      />

      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Remove this score?"
        description={`@${confirm?.user}'s score of ${confirm ? fmt(confirm.score) : ""} will be taken off the ${scopeTitle.toLowerCase()}. The player keeps their other runs.`}
        confirmLabel="Remove score"
        destructive
        onConfirm={() => {
          if (!confirm) return;
          setRemoved((r) => [...r, keyOf(confirm)]);
          setDetail(null);
          toast.success(`@${confirm.user}'s score removed`);
          setConfirm(null);
        }}
      />
    </AdminPage>
  );
}
