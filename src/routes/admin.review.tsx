import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, Eye, FileCheck2, GitPullRequestArrow, RotateCcw, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AdminPage,
  ConfirmDialog,
  MetaRow,
  PromptDialog,
  SectionCard,
  StatusBadge,
  statusTone,
} from "@/components/admin/ui";
import {
  Avatar,
  EmptyState,
  ErrorState,
  GridSkeleton,
  StateSwitcher,
  useMockLoad,
} from "@/components/common";
import { GameArt } from "@/components/game/GameArt";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { adminSubmissions, type AdminSubmission } from "@/lib/admin-mock";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/review")({
  head: () => ({
    meta: [{ title: "Review queue — admin onemore" }, { name: "robots", content: "noindex" }],
  }),
  component: ReviewQueue,
});

const filters = ["pending", "changes", "approved", "rejected", "all"] as const;
type Filter = (typeof filters)[number];

const filterLabel: Record<Filter, string> = {
  pending: "Pending",
  changes: "Changes requested",
  approved: "Approved",
  rejected: "Rejected",
  all: "All",
};

function ReviewQueue() {
  const loading = useMockLoad(500);
  const [items, setItems] = useState(adminSubmissions);
  const [filter, setFilter] = useState<Filter>("pending");
  const [state, setState] = useState("ready");
  const [detail, setDetail] = useState<AdminSubmission | null>(null);
  const [dialog, setDialog] = useState<{
    item: AdminSubmission;
    kind: "reject" | "changes";
  } | null>(null);
  const [approve, setApprove] = useState<AdminSubmission | null>(null);

  const counts = useMemo(
    () =>
      filters.reduce<Record<string, number>>((acc, f) => {
        acc[f] = f === "all" ? items.length : items.filter((i) => i.status === f).length;
        return acc;
      }, {}),
    [items],
  );

  const list = filter === "all" ? items : items.filter((i) => i.status === filter);
  const s = loading ? "loading" : state;

  const setStatus = (id: string, status: AdminSubmission["status"], message: string) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, status, reviewedBy: "kira" } : i)));
    setDetail((d) => (d && d.id === id ? { ...d, status, reviewedBy: "kira" } : d));
    toast.success(message);
  };

  return (
    <AdminPage
      title="Review queue"
      subtitle="Creator submissions waiting for a decision. Approving publishes the update to players."
      actions={
        <div className="hidden md:block">
          <StateSwitcher value={state} onChange={setState} />
        </div>
      }
    >
      <div
        className="no-scrollbar mb-4 flex gap-2 overflow-x-auto pb-1"
        role="tablist"
        aria-label="Review status"
      >
        {filters.map((f) => (
          <button
            key={f}
            role="tab"
            aria-selected={filter === f}
            onClick={() => setFilter(f)}
            className={cn(
              "press flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm",
              filter === f
                ? "bg-foreground font-medium text-background"
                : "bg-surface text-muted-foreground",
            )}
          >
            {filterLabel[f]}
            <span
              className={cn(
                "rounded-full px-1.5 text-[11px] tabular",
                filter === f ? "bg-background/15" : "bg-surface-2",
              )}
            >
              {counts[f]}
            </span>
          </button>
        ))}
      </div>

      {s === "loading" ? (
        <GridSkeleton count={4} />
      ) : s === "error" ? (
        <ErrorState onRetry={() => setState("ready")} />
      ) : list.length === 0 ? (
        <EmptyState
          icon={FileCheck2}
          title={filter === "pending" ? "Queue is clear" : "Nothing here"}
          body={
            filter === "pending"
              ? "Every submission has been reviewed. New ones appear here automatically."
              : "No submissions with this status."
          }
        />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.map((item) => (
            <li
              key={item.id}
              className="enter flex flex-col overflow-hidden rounded-xl border border-border bg-surface"
            >
              <button
                className="press relative block aspect-[16/9] w-full"
                onClick={() => setDetail(item)}
                aria-label={`Review ${item.title}`}
              >
                <GameArt id={item.gameId} className="absolute inset-0" />
                <span className="absolute top-2 left-2 rounded-md bg-background/80 px-2 py-0.5 text-[11px] font-medium backdrop-blur">
                  {item.kind}
                </span>
                <span className="absolute top-2 right-2">
                  <StatusBadge tone={statusTone(item.status)}>{item.status}</StatusBadge>
                </span>
              </button>
              <div className="flex flex-1 flex-col p-4">
                <p className="truncate text-sm font-semibold">{item.title}</p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  @{item.creator} · version{" "}
                  <span className="font-mono tabular">{item.version}</span>
                </p>
                <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{item.notes}</p>
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>{item.category}</span>
                  <span aria-hidden>·</span>
                  <span>{item.size}</span>
                  <span aria-hidden>·</span>
                  <span>Submitted {item.submitted}</span>
                  {item.reviewedBy && (
                    <>
                      <span aria-hidden>·</span>
                      <span>Reviewed by @{item.reviewedBy}</span>
                    </>
                  )}
                </div>
                <div className="mt-4 flex flex-wrap gap-2 pt-1">
                  <Button size="sm" variant="secondary" onClick={() => setDetail(item)}>
                    <Eye />
                    Review
                  </Button>
                  {item.status === "pending" || item.status === "changes" ? (
                    <>
                      <Button size="sm" onClick={() => setApprove(item)}>
                        <Check />
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDialog({ item, kind: "changes" })}
                      >
                        <GitPullRequestArrow />
                        Request changes
                      </Button>
                    </>
                  ) : item.status === "approved" ? (
                    <Button asChild size="sm" variant="secondary">
                      <Link to="/games/$id" params={{ id: item.gameId }}>
                        Open public page
                      </Link>
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setStatus(item.id, "pending", `${item.title} moved back to pending`)
                      }
                    >
                      <RotateCcw />
                      Reopen
                    </Button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Submission detail */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-h-[88dvh] max-w-lg overflow-y-auto">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle>{detail.title}</DialogTitle>
                <DialogDescription>
                  {detail.kind} · submitted {detail.submitted}
                </DialogDescription>
              </DialogHeader>
              <div className="overflow-hidden rounded-xl border border-glass-border">
                <GameArt id={detail.gameId} className="aspect-[16/9] w-full" />
              </div>
              <div className="flex items-center gap-2">
                <Avatar name={detail.creator} size="sm" />
                <span className="flex-1 text-sm">@{detail.creator}</span>
                <StatusBadge tone={statusTone(detail.status)}>{detail.status}</StatusBadge>
              </div>
              <dl className="divide-y divide-border rounded-xl border border-border bg-surface px-4 py-1">
                <MetaRow label="Submission">{detail.id}</MetaRow>
                <MetaRow label="Category">{detail.category}</MetaRow>
                <MetaRow label="Version">
                  <span className="font-mono tabular">{detail.version}</span>
                </MetaRow>
                <MetaRow label="Package size">{detail.size}</MetaRow>
                <MetaRow label="Reviewed by">
                  {detail.reviewedBy ? `@${detail.reviewedBy}` : "Unassigned"}
                </MetaRow>
              </dl>
              <SectionCard title="Submission notes" bodyClassName="p-4">
                <p className="text-sm text-muted-foreground">{detail.notes}</p>
              </SectionCard>
              <div className="flex flex-wrap gap-2">
                {detail.status === "pending" || detail.status === "changes" ? (
                  <>
                    <Button size="sm" onClick={() => setApprove(detail)}>
                      <Check />
                      Approve and publish
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setDialog({ item: detail, kind: "changes" })}
                    >
                      <GitPullRequestArrow />
                      Request changes
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      onClick={() => setDialog({ item: detail, kind: "reject" })}
                    >
                      <X />
                      Reject
                    </Button>
                  </>
                ) : (
                  <>
                    <Button asChild size="sm" variant="secondary">
                      <Link to="/games/$id" params={{ id: detail.gameId }}>
                        Open public page
                      </Link>
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setStatus(detail.id, "pending", `${detail.title} moved back to pending`)
                      }
                    >
                      <RotateCcw />
                      Move back to pending
                    </Button>
                  </>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!approve}
        onOpenChange={(o) => !o && setApprove(null)}
        title="Approve and publish?"
        description={`${approve?.title} will go live for all players immediately.`}
        confirmLabel="Approve and publish"
        onConfirm={() => {
          if (approve) setStatus(approve.id, "approved", `${approve.title} approved and published`);
          setApprove(null);
        }}
      />

      <PromptDialog
        open={!!dialog}
        onOpenChange={(o) => !o && setDialog(null)}
        title={dialog?.kind === "reject" ? "Reject this submission?" : "Request changes"}
        description={
          dialog?.kind === "reject"
            ? `${dialog?.item.title} will be returned to the creator with your reason.`
            : `Tell @${dialog?.item.creator} what needs to change in ${dialog?.item.title}.`
        }
        label={dialog?.kind === "reject" ? "Reason for rejection" : "What should change?"}
        placeholder={
          dialog?.kind === "reject"
            ? "e.g. Levels 3 and 7 have no valid solution."
            : "e.g. Rebalance level 3, then resubmit."
        }
        confirmLabel={dialog?.kind === "reject" ? "Reject submission" : "Send request"}
        destructive={dialog?.kind === "reject"}
        onConfirm={() => {
          if (!dialog) return;
          setStatus(
            dialog.item.id,
            dialog.kind === "reject" ? "rejected" : "changes",
            dialog.kind === "reject"
              ? `${dialog.item.title} rejected`
              : `Changes requested on ${dialog.item.title}`,
          );
          setDialog(null);
        }}
      />
    </AdminPage>
  );
}
