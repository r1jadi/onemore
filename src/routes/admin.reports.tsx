import { createFileRoute, Link } from "@tanstack/react-router";
import { Ban, Check, ChevronRight, EyeOff, Flag, MoreHorizontal, X } from "lucide-react";
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
  Toolbar,
  statusTone,
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
import { adminReports, type AdminReport } from "@/lib/admin-mock";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/reports")({
  head: () => ({
    meta: [{ title: "Reports — admin onemore" }, { name: "robots", content: "noindex" }],
  }),
  component: ReportsAdmin,
});

const targets = [
  { value: "all", label: "All" },
  { value: "user", label: "Users" },
  { value: "game", label: "Games" },
  { value: "comment", label: "Comments" },
] as const;

const severityTone = { low: "muted", medium: "warning", high: "destructive" } as const;

function ReportsAdmin() {
  const loading = useMockLoad(500);
  const [reports, setReports] = useState(adminReports);
  const [target, setTarget] = useState<string>("all");
  const [status, setStatus] = useState("open");
  const [q, setQ] = useState("");
  const [state, setState] = useState("ready");
  const [detail, setDetail] = useState<AdminReport | null>(null);
  const [action, setAction] = useState<{
    report: AdminReport;
    kind: "suspend" | "unpublish" | "hide";
  } | null>(null);

  const counts = useMemo(
    () => ({
      open: reports.filter((r) => r.status === "open").length,
      resolved: reports.filter((r) => r.status === "resolved").length,
      dismissed: reports.filter((r) => r.status === "dismissed").length,
    }),
    [reports],
  );

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return reports.filter((r) => {
      const hit =
        !term ||
        r.targetLabel.toLowerCase().includes(term) ||
        r.reason.toLowerCase().includes(term) ||
        r.reporter.toLowerCase().includes(term) ||
        r.id.toLowerCase().includes(term);
      return (
        hit &&
        (target === "all" || r.target === target) &&
        (status === "all" || r.status === status)
      );
    });
  }, [reports, q, target, status]);

  const { page, setPage, pages, slice, total, perPage } = usePaged(filtered, 8);
  const s = loading ? "loading" : state;

  const setReportStatus = (id: string, next: AdminReport["status"], message: string) => {
    setReports((list) =>
      list.map((r) => (r.id === id ? { ...r, status: next, assignee: "kira" } : r)),
    );
    setDetail((d) => (d && d.id === id ? { ...d, status: next, assignee: "kira" } : d));
    toast.success(message);
  };

  const columns: Column<AdminReport>[] = [
    {
      key: "report",
      head: "Report",
      cell: (r) => (
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-medium">
            <span
              className={cn(
                "inline-flex size-6 shrink-0 items-center justify-center rounded-md",
                r.severity === "high"
                  ? "bg-destructive/15 text-destructive"
                  : r.severity === "medium"
                    ? "bg-warning/15 text-warning"
                    : "bg-surface-2 text-muted-foreground",
              )}
            >
              <Flag className="size-3" />
            </span>
            {r.reason}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {r.id} · reported by @{r.reporter} · {r.time}
          </p>
        </div>
      ),
    },
    {
      key: "target",
      head: "Target",
      cell: (r) => (
        <div className="min-w-0">
          <p className="truncate text-sm">{r.targetLabel}</p>
          <p className="truncate text-xs text-muted-foreground">
            <span className="capitalize">{r.target}</span> · {r.targetDetail}
          </p>
        </div>
      ),
    },
    {
      key: "severity",
      head: "Severity",
      cell: (r) => <StatusBadge tone={severityTone[r.severity]}>{r.severity}</StatusBadge>,
    },
    {
      key: "status",
      head: "Status",
      cell: (r) => <StatusBadge tone={statusTone(r.status)}>{r.status}</StatusBadge>,
    },
    {
      key: "assignee",
      head: "Handled by",
      cell: (r) => (
        <span className="text-sm text-muted-foreground">{r.assignee ? `@${r.assignee}` : "—"}</span>
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
              <Button variant="ghost" size="icon" aria-label={`Actions for ${r.id}`}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setDetail(r)}>Open report</DropdownMenuItem>
              <DropdownMenuItem
                disabled={r.status !== "open"}
                onClick={() => setReportStatus(r.id, "resolved", `${r.id} resolved`)}
              >
                <Check />
                Resolve
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={r.status !== "open"}
                onClick={() => setReportStatus(r.id, "dismissed", `${r.id} dismissed`)}
              >
                <X />
                Dismiss
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive"
                disabled={r.status !== "open"}
                onClick={() => setReportStatus(r.id, "dismissed", `${r.id} escalated and closed`)}
              >
                Escalate to trust & safety
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ];

  return (
    <AdminPage
      title="Reports"
      subtitle={`${counts.open} open · ${counts.resolved} resolved · ${counts.dismissed} dismissed. Reports from players about users, games and comments.`}
      actions={
        <div className="hidden md:block">
          <StateSwitcher value={state} onChange={setState} />
        </div>
      }
    >
      <div
        className="no-scrollbar mb-3 flex gap-2 overflow-x-auto pb-1"
        role="tablist"
        aria-label="Report target"
      >
        {targets.map((t) => (
          <button
            key={t.value}
            role="tab"
            aria-selected={target === t.value}
            onClick={() => {
              setTarget(t.value);
              setPage(1);
            }}
            className={cn(
              "press shrink-0 rounded-full px-3.5 py-1.5 text-sm",
              target === t.value
                ? "bg-foreground font-medium text-background"
                : "bg-surface text-muted-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Toolbar>
        <SearchField
          value={q}
          onChange={(v) => {
            setQ(v);
            setPage(1);
          }}
          placeholder="Search report id, target or reason"
          label="Search reports"
        />
        <FilterSelect
          label="Report status"
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          options={[
            { value: "open", label: "Open" },
            { value: "resolved", label: "Resolved" },
            { value: "dismissed", label: "Dismissed" },
            { value: "all", label: "All statuses" },
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
          emptyTitle="No reports match"
          emptyBody="Try another status or clear the search."
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setQ("");
                setStatus("all");
                setTarget("all");
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
            rowKey={(r) => r.id}
            onRow={(r) => setDetail(r)}
            mobileRow={(r) => (
              <MobileRow ariaLabel={`Open report ${r.id}`} onClick={() => setDetail(r)}>
                <span
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-lg",
                    r.severity === "high"
                      ? "bg-destructive/15 text-destructive"
                      : r.severity === "medium"
                        ? "bg-warning/15 text-warning"
                        : "bg-surface-2 text-muted-foreground",
                  )}
                >
                  <Flag className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{r.reason}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {r.targetLabel} · {r.time}
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
            label="reports"
          />
        </>
      )}

      {/* Report detail */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-h-[88dvh] max-w-lg overflow-y-auto">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {detail.reason}
                  <StatusBadge tone={severityTone[detail.severity]}>
                    {detail.severity} severity
                  </StatusBadge>
                </DialogTitle>
                <DialogDescription>
                  {detail.id} · {detail.target} report · {detail.time}
                </DialogDescription>
              </DialogHeader>

              <div className="rounded-xl border border-border bg-surface p-4">
                {" "}
                <p className="text-xs text-muted-foreground capitalize">Reported {detail.target}</p>
                {detail.target === "user" && (
                  <div className="mt-2 flex items-center gap-3">
                    <Avatar name={detail.targetLabel.replace("@", "")} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{detail.targetLabel}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {detail.targetDetail}
                      </p>
                    </div>
                    <Button asChild size="sm" variant="secondary">
                      <Link
                        to="/u/$username"
                        params={{ username: detail.targetLabel.replace("@", "") }}
                      >
                        Profile
                      </Link>
                    </Button>
                  </div>
                )}
                {detail.target === "game" && (
                  <div className="mt-2 flex items-center gap-3">
                    <span className="relative block size-12 shrink-0 overflow-hidden rounded-lg border border-glass-border">
                      {detail.game && (
                        <GameArt
                          id={detail.game}
                          className="absolute top-0 left-0 size-36 origin-top-left scale-[0.34]"
                        />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{detail.targetLabel}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {detail.targetDetail}
                      </p>
                    </div>
                    {detail.game && (
                      <Button asChild size="sm" variant="secondary">
                        <Link to="/games/$id" params={{ id: detail.game }}>
                          Open
                        </Link>
                      </Button>
                    )}
                  </div>
                )}
                {detail.target === "comment" && (
                  <div className="mt-2">
                    <p className="text-sm italic">“{detail.targetDetail.replace(/^"|"$/g, "")}”</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      by {detail.targetLabel}
                      {detail.game ? ` · on ${detail.game.replace(/-/g, " ")}` : ""}
                    </p>
                  </div>
                )}
              </div>

              <dl className="divide-y divide-border rounded-xl border border-border bg-surface px-4 py-1">
                <MetaRow label="Reported by">@{detail.reporter}</MetaRow>
                <MetaRow label="Status">
                  <StatusBadge tone={statusTone(detail.status)}>{detail.status}</StatusBadge>
                </MetaRow>
                <MetaRow label="Handled by">
                  {detail.assignee ? `@${detail.assignee}` : "Unassigned"}
                </MetaRow>
              </dl>

              <p className="text-sm text-muted-foreground">{detail.detail}</p>

              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={detail.status !== "open"}
                  onClick={() => setReportStatus(detail.id, "resolved", `${detail.id} resolved`)}
                >
                  <Check />
                  Resolve
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={detail.status !== "open"}
                  onClick={() => setReportStatus(detail.id, "dismissed", `${detail.id} dismissed`)}
                >
                  <X />
                  Dismiss
                </Button>
                {detail.target === "user" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => setAction({ report: detail, kind: "suspend" })}
                  >
                    <Ban />
                    Suspend user
                  </Button>
                )}
                {detail.target === "game" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => setAction({ report: detail, kind: "unpublish" })}
                  >
                    <EyeOff />
                    Unpublish game
                  </Button>
                )}
                {detail.target === "comment" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => setAction({ report: detail, kind: "hide" })}
                  >
                    <EyeOff />
                    Hide comment
                  </Button>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!action}
        onOpenChange={(o) => !o && setAction(null)}
        title={
          action?.kind === "suspend"
            ? "Suspend this user?"
            : action?.kind === "unpublish"
              ? "Unpublish this game?"
              : "Hide this comment?"
        }
        description={
          action?.kind === "suspend"
            ? `${action?.report.targetLabel} will be signed out and blocked from playing or posting.`
            : action?.kind === "unpublish"
              ? `${action?.report.targetLabel} will be removed from the feed until it is fixed.`
              : "The comment stays on record but is hidden from other players."
        }
        confirmLabel={
          action?.kind === "suspend"
            ? "Suspend"
            : action?.kind === "unpublish"
              ? "Unpublish"
              : "Hide comment"
        }
        destructive
        onConfirm={() => {
          if (!action) return;
          const message =
            action.kind === "suspend"
              ? `${action.report.targetLabel} suspended`
              : action.kind === "unpublish"
                ? `${action.report.targetLabel} unpublished`
                : "Comment hidden";
          setReportStatus(action.report.id, "resolved", message);
          setAction(null);
        }}
      />
    </AdminPage>
  );
}
