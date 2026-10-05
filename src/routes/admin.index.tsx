import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  ClipboardCheck,
  Flag,
  Gamepad2,
  Play,
  Timer,
  Users,
} from "lucide-react";
import { useState } from "react";
import { TrendArea } from "@/components/admin/charts";
import { AdminPage, SectionCard, StatCard, StatusBadge, statusTone } from "@/components/admin/ui";
import { Avatar, ListSkeleton, StateSwitcher, useMockLoad } from "@/components/common";
import { Skeleton } from "@/components/ui/skeleton";
import {
  adminActivity,
  analyticsSeries,
  overviewStats,
  popularGames,
  systemServices,
} from "@/lib/admin-mock";
import { fmt } from "@/lib/mock";

export const Route = createFileRoute("/admin/")({
  head: () => ({
    meta: [{ title: "Admin overview — onemore" }, { name: "robots", content: "noindex" }],
  }),
  component: Overview,
});

const kindIcon = {
  user: Users,
  game: Gamepad2,
  report: Flag,
  comment: Activity,
  system: Activity,
} as const;

function Overview() {
  const loading = useMockLoad(600);
  const [state, setState] = useState("ready");
  const s = loading ? "loading" : state;

  const stats = [
    {
      label: "Total users",
      value: fmt(overviewStats.totalUsers),
      delta: overviewStats.deltas.totalUsers,
      tone: "success" as const,
      icon: Users,
    },
    {
      label: "Active today",
      value: fmt(overviewStats.activeUsers),
      delta: overviewStats.deltas.activeUsers,
      tone: "success" as const,
      icon: Activity,
    },
    {
      label: "Games",
      value: String(overviewStats.games),
      delta: "+4 this week",
      tone: "muted" as const,
      icon: Gamepad2,
    },
    {
      label: "Games played",
      value: fmt(overviewStats.gamesPlayed),
      delta: overviewStats.deltas.gamesPlayed,
      tone: "success" as const,
      icon: Play,
    },
    {
      label: "Avg session",
      value: overviewStats.avgSession,
      delta: overviewStats.deltas.avgSession,
      tone: "muted" as const,
      icon: Timer,
    },
    {
      label: "Open reports",
      value: String(overviewStats.openReports),
      delta: overviewStats.deltas.openReports,
      tone: "warning" as const,
      icon: Flag,
    },
  ];

  const queue = [
    {
      to: "/admin/reports",
      label: "Open reports",
      value: overviewStats.openReports,
      hint: "3 high severity",
      icon: Flag,
      tone: "warning" as const,
    },
    {
      to: "/admin/review",
      label: "Games in review",
      value: overviewStats.pendingReview,
      hint: "Oldest waits 1 day",
      icon: ClipboardCheck,
      tone: "info" as const,
    },
    {
      to: "/admin/comments",
      label: "Reported comments",
      value: 4,
      hint: "1 already hidden",
      icon: AlertTriangle,
      tone: "destructive" as const,
    },
  ];

  return (
    <AdminPage
      title="Overview"
      subtitle="Platform health, moderation queue and activity at a glance."
      actions={
        <div className="hidden md:block">
          <StateSwitcher value={state} onChange={setState} />
        </div>
      }
    >
      {s === "error" ? (
        <SectionCard>
          <p className="py-10 text-center text-sm text-muted-foreground">
            Couldn’t load the overview.{" "}
            <button className="underline" onClick={() => setState("ready")}>
              Retry
            </button>
          </p>
        </SectionCard>
      ) : s === "empty" ? (
        <SectionCard>
          <p className="py-10 text-center text-sm text-muted-foreground">
            No activity recorded yet.
          </p>
        </SectionCard>
      ) : (
        <div className="space-y-4 md:space-y-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {s === "loading"
              ? Array.from({ length: 6 }, (_, i) => (
                  <Skeleton key={i} className="h-[104px] rounded-xl" />
                ))
              : stats.map((st) => (
                  <StatCard
                    key={st.label}
                    label={st.label}
                    value={st.value}
                    delta={st.delta}
                    tone={st.tone}
                    icon={st.icon}
                  />
                ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <SectionCard
              title="Activity over time"
              className="lg:col-span-2"
              action={<span className="text-xs text-muted-foreground">Last 14 days · plays</span>}
            >
              {s === "loading" ? (
                <Skeleton className="h-56 w-full md:h-64" />
              ) : (
                <TrendArea
                  data={analyticsSeries}
                  series={[{ key: "plays", label: "Games played", color: "var(--chart-1)" }]}
                />
              )}
            </SectionCard>
            <SectionCard title="Moderation queue" bodyClassName="p-0">
              <ul className="divide-y divide-border">
                {queue.map((q) => (
                  <li key={q.label}>
                    <Link
                      to={q.to}
                      className="press flex items-center gap-3 px-4 py-4 hover:bg-surface-2"
                    >
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-2">
                        <q.icon className="size-4 text-muted-foreground" strokeWidth={1.75} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{q.label}</span>
                        <span className="block text-xs text-muted-foreground">{q.hint}</span>
                      </span>
                      <StatusBadge tone={q.tone}>{q.value}</StatusBadge>
                      <ArrowUpRight className="size-4 shrink-0 text-muted-foreground" />
                    </Link>
                  </li>
                ))}
              </ul>
            </SectionCard>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <SectionCard title="Recent activity" className="lg:col-span-2" bodyClassName="p-0">
              {s === "loading" ? (
                <ListSkeleton rows={5} />
              ) : (
                <ul className="divide-y divide-border">
                  {adminActivity.slice(0, 6).map((a) => {
                    const Icon = kindIcon[a.kind];
                    return (
                      <li key={a.id} className="flex items-center gap-3 px-4 py-3">
                        <Avatar name={a.actor} size="sm" />
                        <p className="min-w-0 flex-1 text-sm">
                          <span className="font-medium">@{a.actor}</span>{" "}
                          <span className="text-muted-foreground">{a.action}</span>{" "}
                          {a.subject && <span className="font-medium">{a.subject}</span>}
                          <span className="text-muted-foreground"> · {a.time}</span>
                        </p>
                        <Icon
                          className="size-4 shrink-0 text-muted-foreground"
                          strokeWidth={1.75}
                        />
                      </li>
                    );
                  })}
                </ul>
              )}
            </SectionCard>
            <SectionCard title="Top games today" bodyClassName="p-4">
              {s === "loading" ? (
                <ListSkeleton rows={5} avatar={false} />
              ) : (
                <ul className="space-y-4">
                  {popularGames.slice(0, 5).map((g) => (
                    <li key={g.id}>
                      <div className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="truncate font-medium">{g.title}</span>
                        <span className="shrink-0 font-mono text-xs text-muted-foreground tabular">
                          {fmt(g.plays)}
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${(g.plays / popularGames[0].plays) * 100}%` }}
                        />
                      </div>
                    </li>
                  ))}
                  <li>
                    <Link
                      to="/admin/analytics"
                      className="text-sm text-muted-foreground hover:text-foreground"
                    >
                      Full analytics →
                    </Link>
                  </li>
                </ul>
              )}
            </SectionCard>
          </div>

          <SectionCard
            title="System overview"
            action={<span className="text-xs text-muted-foreground">Updated 1m ago</span>}
            bodyClassName="p-0"
          >
            {s === "loading" ? (
              <ListSkeleton rows={6} avatar={false} />
            ) : (
              <ul className="divide-y divide-border">
                {systemServices.map((svc) => (
                  <li
                    key={svc.name}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3"
                  >
                    <span className="min-w-40 flex-1 text-sm font-medium">{svc.name}</span>
                    <span className="w-24 text-xs text-muted-foreground tabular">
                      {svc.uptime} uptime
                    </span>
                    <span className="w-20 font-mono text-xs text-muted-foreground tabular">
                      {svc.latency}
                    </span>
                    <span className="hidden min-w-0 flex-1 truncate text-xs text-muted-foreground lg:block">
                      {svc.note}
                    </span>
                    <StatusBadge
                      tone={
                        svc.status === "operational"
                          ? statusTone("operational")
                          : svc.status === "degraded"
                            ? "warning"
                            : "info"
                      }
                    >
                      {svc.status}
                    </StatusBadge>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>
      )}
    </AdminPage>
  );
}
