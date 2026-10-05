import { createFileRoute, Link } from "@tanstack/react-router";
import { Bell, Heart, MessageCircle, Settings, Trophy, UserPlus, Zap } from "lucide-react";
import { useState } from "react";
import { Avatar, EmptyState, ErrorState, FollowButton, ListSkeleton, Page, PageHeader, StateSwitcher, useMockLoad } from "@/components/common";
import { Button } from "@/components/ui/button";
import { getGame, notifications, type Notification } from "@/lib/mock";
import { seo } from "@/lib/seo";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/notifications")({
  head: () => seo("Notifications", "Follows, comments, likes and score updates."),
  component: Notifications,
});

const icon: Record<Notification["type"], typeof Bell> = { like: Heart, follow: UserPlus, comment: MessageCircle, beat: Zap, rank: Trophy, system: Bell };
const filters = ["All", "Scores", "Social", "Comments"];

function Notifications() {
  const loading = useMockLoad();
  const [items, setItems] = useState(notifications);
  const [filter, setFilter] = useState("All");
  const [state, setState] = useState("ready");
  const list = items.filter((n) => filter === "All" || (filter === "Scores" && ["beat", "rank"].includes(n.type)) || (filter === "Social" && ["follow", "like"].includes(n.type)) || (filter === "Comments" && n.type === "comment"));

  return (
    <Page>
      <PageHeader title="Notifications" actions={<><div className="hidden md:block"><StateSwitcher value={state} onChange={setState} /></div><Button variant="ghost" size="sm" onClick={() => setItems(items.map((n) => ({ ...n, unread: false })))}>Mark all read</Button><Button asChild variant="ghost" size="icon" aria-label="Notification settings"><Link to="/settings/$section" params={{ section: "notifications" }}><Settings /></Link></Button></>} />
      <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 pb-2 md:px-0">
        {filters.map((f) => <button key={f} onClick={() => setFilter(f)} aria-pressed={filter === f} className={cn("press shrink-0 rounded-full px-3.5 py-1.5 text-sm", filter === f ? "bg-foreground font-medium text-background" : "bg-surface text-muted-foreground")}>{f}</button>)}
        <Link to="/activity" className="ml-auto shrink-0 self-center text-sm text-muted-foreground hover:text-foreground">Your activity</Link>
      </div>
      {loading || state === "loading" ? <ListSkeleton /> : state === "error" ? <ErrorState onRetry={() => setState("ready")} /> : state === "empty" || list.length === 0 ? <EmptyState icon={Bell} title="You're all caught up" body="New follows, comments and score updates show up here." /> : (
        <ul>
          {list.map((n) => {
            const Icon = icon[n.type];
            return (
              <li key={n.id} className={cn("enter flex items-center gap-3 px-4 py-3 md:rounded-lg md:px-3", n.unread && "bg-surface")}>
                <div className="relative">
                  {n.user ? <Avatar name={n.user} /> : <span className="flex size-10 items-center justify-center rounded-full bg-surface-2"><Icon className="size-4" /></span>}
                  {n.user && <span className="absolute -right-1 -bottom-1 flex size-5 items-center justify-center rounded-full border-2 border-background bg-surface-2"><Icon className="size-2.5" /></span>}
                </div>
                <p className="min-w-0 flex-1 text-sm">
                  {n.user && <Link to="/u/$username" params={{ username: n.user }} className="font-medium">@{n.user} </Link>}
                  <span className={n.user ? "text-muted-foreground" : ""}>{n.text}</span>
                  <span className="text-muted-foreground"> · {n.time}</span>
                </p>
                {n.type === "follow" ? <FollowButton /> : n.game && <Button asChild size="sm" variant={n.type === "beat" ? "default" : "secondary"}><Link to={n.type === "beat" ? "/play/$id" : "/games/$id"} params={{ id: n.game }}>{n.type === "beat" ? "Beat it" : getGame(n.game).title.split(" ")[0]}</Link></Button>}
                {n.unread && <span className="size-2 rounded-full bg-primary" aria-label="Unread" />}
              </li>
            );
          })}
        </ul>
      )}
    </Page>
  );
}
