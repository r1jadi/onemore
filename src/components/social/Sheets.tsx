import { Link2, Mail, MessageCircle, Send } from "lucide-react";
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
import { getAuthState } from "@/lib/auth/session";
import { avatarUrl, getProfileState } from "@/lib/users/profile";

/**
 * Comments are not implemented: no service stores them, and the gateway
 * answers the group with 501/503. The sheet says so honestly instead of
 * showing fixture threads or posting as a hardcoded user.
 */
export function CommentsSheet({
  open,
  onOpenChange,
  count,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /**
   * The number of comments, when something real can say. Omitted by every
   * catalogue screen: no service stores comments yet, so the header falls back to
   * the bare word rather than a count nobody measured.
   */
  count?: number;
}) {
  const auth = getAuthState();
  const profile = getProfileState();
  const avatar = profile.status === "ready" ? avatarUrl(profile.profile) : undefined;
  const name = profile.status === "ready" ? profile.profile.username : "";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="mx-auto flex h-[78dvh] max-w-xl flex-col rounded-t-2xl border-glass-border p-0"
      >
        <SheetHeader className="border-b border-border px-4 py-3 text-center">
          <SheetTitle className="text-sm">
            {count === undefined ? "Comments" : `${count} comments`}
          </SheetTitle>
          <SheetDescription className="sr-only">Comments on this game</SheetDescription>
        </SheetHeader>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <p className="font-medium">Comments aren&apos;t available yet</p>
          <p className="text-sm text-muted-foreground">
            There is no comment backend, so threads can&apos;t be loaded or posted without inventing
            them.
          </p>
          {auth.status !== "authenticated" && (
            <p className="text-xs text-muted-foreground">Sign in to comment once enabled.</p>
          )}
        </div>
        <form
          className="safe-bottom border-t border-border p-3"
          onSubmit={(e) => e.preventDefault()}
        >
          <Label htmlFor="comment" className="sr-only">
            Add a comment
          </Label>
          <div className="flex items-center gap-2">
            <Avatar name={name} src={avatar} size="sm" />
            <input
              id="comment"
              disabled
              placeholder="Comments are unavailable"
              aria-disabled="true"
              className="h-10 flex-1 rounded-full bg-surface-2 px-4 text-sm opacity-60 outline-none"
            />
            <Button
              type="submit"
              size="icon"
              aria-label="Post comment"
              disabled
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
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="mx-auto max-w-xl rounded-t-2xl border-glass-border pb-8"
      >
        <SheetHeader>
          <SheetTitle>Share {title}</SheetTitle>
          <SheetDescription>Copy a link or use your device share sheet.</SheetDescription>
        </SheetHeader>
        <div className="grid grid-cols-3 gap-2 px-4 pt-2">
          <Button
            variant="secondary"
            className="h-16 flex-col gap-1 text-xs"
            onClick={() => {
              try {
                void navigator.clipboard?.writeText(window.location.href);
                toast.success("Link copied");
              } catch {
                toast.error("Couldn't copy the link.");
              }
            }}
          >
            <Link2 />
            Copy link
          </Button>
          <Button
            variant="secondary"
            className="h-16 flex-col gap-1 text-xs"
            onClick={() => toast("Direct messages are not implemented.")}
          >
            <MessageCircle />
            Message
          </Button>
          <Button
            variant="secondary"
            className="h-16 flex-col gap-1 text-xs"
            onClick={() => {
              window.location.href = `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(window.location.href)}`;
            }}
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
              try {
                void navigator.share?.({ title, url: window.location.href }).catch(() => undefined);
              } catch {
                // Share sheet unavailable; copy link above is the fallback.
              }
            }}
          >
            More options
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
