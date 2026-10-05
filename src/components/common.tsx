import { Link, useRouter } from "@tanstack/react-router";
import { AlertTriangle, ArrowLeft, BadgeCheck, Inbox, RotateCw } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { fmt } from "@/lib/mock";

export function PageHeader({ title, back, actions, subtitle }: { title: string; back?: boolean; actions?: ReactNode; subtitle?: string }) {
  const router = useRouter();
  return (
    <header className="sticky top-0 z-30 glass border-x-0 border-t-0 md:static md:border-0 md:bg-transparent md:backdrop-blur-none">
      <div className="flex h-14 items-center gap-2 px-4 md:h-auto md:px-0 md:pt-8 md:pb-6">
        {back && (
          <Button variant="ghost" size="icon" aria-label="Go back" onClick={() => router.history.back()} className="-ml-2">
            <ArrowLeft />
          </Button>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold md:text-2xl">{title}</h1>
          {subtitle && <p className="hidden text-sm text-muted-foreground md:block">{subtitle}</p>}
        </div>
        {actions}
      </div>
    </header>
  );
}

export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-3xl pb-28 md:px-8 md:pb-12", className)}>{children}</div>;
}

export function Avatar({ name, size = "md", className }: { name: string; size?: "sm" | "md" | "lg" | "xl"; className?: string }) {
  const s = { sm: "size-8 text-xs", md: "size-10 text-sm", lg: "size-14 text-base", xl: "size-24 text-2xl" }[size];
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center rounded-full bg-surface-2 font-semibold text-foreground/90 ring-1 ring-glass-border", s, className)} aria-hidden>
      {name.replace(/[^a-z]/gi, "").slice(0, 2).toUpperCase()}
    </span>
  );
}

export function UserName({ username, verified }: { username: string; verified?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 font-medium">
      @{username}
      {verified && <BadgeCheck className="size-4 text-info" aria-label="Verified" />}
    </span>
  );
}

export function FollowButton({ initial = false, size = "sm" }: { initial?: boolean; size?: "sm" | "default" }) {
  const [on, setOn] = useState(initial);
  return (
    <Button size={size} variant={on ? "secondary" : "default"} aria-pressed={on} onClick={() => setOn(!on)} className="min-w-24">
      {on ? "Following" : "Follow"}
    </Button>
  );
}

export function Stat({ value, label, to }: { value: number | string; label: string; to?: string }) {
  const inner = (
    <>
      <span className="block font-semibold tabular">{typeof value === "number" ? fmt(value) : value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </>
  );
  return to ? <Link to={to} className="press text-center">{inner}</Link> : <div className="text-center">{inner}</div>;
}

export function EmptyState({ icon: Icon = Inbox, title, body, action }: { icon?: typeof Inbox; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="enter flex flex-col items-center px-6 py-16 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-surface-2"><Icon className="size-5 text-muted-foreground" /></div>
      <p className="font-medium">{title}</p>
      {body && <p className="mt-1 max-w-xs text-sm text-muted-foreground">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ onRetry, title = "Couldn't load this" }: { onRetry?: () => void; title?: string }) {
  return (
    <div className="enter flex flex-col items-center px-6 py-16 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-destructive/15"><AlertTriangle className="size-5 text-destructive" /></div>
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">Check your connection and try again.</p>
      <Button variant="secondary" className="mt-5" onClick={onRetry}><RotateCw /> Retry</Button>
    </div>
  );
}

export function ListSkeleton({ rows = 6, avatar = true }: { rows?: number; avatar?: boolean }) {
  return (
    <div className="divide-y divide-border" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3 md:px-0">
          {avatar && <Skeleton className="size-10 rounded-full" />}
          <div className="flex-1 space-y-2"><Skeleton className="h-3.5 w-1/3" /><Skeleton className="h-3 w-2/3" /></div>
          <Skeleton className="h-8 w-16" />
        </div>
      ))}
    </div>
  );
}

export function GridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 px-4 md:px-0 lg:grid-cols-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="space-y-2"><Skeleton className="aspect-[4/5] w-full rounded-xl" /><Skeleton className="h-3.5 w-2/3" /><Skeleton className="h-3 w-1/3" /></div>
      ))}
    </div>
  );
}

/** Simulates loading for prototype screens so skeletons are visible. */
export function useMockLoad(ms = 500) {
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setLoading(false), ms);
    return () => clearTimeout(t);
  }, [ms]);
  return loading;
}

export function Section({ title, action, children, className }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("mt-6", className)}>
      <div className="mb-3 flex items-baseline justify-between px-4 md:px-0">
        <h2 className="text-base font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function StateSwitcher({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-1 rounded-lg bg-surface p-1 text-xs" role="group" aria-label="Preview state">
      {["ready", "loading", "empty", "error"].map((s) => (
        <button key={s} onClick={() => onChange(s)} aria-pressed={value === s} className={cn("press rounded-md px-2 py-1 capitalize", value === s ? "bg-surface-2 text-foreground" : "text-muted-foreground")}>
          {s}
        </button>
      ))}
    </div>
  );
}
