import { createFileRoute, Link } from "@tanstack/react-router";
import { Users } from "lucide-react";
import * as z from "zod";
import {
  Avatar,
  EmptyState,
  FollowButton,
  ListSkeleton,
  Page,
  PageHeader,
  UserName,
  useMockLoad,
} from "@/components/common";
import { users } from "@/lib/mock";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/u/$username/connections")({
  validateSearch: z.object({ tab: z.enum(["followers", "following"]).optional() }),
  head: ({ params }) => ({
    meta: [
      { title: `@${params.username} connections — onemore` },
      { name: "description", content: `Followers and following of @${params.username}.` },
      { property: "og:title", content: `@${params.username} connections` },
      { property: "og:description", content: `Followers and following of @${params.username}.` },
    ],
  }),
  component: Connections,
});

function Connections() {
  const { username } = Route.useParams();
  const { tab = "followers" } = Route.useSearch();
  const loading = useMockLoad();
  const list = tab === "followers" ? users : users.filter((u) => u.isFollowing);
  return (
    <Page>
      <PageHeader back title={`@${username}`} />
      <div className="flex border-b border-border text-sm" role="tablist">
        {(["followers", "following"] as const).map((t) => (
          <Link
            key={t}
            to="/u/$username/connections"
            params={{ username }}
            search={{ tab: t }}
            role="tab"
            aria-selected={tab === t}
            className={cn(
              "-mb-px flex-1 border-b-2 py-3 text-center capitalize",
              tab === t
                ? "border-foreground font-medium"
                : "border-transparent text-muted-foreground",
            )}
          >
            {t}
          </Link>
        ))}
      </div>
      {loading ? (
        <ListSkeleton />
      ) : list.length === 0 ? (
        <EmptyState icon={Users} title="No one here yet" />
      ) : (
        <ul>
          {list.map((u) => (
            <li key={u.username} className="enter flex items-center gap-3 px-4 py-3 md:px-0">
              <Link
                to="/u/$username"
                params={{ username: u.username }}
                className="flex min-w-0 flex-1 items-center gap-3"
              >
                <Avatar name={u.username} />
                <div className="min-w-0 text-sm">
                  <UserName username={u.username} verified={u.verified} />
                  <p className="truncate text-xs text-muted-foreground">{u.name}</p>
                </div>
              </Link>
              <FollowButton initial={u.isFollowing} />
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
