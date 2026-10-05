import { Link, useRouterState } from "@tanstack/react-router";
import {
  Bell,
  Bookmark,
  Clock,
  Compass,
  Home,
  Search,
  Settings,
  Shield,
  Trophy,
  User,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";
import { Logo } from "./Logo";
import { cn } from "@/lib/utils";
import { notifications } from "@/lib/mock";

const mobile = [
  { to: "/", label: "Home", icon: Home },
  { to: "/explore", label: "Explore", icon: Compass },
  { to: "/leaderboards", label: "Ranks", icon: Trophy },
  { to: "/notifications", label: "Inbox", icon: Bell },
  { to: "/profile", label: "Profile", icon: User },
] as const;

const desktop = [
  { to: "/", label: "For You", icon: Home },
  { to: "/following", label: "Following", icon: Users },
  { to: "/explore", label: "Explore", icon: Compass },
  { to: "/search", label: "Search", icon: Search },
  { to: "/leaderboards", label: "Leaderboards", icon: Trophy },
  { to: "/notifications", label: "Notifications", icon: Bell },
  { to: "/saved", label: "Saved", icon: Bookmark },
  { to: "/recent", label: "Recently played", icon: Clock },
  { to: "/profile", label: "Profile", icon: User },
] as const;

const unread = notifications.filter((n) => n.unread).length;

export function AppShell({ children }: { children: ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const isActive = (to: string) => (to === "/" ? path === "/" : path.startsWith(to));
  const feed = path === "/" || path === "/following";

  return (
    <div className="min-h-dvh md:flex">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar px-3 py-5 md:flex lg:w-64">
        <Link to="/" className="mb-6 px-3" aria-label="onemore home">
          <Logo />
        </Link>
        <nav className="flex flex-1 flex-col gap-0.5" aria-label="Main">
          {desktop.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className={cn(
                "press flex h-10 items-center gap-3 rounded-lg px-3 text-sm text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-foreground",
                isActive(to) && "bg-sidebar-accent font-medium text-sidebar-foreground",
              )}
            >
              <Icon className="size-[18px]" strokeWidth={1.75} />
              <span className="flex-1">{label}</span>
              {to === "/notifications" && unread > 0 && (
                <span className="rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground tabular">
                  {unread}
                </span>
              )}
            </Link>
          ))}
        </nav>
        <div className="flex flex-col gap-0.5 border-t border-sidebar-border pt-3">
          <Link
            to="/settings"
            className={cn(
              "press flex h-10 items-center gap-3 rounded-lg px-3 text-sm text-sidebar-foreground/75 hover:bg-sidebar-accent",
              isActive("/settings") && "bg-sidebar-accent text-sidebar-foreground",
            )}
          >
            <Settings className="size-[18px]" strokeWidth={1.75} />
            Settings
          </Link>
          <Link
            to="/admin"
            className={cn(
              "press flex h-10 items-center gap-3 rounded-lg px-3 text-sm text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-foreground",
              isActive("/admin") && "bg-sidebar-accent text-sidebar-foreground",
            )}
          >
            <Shield className="size-[18px]" strokeWidth={1.75} />
            Admin
          </Link>
          <Link
            to="/welcome"
            className="px-3 pt-2 text-xs text-muted-foreground hover:text-foreground"
          >
            Sign-in screens
          </Link>
        </div>
      </aside>

      <main className="min-w-0 flex-1">{children}</main>

      <nav
        aria-label="Main"
        className={cn(
          "fixed inset-x-0 bottom-0 z-40 safe-bottom md:hidden",
          feed ? "bg-background/80 backdrop-blur-xl" : "glass border-x-0 border-b-0",
        )}
      >
        <ul className="mx-auto grid h-16 max-w-md grid-cols-5">
          {mobile.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <Link
                to={to}
                className={cn(
                  "press relative flex h-full flex-col items-center justify-center gap-1 text-[11px] text-muted-foreground",
                  isActive(to) && "text-foreground",
                )}
              >
                <Icon className="size-[22px]" strokeWidth={isActive(to) ? 2.1 : 1.75} />
                {label}
                {to === "/notifications" && unread > 0 && (
                  <span
                    className="absolute top-2.5 left-1/2 ml-2 size-2 rounded-full bg-primary"
                    aria-label={`${unread} unread`}
                  />
                )}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
