import { createFileRoute } from "@tanstack/react-router";
import {
  BadgeCheck,
  Ban,
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
  SearchField,
  StatusBadge,
  statusTone,
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
import { adminReports, adminUsers, type AdminUser } from "@/lib/admin-mock";
import { fmt } from "@/lib/format";

export const Route = createFileRoute("/admin/users")({
  head: () => ({
    meta: [{ title: "Users — admin onemore" }, { name: "robots", content: "noindex" }],
  }),
  component: UsersAdmin,
});

function UsersAdmin() {
  const loading = useMockLoad(500);
  const [users, setUsers] = useState(adminUsers);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [role, setRole] = useState("all");
  const [state, setState] = useState("ready");
  const [detail, setDetail] = useState<AdminUser | null>(null);
  const [confirm, setConfirm] = useState<{
    user: AdminUser;
    kind: "suspend" | "restore" | "delete";
  } | null>(null);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return users.filter((u) => {
      const hit =
        !term ||
        u.username.toLowerCase().includes(term) ||
        u.name.toLowerCase().includes(term) ||
        u.email.toLowerCase().includes(term);
      const statusHit = status === "all" || u.status === status;
      const roleHit = role === "all" || u.role === role;
      return hit && statusHit && roleHit;
    });
  }, [users, q, status, role]);

  const { page, setPage, pages, slice, total, perPage } = usePaged(filtered, 8);
  const s = loading ? "loading" : state;

  const patch = (username: string, next: Partial<AdminUser>, message: string) => {
    setUsers((list) => list.map((u) => (u.username === username ? { ...u, ...next } : u)));
    setDetail((d) => (d && d.username === username ? { ...d, ...next } : d));
    toast.success(message);
  };

  const columns: Column<AdminUser>[] = [
    {
      key: "user",
      head: "User",
      cell: (u) => (
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={u.username} size="sm" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{u.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              @{u.username} · {u.email}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: "role",
      head: "Role",
      cell: (u) => <span className="text-sm capitalize text-muted-foreground">{u.role}</span>,
    },
    {
      key: "status",
      head: "Status",
      cell: (u) => <StatusBadge tone={statusTone(u.status)}>{u.status}</StatusBadge>,
    },
    {
      key: "plays",
      head: "Plays",
      className: "text-right",
      cell: (u) => <span className="font-mono text-sm tabular">{fmt(u.plays)}</span>,
    },
    {
      key: "reports",
      head: "Reports",
      className: "text-right",
      cell: (u) =>
        u.reports > 0 ? (
          <StatusBadge tone="destructive">{u.reports}</StatusBadge>
        ) : (
          <span className="text-sm text-muted-foreground tabular">0</span>
        ),
    },
    {
      key: "joined",
      head: "Joined",
      cell: (u) => <span className="text-xs text-muted-foreground">{u.joined}</span>,
    },
    {
      key: "active",
      head: "Last active",
      cell: (u) => <span className="text-xs text-muted-foreground">{u.lastActive}</span>,
    },
    {
      key: "actions",
      head: <span className="sr-only">Actions</span>,
      className: "w-12 text-right",
      cell: (u) => (
        <div onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={`Actions for @${u.username}`}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setDetail(u)}>View details</DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  patch(
                    u.username,
                    { verified: !u.verified },
                    u.verified
                      ? `Verification removed from @${u.username}`
                      : `@${u.username} verified`,
                  )
                }
              >
                {u.verified ? "Remove verification" : "Verify user"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {u.status === "suspended" ? (
                <DropdownMenuItem onClick={() => setConfirm({ user: u, kind: "restore" })}>
                  Restore account
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={() => setConfirm({ user: u, kind: "suspend" })}>
                  Suspend account
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => setConfirm({ user: u, kind: "delete" })}
              >
                Delete user
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ];

  const userReports = detail
    ? adminReports.filter(
        (r) => r.targetLabel === `@${detail.username}` || r.reporter === detail.username,
      )
    : [];

  return (
    <AdminPage
      title="Users"
      subtitle={`${total} accounts${status !== "all" || role !== "all" ? " matching filters" : ""}. Moderation actions apply instantly in this prototype.`}
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
          placeholder="Search name, username or email"
          label="Search users"
        />
        <FilterSelect
          label="Account status"
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          options={[
            { value: "all", label: "All statuses" },
            { value: "active", label: "Active" },
            { value: "flagged", label: "Flagged" },
            { value: "suspended", label: "Suspended" },
            { value: "pending", label: "Pending" },
          ]}
        />
        <FilterSelect
          label="Account role"
          value={role}
          onChange={(v) => {
            setRole(v);
            setPage(1);
          }}
          options={[
            { value: "all", label: "All roles" },
            { value: "player", label: "Players" },
            { value: "creator", label: "Creators" },
            { value: "moderator", label: "Moderators" },
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
          emptyTitle="No users match"
          emptyBody="Try a different search term or clear the filters."
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setQ("");
                setStatus("all");
                setRole("all");
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
            rowKey={(u) => u.id}
            onRow={(u) => setDetail(u)}
            mobileRow={(u) => (
              <MobileRow ariaLabel={`Open @${u.username}`} onClick={() => setDetail(u)}>
                <Avatar name={u.username} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{u.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    @{u.username} · {fmt(u.plays)} plays
                  </p>
                </div>
                <StatusBadge tone={statusTone(u.status)}>{u.status}</StatusBadge>
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
            label="users"
          />
        </>
      )}

      {/* User details */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-h-[88dvh] max-w-lg overflow-y-auto">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="sr-only">User details</DialogTitle>
                <DialogDescription className="sr-only">
                  Profile, activity and moderation for @{detail.username}
                </DialogDescription>
              </DialogHeader>
              <div className="flex items-center gap-3">
                <Avatar name={detail.username} size="lg" />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 font-semibold">
                    {detail.name}
                    {detail.verified && (
                      <BadgeCheck className="size-4 text-info" aria-label="Verified" />
                    )}
                  </p>
                  <p className="text-sm text-muted-foreground">@{detail.username}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <StatusBadge tone={statusTone(detail.status)}>{detail.status}</StatusBadge>
                  <span className="text-xs capitalize text-muted-foreground">{detail.role}</span>
                </div>
              </div>

              <dl className="divide-y divide-border rounded-xl border border-border bg-surface px-4 py-1">
                <MetaRow label="Email">{detail.email}</MetaRow>
                <MetaRow label="Country">{detail.country}</MetaRow>
                <MetaRow label="Joined">{detail.joined}</MetaRow>
                <MetaRow label="Last active">{detail.lastActive}</MetaRow>
                <MetaRow label="Followers">{fmt(detail.followers)}</MetaRow>
                <MetaRow label="Games played">{fmt(detail.plays)}</MetaRow>
                <MetaRow label="Reports">
                  {detail.reports === 0 ? "None" : `${detail.reports} reports`}
                </MetaRow>
              </dl>

              <section>
                <h3 className="mb-2 text-sm font-semibold">Moderation history</h3>
                {userReports.length === 0 ? (
                  <p className="rounded-xl border border-border bg-surface px-4 py-3 text-sm text-muted-foreground">
                    No reports or moderation actions for this account.
                  </p>
                ) : (
                  <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
                    {userReports.map((r) => (
                      <li key={r.id} className="flex items-center gap-3 px-4 py-3">
                        <StatusBadge tone={statusTone(r.status)}>{r.status}</StatusBadge>
                        <span className="min-w-0 flex-1 truncate text-sm">{r.reason}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{r.time}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    patch(
                      detail.username,
                      { verified: !detail.verified },
                      detail.verified ? "Verification removed" : "User verified",
                    )
                  }
                >
                  <ShieldCheck />
                  {detail.verified ? "Unverify" : "Verify"}
                </Button>
                {detail.status === "suspended" ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setConfirm({ user: detail, kind: "restore" })}
                  >
                    <RotateCcw />
                    Restore
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setConfirm({ user: detail, kind: "suspend" })}
                  >
                    <Ban />
                    Suspend
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  onClick={() => setConfirm({ user: detail, kind: "delete" })}
                >
                  <Trash2 />
                  Delete
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Signed in as <UserName username="kira" /> · moderator
              </p>
            </>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={
          confirm?.kind === "delete"
            ? "Delete this account?"
            : confirm?.kind === "restore"
              ? "Restore this account?"
              : "Suspend this account?"
        }
        description={
          confirm?.kind === "delete"
            ? `@${confirm.user.username}'s profile, scores and comments will be removed after 30 days. This can't be undone.`
            : confirm?.kind === "restore"
              ? `@${confirm?.user.username} will be able to play and comment again.`
              : `@${confirm?.user.username} will be signed out and blocked from playing or posting.`
        }
        confirmLabel={
          confirm?.kind === "delete"
            ? "Delete account"
            : confirm?.kind === "restore"
              ? "Restore"
              : "Suspend"
        }
        destructive={confirm?.kind !== "restore"}
        onConfirm={() => {
          if (!confirm) return;
          const { user, kind } = confirm;
          if (kind === "delete") {
            setUsers((list) => list.filter((u) => u.username !== user.username));
            setDetail(null);
            toast.success(`@${user.username} deleted`);
          } else if (kind === "suspend") {
            patch(user.username, { status: "suspended" }, `@${user.username} suspended`);
          } else {
            patch(user.username, { status: "active" }, `@${user.username} restored`);
          }
          setConfirm(null);
        }}
      />
    </AdminPage>
  );
}
