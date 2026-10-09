import { Link } from "@tanstack/react-router";
import { Award, Lock, MoreHorizontal, Settings, Share2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Avatar, EmptyState, FollowButton, GridSkeleton, Page, PageHeader, Stat, UserName, useMockLoad } from "@/components/common";
import { GameCard, GameRow } from "@/components/game/GameCard";
import { ShareSheet } from "@/components/social/Sheets";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { achievements, fmt, games } from "@/lib/mock";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const tabs = ["Best scores", "Activity", "Saved", "Recent", "Achievements"] as const;

/**
 * The identity this view draws.
 *
 * It is deliberately not the API's `Profile`: one view renders both the
 * signed-in user (from `services/users`) and another player's prototype page, and
 * only these fields are common to both. `stats` is absent for the signed-in user
 * because no scores service exists yet — a follower or games-played count here
 * would have to be invented, so the row is simply not drawn.
 */
export type ProfileHeader = {
  username: string;
  name: string;
  bio?: string;
  verified?: boolean;
  isFollowing?: boolean;
  /** Public URL of the profile picture. Absent renders the account's initials. */
  avatarSrc?: string;
  stats?: { followers: number; following: number; played: number };
};

export function ProfileView({ user, self, loading, fallback }: {
  user: ProfileHeader;
  self?: boolean;
  /**
   * Whether the identity is still being fetched. A real screen passes its own
   * state; without it the prototype's simulated skeleton is used, which is what
   * the prototype-backed pages rely on.
   */
  loading?: boolean;
  /**
   * Drawn instead of the profile body when there is nothing to show yet — signed
   * out, no profile row, or a failed read. The header stays, so the page keeps
   * its shape and the way out (settings, sign in) is always reachable.
   */
  fallback?: ReactNode;
}) {
  const simulated = useMockLoad();
  const skeleton = loading ?? simulated;
  const [tab, setTab] = useState<(typeof tabs)[number]>("Best scores");
  const [share, setShare] = useState(false);
  const visible = self ? tabs : tabs.filter((t) => t !== "Saved");

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
              <Button variant="ghost" size="icon" aria-label="Share profile" onClick={() => setShare(true)}><Share2 /></Button>
            )}
            {self ? (
              <Button asChild variant="ghost" size="icon" aria-label="Settings"><Link to="/settings"><Settings /></Link></Button>
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="More"><MoreHorizontal /></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => toast("Report submitted")}>Report</DropdownMenuItem>
                  <DropdownMenuItem className="text-destructive" onClick={() => toast(`Blocked @${user.username}`)}>Block</DropdownMenuItem>
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
              <div className="flex flex-col items-center gap-3 py-4"><Skeleton className="size-24 rounded-full" /><Skeleton className="h-4 w-32" /><Skeleton className="h-3 w-48" /></div>
            ) : (
              <div className="enter flex flex-col items-center text-center md:flex-row md:items-start md:gap-6 md:text-left">
                <Avatar name={user.username} src={user.avatarSrc} size="xl" />
                <div className="mt-3 flex-1 md:mt-1">
                  <p className="text-lg font-semibold">{user.name}</p>
                  <p className="text-sm text-muted-foreground"><UserName username={user.username} verified={user.verified} /></p>
                  {user.bio && <p className="mt-2 max-w-sm text-sm">{user.bio}</p>}
                  {user.stats && (
                    <div className="mt-4 flex justify-center gap-8 md:justify-start">
                      <Stat value={user.stats.followers} label="Followers" conn={{ username: user.username, tab: "followers" }} />
                      <Stat value={user.stats.following} label="Following" conn={{ username: user.username, tab: "following" }} />
                      <Stat value={user.stats.played} label="Games played" />
                    </div>
                  )}
                  <div className="mt-4 flex justify-center gap-2 md:justify-start">
                    {self ? (
                      <><Button asChild variant="secondary"><Link to="/settings/$section" params={{ section: "profile" }}>Edit profile</Link></Button><Button asChild variant="secondary"><Link to="/likes">Likes</Link></Button></>
                    ) : (
                      <><FollowButton initial={user.isFollowing} size="default" /><Button variant="secondary" onClick={() => toast("Messages are coming soon")}>Message</Button></>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="no-scrollbar mt-6 flex gap-5 overflow-x-auto border-b border-border px-4 text-sm md:px-0" role="tablist">
            {visible.map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cn("-mb-px shrink-0 border-b-2 pb-2.5", tab === t ? "border-foreground font-medium" : "border-transparent text-muted-foreground")}>
                {t === "Saved" && <Lock className="mr-1 inline size-3" />}{t}
              </button>
            ))}
          </div>

          <div className="pt-4">
            {skeleton ? <GridSkeleton count={4} /> : (
              <>
                {tab === "Best scores" && games.filter((g) => g.yourBest).map((g) => (
                  <GameRow key={g.id} game={g} meta={`${g.category} · Top 8%`} action={<span className="font-mono text-sm font-semibold tabular">{fmt(g.yourBest!)}</span>} />
                ))}
                {tab === "Activity" && (
                  <ul className="divide-y divide-border">
                    {[["Scored 2,140 on Stack 10", "2h"], ["Unlocked Perfect chain", "1d"], ["Saved One Move", "2d"], ["Followed @nora.k", "3d"]].map(([t, time]) => (
                      <li key={t} className="flex justify-between px-4 py-3 text-sm md:px-0"><span>{t}</span><span className="text-muted-foreground">{time}</span></li>
                    ))}
                  </ul>
                )}
                {tab === "Saved" && <div className="grid grid-cols-2 gap-3 px-4 md:grid-cols-3 md:px-0">{games.slice(1, 4).map((g) => <GameCard key={g.id} game={g} />)}</div>}
                {tab === "Recent" && (self || (user.stats?.played ?? 0) > 0 ? games.slice(0, 4).map((g) => <GameRow key={g.id} game={g} meta="Played 2h ago" />) : <EmptyState title="No games played yet" />)}
                {tab === "Achievements" && (
                  <div className="grid grid-cols-2 gap-3 px-4 md:grid-cols-3 md:px-0">
                    {achievements.map((a) => (
                      <div key={a.id} className={cn("rounded-xl border border-border p-3", !a.earned && "opacity-50")}>
                        <Award className={cn("size-5", a.earned ? "text-primary" : "text-muted-foreground")} strokeWidth={1.75} />
                        <p className="mt-3 text-sm font-medium">{a.title}</p>
                        <p className="text-xs text-muted-foreground">{a.desc}</p>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
          <ShareSheet open={share} onOpenChange={setShare} title={`@${user.username}`} />
        </>
      )}
    </Page>
  );
}
