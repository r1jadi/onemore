import { createFileRoute } from "@tanstack/react-router";
import {
  Bell,
  CalendarClock,
  ChevronRight,
  Copy,
  MoreHorizontal,
  Plus,
  Send,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AdminPage,
  ConfirmDialog,
  Field,
  MetaRow,
  Pager,
  SectionCard,
  StatusBadge,
  statusTone,
  TextField,
  usePaged,
} from "@/components/admin/ui";
import { ErrorState, ListSkeleton, StateSwitcher, useMockLoad } from "@/components/common";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { adminNotifications, type AdminNotification } from "@/lib/admin-mock";
import { fmt } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/notifications")({
  head: () => ({
    meta: [{ title: "Notifications — admin onemore" }, { name: "robots", content: "noindex" }],
  }),
  component: NotificationsAdmin,
});

const filters = [
  { value: "all", label: "All" },
  { value: "sent", label: "Sent" },
  { value: "scheduled", label: "Scheduled" },
  { value: "draft", label: "Drafts" },
] as const;

const audiences = [
  "All players",
  "Active players",
  "Daily players",
  "Creators",
  "Logic + Puzzle",
  "Reaction players",
];

function NotificationsAdmin() {
  const loading = useMockLoad(500);
  const [items, setItems] = useState(adminNotifications);
  const [filter, setFilter] = useState<string>("all");
  const [state, setState] = useState("ready");
  const [create, setCreate] = useState(false);
  const [preview, setPreview] = useState<AdminNotification | null>(null);
  const [confirm, setConfirm] = useState<AdminNotification | null>(null);

  const filtered = useMemo(
    () => items.filter((n) => filter === "all" || n.status === filter),
    [items, filter],
  );
  const { page, setPage, pages, slice, total, perPage } = usePaged(filtered, 8);
  const s = loading ? "loading" : state;

  const remove = (id: string) => setItems((list) => list.filter((n) => n.id !== id));

  return (
    <AdminPage
      title="Notifications"
      subtitle={`${items.filter((n) => n.status === "scheduled").length} scheduled · ${items.filter((n) => n.status === "draft").length} drafts. Push, in-app and email messages.`}
      actions={
        <>
          <div className="hidden md:block">
            <StateSwitcher value={state} onChange={setState} />
          </div>
          <Button size="sm" onClick={() => setCreate(true)}>
            <Plus />
            Create
          </Button>
        </>
      }
    >
      <div
        className="no-scrollbar mb-4 flex gap-2 overflow-x-auto pb-1"
        role="tablist"
        aria-label="Notification status"
      >
        {filters.map((f) => (
          <button
            key={f.value}
            role="tab"
            aria-selected={filter === f.value}
            onClick={() => {
              setFilter(f.value);
              setPage(1);
            }}
            className={cn(
              "press shrink-0 rounded-full px-3.5 py-1.5 text-sm",
              filter === f.value
                ? "bg-foreground font-medium text-background"
                : "bg-surface text-muted-foreground",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {s === "loading" ? (
        <ListSkeleton rows={8} avatar={false} />
      ) : s === "error" ? (
        <ErrorState onRetry={() => setState("ready")} />
      ) : slice.length === 0 ? (
        <SectionCard>
          <div className="py-10 text-center">
            <p className="font-medium">
              {filter === "draft"
                ? "No drafts"
                : filter === "scheduled"
                  ? "Nothing scheduled"
                  : "No notifications"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Create one to reach players in the feed and in their inbox.
            </p>
            <Button className="mt-5" variant="secondary" onClick={() => setCreate(true)}>
              <Plus />
              Create notification
            </Button>
          </div>
        </SectionCard>
      ) : (
        <>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
            {slice.map((n) => (
              <li key={n.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <button
                  className="press flex min-w-0 flex-1 items-center gap-3 text-left"
                  onClick={() => setPreview(n)}
                  aria-label={`Preview ${n.title}`}
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-2">
                    {n.status === "scheduled" ? (
                      <CalendarClock className="size-4 text-muted-foreground" strokeWidth={1.75} />
                    ) : (
                      <Bell className="size-4 text-muted-foreground" strokeWidth={1.75} />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{n.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">{n.body}</span>
                  </span>
                </button>
                <span className="hidden w-32 shrink-0 text-xs text-muted-foreground lg:block">
                  {n.audience}
                </span>
                <span className="hidden w-20 shrink-0 text-xs text-muted-foreground capitalize md:block">
                  {n.channel}
                </span>
                <span className="w-32 shrink-0 text-xs text-muted-foreground tabular">
                  {n.when}
                </span>
                {n.status === "sent" && n.delivered ? (
                  <span className="w-28 shrink-0 text-xs text-muted-foreground tabular">
                    {fmt(n.delivered)} · {Math.round(((n.opened ?? 0) / n.delivered) * 100)}% open
                  </span>
                ) : (
                  <span className="w-28 shrink-0 text-xs text-muted-foreground">—</span>
                )}
                <StatusBadge tone={statusTone(n.status)}>{n.status}</StatusBadge>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label={`Actions for ${n.title}`}>
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setPreview(n)}>Open preview</DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        setItems((list) => [
                          {
                            ...n,
                            id: `N-${Math.floor(Math.random() * 900) + 400}`,
                            title: `${n.title} (copy)`,
                            status: "draft",
                            when: "Not scheduled",
                            delivered: undefined,
                            opened: undefined,
                          },
                          ...list,
                        ]);
                        toast.success("Draft duplicated");
                      }}
                    >
                      <Copy />
                      Duplicate
                    </DropdownMenuItem>
                    {n.status === "scheduled" && (
                      <DropdownMenuItem
                        onClick={() => {
                          setItems((list) =>
                            list.map((x) =>
                              x.id === n.id
                                ? {
                                    ...x,
                                    status: "sent",
                                    when: "just now",
                                    delivered: 412890,
                                    opened: 189443,
                                  }
                                : x,
                            ),
                          );
                          toast.success("Notification sent");
                        }}
                      >
                        <Send />
                        Send now
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-destructive" onClick={() => setConfirm(n)}>
                      <Trash2 />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            ))}
          </ul>
          <Pager
            page={page}
            pages={pages}
            setPage={setPage}
            total={total}
            perPage={perPage}
            label="notifications"
          />
        </>
      )}

      <CreateNotification
        open={create}
        onOpenChange={setCreate}
        onCreate={(n) => {
          setItems((list) => [n, ...list]);
          toast.success(
            n.status === "scheduled"
              ? `Scheduled for ${n.when}`
              : n.status === "sent"
                ? "Notification sent"
                : "Draft saved",
          );
        }}
      />

      {/* Notification preview */}
      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-h-[88dvh] max-w-md overflow-y-auto">
          {preview && (
            <>
              <DialogHeader>
                <DialogTitle>Notification preview</DialogTitle>
                <DialogDescription>
                  How this looks on a phone lock screen and in the inbox.
                </DialogDescription>
              </DialogHeader>
              <div className="rounded-2xl border border-glass-border bg-surface p-4">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="flex size-6 items-center justify-center rounded-md bg-surface-2">
                    <Bell className="size-3" />
                  </span>
                  onemore · now
                </div>
                <p className="mt-2 text-sm font-semibold">{preview.title}</p>
                <p className="text-sm text-muted-foreground">{preview.body}</p>
              </div>
              <dl className="divide-y divide-border rounded-xl border border-border bg-surface px-4 py-1">
                <MetaRow label="Status">
                  <StatusBadge tone={statusTone(preview.status)}>{preview.status}</StatusBadge>
                </MetaRow>
                <MetaRow label="Audience">{preview.audience}</MetaRow>
                <MetaRow label="Channel">
                  <span className="capitalize">{preview.channel}</span>
                </MetaRow>
                <MetaRow label="When">{preview.when}</MetaRow>
                {preview.delivered && (
                  <MetaRow label="Delivered">
                    {fmt(preview.delivered)} ·{" "}
                    {Math.round(((preview.opened ?? 0) / preview.delivered) * 100)}% opened
                  </MetaRow>
                )}
              </dl>
              <DialogFooter className="gap-2">
                <Button variant="secondary" onClick={() => setPreview(null)}>
                  Close
                </Button>
                {preview.status !== "sent" && (
                  <Button
                    onClick={() => {
                      setItems((list) =>
                        list.map((x) =>
                          x.id === preview.id
                            ? {
                                ...x,
                                status: "sent",
                                when: "just now",
                                delivered: 412890,
                                opened: 189443,
                              }
                            : x,
                        ),
                      );
                      setPreview(null);
                      toast.success("Notification sent");
                    }}
                  >
                    <Send />
                    Send now
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Delete this notification?"
        description={`"${confirm?.title}" will be removed from the schedule.`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          if (confirm) {
            remove(confirm.id);
            toast.success("Notification deleted");
          }
          setConfirm(null);
        }}
      />
    </AdminPage>
  );
}

function CreateNotification({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreate: (n: AdminNotification) => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState(audiences[0]);
  const [channel, setChannel] = useState<AdminNotification["channel"]>("push");
  const [scheduled, setScheduled] = useState(false);
  const [when, setWhen] = useState("2026-10-06T18:00");

  const reset = () => {
    setTitle("");
    setBody("");
    setAudience(audiences[0]);
    setChannel("push");
    setScheduled(false);
  };

  const submit = (status: AdminNotification["status"]) => {
    if (!title.trim()) {
      toast.error("Add a title first");
      return;
    }
    onCreate({
      id: `N-${Math.floor(Math.random() * 900) + 400}`,
      title: title.trim(),
      body: body.trim() || "No body text yet.",
      audience,
      channel,
      status: scheduled && status !== "draft" ? "scheduled" : status,
      when:
        status === "draft"
          ? "Not scheduled"
          : scheduled
            ? new Date(when).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })
            : "just now",
      ...(status === "sent" && !scheduled ? { delivered: 412890, opened: 189443 } : {}),
    });
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent className="max-h-[88dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create notification</DialogTitle>
          <DialogDescription>
            Send now, schedule for later, or keep it as a draft.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_260px]">
          <div className="space-y-4">
            <TextField
              id="n-title"
              label="Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Chain: Hard Mode arrives"
              maxLength={64}
            />
            <Field id="n-body" label="Message" hint={`${body.length}/140`}>
              <Textarea
                id="n-body"
                value={body}
                onChange={(e) => setBody(e.target.value.slice(0, 140))}
                placeholder="25 links. No mistakes. Are you in?"
                className="bg-surface-2"
              />
            </Field>
            <Field id="n-audience" label="Audience">
              <select
                id="n-audience"
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
                className="h-11 w-full rounded-lg bg-surface-2 px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {audiences.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </Field>
            <div className="space-y-1.5">
              <Label>Channel</Label>
              <div className="flex gap-2" role="group" aria-label="Channel">
                {(["push", "in-app", "email"] as const).map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-pressed={channel === c}
                    onClick={() => setChannel(c)}
                    className={cn(
                      "press flex-1 rounded-lg border px-3 py-2 text-sm capitalize",
                      channel === c
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border bg-surface-2 text-muted-foreground",
                    )}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-surface-2 px-4 py-3">
              <Label htmlFor="n-sched" className="flex-1 font-normal">
                <span className="block text-sm">Schedule for later</span>
                <span className="text-xs text-muted-foreground">
                  Otherwise it sends immediately
                </span>
              </Label>
              <Switch id="n-sched" checked={scheduled} onCheckedChange={setScheduled} />
            </div>
            {scheduled && (
              <Field id="n-when" label="Send at">
                <input
                  id="n-when"
                  type="datetime-local"
                  value={when}
                  onChange={(e) => setWhen(e.target.value)}
                  className="h-11 w-full rounded-lg bg-surface-2 px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </Field>
            )}
          </div>

          <div className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground">Live preview</p>
            <div className="rounded-2xl border border-glass-border bg-surface p-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="flex size-6 items-center justify-center rounded-md bg-surface-2">
                  <Bell className="size-3" />
                </span>
                onemore · now
              </div>
              <p className="mt-2 text-sm font-semibold">{title || "Notification title"}</p>
              <p className="text-sm text-muted-foreground">
                {body || "Your message appears here."}
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-surface-2 p-4">
              <p className="text-xs font-medium text-muted-foreground">Inbox row</p>
              <div className="mt-2 flex items-center gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface">
                  <Bell className="size-4" />
                </span>
                <span className="min-w-0 text-sm">
                  <span className="block truncate font-medium">
                    {title || "Notification title"}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {audience} · {channel}
                  </span>
                </span>
              </div>
            </div>
            <StatusBadge tone={scheduled ? "warning" : "muted"}>
              {scheduled
                ? `Will send ${new Date(when).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`
                : "Sends immediately"}
            </StatusBadge>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => submit("draft")}>
            Save draft
          </Button>
          <Button variant="secondary" onClick={() => submit("sent")}>
            {scheduled ? (
              <>
                <CalendarClock />
                Schedule send
              </>
            ) : (
              <>
                <Send />
                Send now
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
