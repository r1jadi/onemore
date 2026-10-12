import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, Eye, EyeOff, MessageSquare, MoreHorizontal, Trash2 } from "lucide-react";
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
  usePaged,
  type Column,
} from "@/components/admin/ui";
import {
  Avatar,
  ErrorState,
  ListSkeleton,
  StateSwitcher,
  UserName,
  useMockLoad,
} from "@/components/common";
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
import { adminComments, type AdminComment } from "@/lib/admin-mock";
import { fmt } from "@/lib/format";
import { getGame } from "@/lib/admin-mock";
import { users } from "@/lib/mock";

export const Route = createFileRoute("/admin/comments")({
  head: () => ({
    meta: [{ title: "Comments — admin onemore" }, { name: "robots", content: "noindex" }],
  }),
  component: CommentsAdmin,
});

function CommentsAdmin() {
  const loading = useMockLoad(500);
  const [comments, setComments] = useState(adminComments);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [state, setState] = useState("ready");
  const [detail, setDetail] = useState<AdminComment | null>(null);
  const [confirm, setConfirm] = useState<{
    comment: AdminComment;
    kind: "hide" | "unhide" | "delete";
  } | null>(null);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return comments.filter((c) => {
      const hit =
        !term ||
        c.text.toLowerCase().includes(term) ||
        c.user.toLowerCase().includes(term) ||
        getGame(c.game).title.toLowerCase().includes(term);
      const filterHit =
        filter === "all" ||
        (filter === "reported" && c.reports > 0) ||
        (filter === "hidden" && c.hidden) ||
        (filter === "visible" && !c.hidden);
      return hit && filterHit;
    });
  }, [comments, q, filter]);

  const { page, setPage, pages, slice, total, perPage } = usePaged(filtered, 8);
  const s = loading ? "loading" : state;

  const patch = (id: string, next: Partial<AdminComment>, message: string) => {
    setComments((list) => list.map((c) => (c.id === id ? { ...c, ...next } : c)));
    setDetail((d) => (d && d.id === id ? { ...d, ...next } : d));
    toast.success(message);
  };

  const columns: Column<AdminComment>[] = [
    {
      key: "comment",
      head: "Comment",
      cell: (c) => (
        <div className="min-w-0 max-w-md">
          <p className="truncate text-sm">{c.text}</p>
          <p className="truncate text-xs text-muted-foreground">
            {getGame(c.game).title} · {c.time}
            {c.score ? ` · scored ${fmt(c.score)}` : ""}
          </p>
        </div>
      ),
    },
    {
      key: "user",
      head: "User",
      cell: (c) => <span className="text-sm text-muted-foreground">@{c.user}</span>,
    },
    {
      key: "likes",
      head: "Likes",
      className: "text-right",
      cell: (c) => <span className="font-mono text-sm tabular">{fmt(c.likes)}</span>,
    },
    {
      key: "reports",
      head: "Reports",
      className: "text-right",
      cell: (c) =>
        c.reports > 0 ? (
          <StatusBadge tone="destructive">{c.reports}</StatusBadge>
        ) : (
          <span className="text-sm text-muted-foreground tabular">0</span>
        ),
    },
    {
      key: "status",
      head: "Status",
      cell: (c) => (
        <StatusBadge tone={c.hidden ? "muted" : "success"}>
          {c.hidden ? "hidden" : "visible"}
        </StatusBadge>
      ),
    },
    {
      key: "actions",
      head: <span className="sr-only">Actions</span>,
      className: "w-12 text-right",
      cell: (c) => (
        <div onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Comment actions">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setDetail(c)}>View comment</DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  setConfirm(
                    c.hidden ? { comment: c, kind: "unhide" } : { comment: c, kind: "hide" },
                  )
                }
              >
                {c.hidden ? (
                  <>
                    <Eye />
                    Unhide comment
                  </>
                ) : (
                  <>
                    <EyeOff />
                    Hide comment
                  </>
                )}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => setConfirm({ comment: c, kind: "delete" })}
              >
                <Trash2 />
                Delete comment
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ];

  const author = detail ? users.find((u) => u.username === detail.user) : undefined;

  return (
    <AdminPage
      title="Comments"
      subtitle={`${comments.filter((c) => c.reports > 0).length} reported comments need attention. Hide or delete anything that breaks the rules.`}
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
          placeholder="Search comment, user or game"
          label="Search comments"
        />
        <FilterSelect
          label="Comment filter"
          value={filter}
          onChange={(v) => {
            setFilter(v);
            setPage(1);
          }}
          options={[
            { value: "all", label: "All comments" },
            { value: "reported", label: "Reported only" },
            { value: "visible", label: "Visible" },
            { value: "hidden", label: "Hidden" },
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
          emptyTitle="No comments match"
          emptyBody="Try another search term or filter."
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setQ("");
                setFilter("all");
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
            rowKey={(c) => c.id}
            onRow={(c) => setDetail(c)}
            mobileRow={(c) => (
              <MobileRow ariaLabel="Open comment" onClick={() => setDetail(c)}>
                <Avatar name={c.user} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{c.text}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    @{c.user} · {getGame(c.game).title} · {c.time}
                  </p>
                </div>
                {c.reports > 0 && <StatusBadge tone="destructive">{c.reports}</StatusBadge>}
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
            label="comments"
          />
        </>
      )}

      {/* Comment detail */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-h-[88dvh] max-w-lg overflow-y-auto">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle>Comment</DialogTitle>
                <DialogDescription>
                  {getGame(detail.game).title} · {detail.time}
                </DialogDescription>
              </DialogHeader>
              <blockquote className="rounded-xl border border-border bg-surface p-4 text-sm">
                {detail.text}
              </blockquote>
              <div className="flex items-center gap-3">
                <Avatar name={detail.user} />
                <div className="min-w-0 flex-1">
                  <UserName username={detail.user} verified={author?.verified} />
                  <p className="truncate text-xs text-muted-foreground">
                    {author?.name ?? "Player"} · {fmt(author?.followers ?? 0)} followers
                  </p>
                </div>
                <Button asChild size="sm" variant="secondary">
                  <Link to="/u/$username" params={{ username: detail.user }}>
                    Profile
                  </Link>
                </Button>
              </div>
              <dl className="divide-y divide-border rounded-xl border border-border bg-surface px-4 py-1">
                <MetaRow label="Likes">{fmt(detail.likes)}</MetaRow>
                <MetaRow label="Reports">{detail.reports === 0 ? "None" : detail.reports}</MetaRow>
                <MetaRow label="Status">
                  <StatusBadge tone={detail.hidden ? "muted" : "success"}>
                    {detail.hidden ? "hidden" : "visible"}
                  </StatusBadge>
                </MetaRow>
              </dl>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    patch(
                      detail.id,
                      { hidden: !detail.hidden },
                      detail.hidden ? "Comment unhidden" : "Comment hidden",
                    )
                  }
                >
                  {detail.hidden ? (
                    <>
                      <Eye />
                      Unhide
                    </>
                  ) : (
                    <>
                      <EyeOff />
                      Hide
                    </>
                  )}
                </Button>
                <Button asChild size="sm" variant="ghost">
                  <Link to="/games/$id" params={{ id: detail.game }}>
                    <MessageSquare />
                    Open game
                  </Link>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  onClick={() => setConfirm({ comment: detail, kind: "delete" })}
                >
                  <Trash2 />
                  Delete
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={
          confirm?.kind === "delete"
            ? "Delete this comment?"
            : confirm?.kind === "hide"
              ? "Hide this comment?"
              : "Unhide this comment?"
        }
        description={
          confirm?.kind === "delete"
            ? `The comment from @${confirm.comment.user} will be permanently removed and every report on it closed.`
            : confirm?.kind === "hide"
              ? "The comment stays on record for moderators but disappears for everyone else."
              : "The comment will be visible again to all players."
        }
        confirmLabel={
          confirm?.kind === "delete"
            ? "Delete comment"
            : confirm?.kind === "hide"
              ? "Hide comment"
              : "Unhide"
        }
        destructive={confirm?.kind !== "unhide"}
        onConfirm={() => {
          if (!confirm) return;
          if (confirm.kind === "delete") {
            setComments((list) => list.filter((c) => c.id !== confirm.comment.id));
            setDetail(null);
            toast.success("Comment deleted");
          } else {
            patch(
              confirm.comment.id,
              { hidden: confirm.kind === "hide" },
              confirm.kind === "hide" ? "Comment hidden" : "Comment unhidden",
            );
          }
          setConfirm(null);
        }}
      />
    </AdminPage>
  );
}
