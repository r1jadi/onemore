import { Heart, Link2, Mail, MessageCircle, Send, Share2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Avatar } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { comments as seed, fmt, users, type Comment } from "@/lib/mock";
import { cn } from "@/lib/utils";

function CommentRow({
  c,
  reply,
  onReply,
}: {
  c: Comment;
  reply?: boolean;
  onReply?: (u: string) => void;
}) {
  const [liked, setLiked] = useState(false);
  const [open, setOpen] = useState(false);
  return (
    <li className={cn("enter", reply && "ml-12")}>
      <div className="flex gap-3 py-3">
        <Avatar name={c.user} size={reply ? "sm" : "md"} />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">@{c.user}</span> · {c.time}
            {c.score && (
              <span className="ml-2 rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-foreground tabular">
                {fmt(c.score)}
              </span>
            )}
          </p>
          <p className="mt-0.5 text-sm">{c.text}</p>
          <button
            className="mt-1 text-xs font-medium text-muted-foreground hover:text-foreground"
            onClick={() => onReply?.(c.user)}
          >
            Reply
          </button>
        </div>
        <button
          aria-label="Like comment"
          aria-pressed={liked}
          onClick={() => setLiked(!liked)}
          className="press flex flex-col items-center gap-0.5 self-start pt-1 text-xs text-muted-foreground"
        >
          <Heart className={cn("size-4", liked && "fill-primary text-primary")} />
          <span className="tabular">{fmt(c.likes + (liked ? 1 : 0))}</span>
        </button>
      </div>
      {c.replies && !reply && (
        <>
          {!open ? (
            <button
              className="ml-[52px] mb-2 text-xs font-medium text-muted-foreground hover:text-foreground"
              onClick={() => setOpen(true)}
            >
              View {c.replies.length} replies
            </button>
          ) : (
            <ul>
              {c.replies.map((r) => (
                <CommentRow key={r.id} c={r} reply />
              ))}
            </ul>
          )}
        </>
      )}
    </li>
  );
}

export function CommentsSheet({
  open,
  onOpenChange,
  count,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  count: number;
}) {
  const [list, setList] = useState(seed);
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const send = () => {
    if (!text.trim()) return;
    setList([
      {
        id: crypto.randomUUID(),
        user: "rijad",
        text: replyTo ? `@${replyTo} ${text}` : text,
        time: "now",
        likes: 0,
      },
      ...list,
    ]);
    setText("");
    setReplyTo(null);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (o) {
          setLoading(true);
          setTimeout(() => setLoading(false), 450);
        }
      }}
    >
      <SheetContent
        side="bottom"
        className="mx-auto flex h-[78dvh] max-w-xl flex-col rounded-t-2xl border-glass-border p-0"
      >
        <SheetHeader className="border-b border-border px-4 py-3 text-center">
          <SheetTitle className="text-sm">{fmt(count)} comments</SheetTitle>
          <SheetDescription className="sr-only">Comments on this game</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-4">
          {loading ? (
            <div className="space-y-5 py-4" aria-busy="true">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex gap-3">
                  <Skeleton className="size-10 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-3.5 w-4/5" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <ul>
              {list.map((c) => (
                <CommentRow key={c.id} c={c} onReply={setReplyTo} />
              ))}
            </ul>
          )}
        </div>
        <form
          className="safe-bottom border-t border-border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          {replyTo && (
            <p className="mb-2 text-xs text-muted-foreground">
              Replying to @{replyTo}{" "}
              <button type="button" className="ml-1 underline" onClick={() => setReplyTo(null)}>
                Cancel
              </button>
            </p>
          )}
          <Label htmlFor="comment" className="sr-only">
            Add a comment
          </Label>
          <div className="flex items-center gap-2">
            <Avatar name="rijad" size="sm" />
            <input
              id="comment"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Add a comment"
              className="h-10 flex-1 rounded-full bg-surface-2 px-4 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button
              type="submit"
              size="icon"
              aria-label="Post comment"
              disabled={!text.trim()}
              className="rounded-full"
            >
              <Send />
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

export function ShareSheet({
  open,
  onOpenChange,
  title,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
}) {
  const [sent, setSent] = useState<string[]>([]);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="mx-auto max-w-xl rounded-t-2xl border-glass-border pb-8"
      >
        <SheetHeader>
          <SheetTitle>Share {title}</SheetTitle>
          <SheetDescription>Send to friends or copy a link.</SheetDescription>
        </SheetHeader>
        <div className="no-scrollbar flex gap-4 overflow-x-auto px-4 py-2">
          {users.slice(0, 6).map((u) => {
            const on = sent.includes(u.username);
            return (
              <button
                key={u.username}
                onClick={() => setSent(on ? sent : [...sent, u.username])}
                className="press flex w-16 shrink-0 flex-col items-center gap-1.5"
              >
                <Avatar name={u.username} size="lg" className={cn(on && "ring-2 ring-primary")} />
                <span className="w-full truncate text-xs text-muted-foreground">
                  {on ? "Sent" : u.name.split(" ")[0]}
                </span>
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-3 gap-2 px-4 pt-2">
          <Button
            variant="secondary"
            className="h-16 flex-col gap-1 text-xs"
            onClick={() => {
              navigator.clipboard?.writeText(location.href);
              toast.success("Link copied");
            }}
          >
            <Link2 />
            Copy link
          </Button>
          <Button
            variant="secondary"
            className="h-16 flex-col gap-1 text-xs"
            onClick={() => toast("Opening messages")}
          >
            <MessageCircle />
            Message
          </Button>
          <Button
            variant="secondary"
            className="h-16 flex-col gap-1 text-xs"
            onClick={() => toast("Opening email")}
          >
            <Mail />
            Email
          </Button>
        </div>
        <div className="px-4 pt-3">
          <Button
            className="w-full"
            variant="outline"
            onClick={() => {
              navigator.share?.({ title, url: location.href }).catch(() => {});
            }}
          >
            <Share2 />
            More options
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
