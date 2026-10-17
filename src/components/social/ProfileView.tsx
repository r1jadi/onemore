import { Link } from "@tanstack/react-router";
import { Award, Lock, MoreHorizontal, Settings, Share2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  Avatar,
  EmptyState,
  FollowButton,
  GridSkeleton,
  Page,
  PageHeader,
  Stat,
  UserName,
} from "@/components/common";
import { ShareSheet } from "@/components/social/Sheets";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const tabs = ["Best scores", "Activity", "Saved", "Recent", "Achievements"] as const;

/**
 * The identity this view draws.
 *
 * It is deliberately not the API's `Profile`: one view renders both the
 * signed-in user (from `services/users`) and another player's public page, and
 * only these fields are common to both.
 */
export type ProfileHeader = {
  username: string;
  name: string;
  bio?: string;
  verified?: boolean;
  userId?: string;
  isFollowing?: boolean;
  /** Public URL of the profile picture. Absent renders the account's initials. */
  avatarSrc?: string;
  /**
   * Real counts from the follow graph. A member that is `undefined` renders an
   * em dash, never a zero: an unread value and a measured zero are different
   * answers, and only one of them belongs on screen before the read lands.
   */
  stats?: { followers?: number; following?: number; played?: number };
  /** True while the counts are still being read. */
  statsLoading?: boolean;
  /** A failed count read, shown as text with an optional retry. */
  statsError?: string;
  onRetryStats?: () => void;
  /** When the played count is unknown, hide it rather than showing zero. */
  hidePlayed?: boolean;
};

export function ProfileView({
  user,
  self,
  loading,
  fallback,
}: {
  user: ProfileHeader;
  self?: boolean;
  /**
   * Whether the identity is still being fetched. Callers pass their own state;
   * when omitted the view renders content directly (no simulated loading).
   */
  loading?: boolean;
  /**
   * Drawn instead of the profile body when there is nothing to show yet — signed
   * out, no profile row, or a failed read. The header stays, so the page keeps
   * its shape and the way out (settings, sign in) is always reachable.
   */
  fallback?: ReactNode;
}) {
  const skeleton = loading ?? false;
  const [tab, setTab] = useState<(typeof tabs)[number]>("Best scores");
  const [share, setShare] = useState(false);
  const visible = self ? tabs : tabs.filter((t) => t !== "Saved");

  async function block() {
    try {
      const { blockUsername } = await import("@/lib/settings/blocked");
      await blockUsername(user.username);
      toast.success(`Blocked @${user.username}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't block this account.");
    }
  }

  return (
    <Page>
      <PageHeader
        back={!self}
        // The signed-in header is the display name, which is unknown until the
        // profile arrives; "Your profile" is what the tab and the page title say.
        title={self ? user.name || "Your profile" : `@${user.username}`}
        actions={
          <div className="flex">
            {user.username !== "" && (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Share profile"
                onClick={() => setShare(true)}
              >
                <Share2 />
              </Button>
            )}
            {self ? (
              <Button asChild variant="ghost" size="icon" aria-label="Settings">
                <Link to="/settings">
                  <Settings />
                </Link>
              </Button>
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="More">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() =>
                      toast(
                        "Reporting is reviewed by moderators. Open an issue to report this account.",
                      )
                    }
                  >
                    Report
                  </DropdownMenuItem>
                  <DropdownMenuItem className="text-destructive" onClick={() => void block()}>
                    Block
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        }
      />
      {fallback ? (
        <div className="px-4 md:px-0">{fallback}</div>
      ) : (
        <>
          <div className="px-4 md:px-0">
            {skeleton ? (
              <div className="flex flex-col items-center gap-3 py-4">
                <Skeleton className="size-24 rounded-full" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-48" />
              </div>
            ) : (
              <div className="enter flex flex-col items-center text-center md:flex-row md:items-start md:gap-6 md:text-left">
                <Avatar name={user.username} src={user.avatarSrc} size="xl" />
                <div className="mt-3 flex-1 md:mt-1">
                  <p className="text-lg font-semibold">{user.name}</p>
                  <p className="text-sm text-muted-foreground">
                    <UserName username={user.username} verified={user.verified} />
                  </p>
                  {user.bio && <p className="mt-2 max-w-sm text-sm">{user.bio}</p>}
                  {(user.stats !== undefined || user.statsLoading) && (
                    <div className="mt-4 flex justify-center gap-8 md:justify-start">
                      <Stat
                        value={user.stats?.followers ?? "—"}
                        label="Followers"
                        conn={{ username: user.username, tab: "followers" }}
                      />
                      <Stat
                        value={user.stats?.following ?? "—"}
                        label="Following"
                        conn={{ username: user.username, tab: "following" }}
                      />
                      {!user.hidePlayed && user.stats?.played !== undefined && (
                        <Stat value={user.stats.played} label="Games played" />
                      )}
                    </div>
                  )}
                  {user.statsError && (
                    <p className="mt-2 text-xs text-muted-foreground" role="status">
                      Couldn't load follower counts.{" "}
                      {user.onRetryStats && (
                        <button
                          type="button"
                          className="font-medium text-foreground underline underline-offset-4"
                          onClick={user.onRetryStats}
                        >
                          Retry
                        </button>
                      )}
                    </p>
                  )}
                  <div className="mt-4 flex justify-center gap-2 md:justify-start">
                    {self ? (
                      <>
                        <Button asChild variant="secondary">
                          <Link to="/settings/$section" params={{ section: "profile" }}>
                            Edit profile
                          </Link>
                        </Button>
                        <Button asChild variant="secondary">
                          <Link to="/likes">Likes</Link>
                        </Button>
                      </>
                    ) : (
                      <>
                        <FollowButton
                          userId={user.userId}
                          username={user.username}
                          initial={user.isFollowing}
                          size="default"
                        />
                        <Button
                          variant="secondary"
                          onClick={() => toast("Direct messages are not implemented.")}
                        >
                          Message
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div
            className="no-scrollbar mt-6 flex gap-5 overflow-x-auto border-b border-border px-4 text-sm md:px-0"
            role="tablist"
          >
            {visible.map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={cn(
                  "-mb-px shrink-0 border-b-2 pb-2.5",
                  tab === t
                    ? "border-foreground font-medium"
                    : "border-transparent text-muted-foreground",
                )}
              >
                {t === "Saved" && <Lock className="mr-1 inline size-3" />}
                {t}
              </button>
            ))}
          </div>

          <div className="pt-4">
            {skeleton ? (
              <GridSkeleton count={4} />
            ) : (
              <>
                {tab === "Best scores" && (
                  <EmptyState
                    title="No scores yet"
                    body="Scores appear here once play history is recorded for this account."
                  />
                )}
                {tab === "Activity" && (
                  <EmptyState
                    title="No activity here"
                    body="Recent plays, likes, comments and saves live on the Activity page."
                    action={
                      <Button asChild variant="secondary">
                        <Link to="/activity">View activity</Link>
                      </Button>
                    }
                  />
                )}
                {tab === "Saved" && (
                  <EmptyState
                    title="Nothing saved yet"
                    body="Games you save live on the Saved page."
                    action={
                      <Button asChild variant="secondary">
                        <Link to="/saved">View saved games</Link>
                      </Button>
                    }
                  />
                )}
                {tab === "Recent" && (
                  <EmptyState
                    title="No games played yet"
                    body="Playing a game is not recorded yet."
                  />
                )}
                {tab === "Achievements" && (
                  <EmptyState
                    icon={Award}
                    title="No achievements yet"
                    body="Achievements are not recorded yet, so nothing is shown rather than a sample set."
                  />
                )}
              </>
            )}
          </div>
          <ShareSheet
            open={share}
            onOpenChange={setShare}
            title={`@${user.username}`}
            path={`/u/${user.username}`}
          />
        </>
      )}
    </Page>
  );
}
