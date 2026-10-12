import { Link } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { FeedItem, FeedSkeleton } from "./FeedItem";
import { useMockLoad } from "@/components/common";
import { LogoMark } from "@/components/layout/Logo";
import type { Game } from "@/lib/mock";
import { cn } from "@/lib/utils";

export function Feed({ tab, items }: { tab: "for-you" | "following"; items: Game[] }) {
  const loading = useMockLoad(600);
  return (
    <div className="relative">
      <div className="pointer-events-none fixed inset-x-0 top-0 z-20 md:left-60 lg:left-64">
        <div className="pointer-events-auto mx-auto flex max-w-[460px] items-center justify-between px-4 pt-[max(0.75rem,env(safe-area-inset-top))] md:pt-9">
          <LogoMark className="size-6 md:invisible" />
          <nav className="flex gap-1 rounded-full glass p-1" aria-label="Feed">
            {(
              [
                ["/", "For You", "for-you"],
                ["/following", "Following", "following"],
              ] as const
            ).map(([to, label, key]) => (
              <Link
                key={key}
                to={to}
                className={cn(
                  "press rounded-full px-3.5 py-1.5 text-sm",
                  tab === key
                    ? "bg-foreground text-background font-medium"
                    : "text-muted-foreground",
                )}
              >
                {label}
              </Link>
            ))}
          </nav>
          <Link
            to="/search"
            aria-label="Search"
            className="press flex size-9 items-center justify-center rounded-full glass md:invisible"
          >
            <Search className="size-[18px]" />
          </Link>
        </div>
      </div>
      <div className="no-scrollbar h-dvh snap-y snap-mandatory overflow-y-auto overscroll-contain">
        {loading ? <FeedSkeleton /> : items.map((g) => <FeedItem key={g.id} game={g} />)}
      </div>
    </div>
  );
}
