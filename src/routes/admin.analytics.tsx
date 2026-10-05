import { createFileRoute } from "@tanstack/react-router";
import { Activity, BarChart3, Gamepad2, Play, Timer, UserCheck } from "lucide-react";
import { useState } from "react";
import { MeterRow, MiniBars, RankedBars, TrendArea } from "@/components/admin/charts";
import { AdminPage, SectionCard, StatCard, StatusBadge } from "@/components/admin/ui";
import { ErrorState, StateSwitcher, useMockLoad } from "@/components/common";
import { Skeleton } from "@/components/ui/skeleton";
import {
  analyticsSeries,
  engagement,
  playsByHour,
  popularGames,
  retention,
} from "@/lib/admin-mock";
import { fmt } from "@/lib/mock";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/analytics")({
  head: () => ({
    meta: [{ title: "Analytics — admin onemore" }, { name: "robots", content: "noindex" }],
  }),
  component: AnalyticsAdmin,
});

const metrics = [
  { key: "users", label: "Users", color: "var(--chart-2)" },
  { key: "sessions", label: "Sessions", color: "var(--chart-1)" },
  { key: "plays", label: "Games played", color: "var(--chart-3)" },
] as const;

function AnalyticsAdmin() {
  const loading = useMockLoad(600);
  const [metric, setMetric] = useState<(typeof metrics)[number]["key"]>("plays");
  const [state, setState] = useState("ready");
  const s = loading ? "loading" : state;
  const active = metrics.find((m) => m.key === metric)!;

  const totals = {
    users: analyticsSeries.reduce((sum, d) => sum + d.users, 0),
    sessions: analyticsSeries.reduce((sum, d) => sum + d.sessions, 0),
    plays: analyticsSeries.reduce((sum, d) => sum + d.plays, 0),
  };

  return (
    <AdminPage
      title="Analytics"
      subtitle="Mock data for the prototype. Numbers update when the real pipeline is connected."
      actions={
        <div className="hidden md:block">
          <StateSwitcher value={state} onChange={setState} />
        </div>
      }
    >
      {s === "error" ? (
        <ErrorState onRetry={() => setState("ready")} />
      ) : (
        <div className="space-y-4 md:space-y-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {s === "loading" ? (
              Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-[104px] rounded-xl" />
              ))
            ) : (
              <>
                <StatCard
                  label="Daily active users"
                  value={fmt(analyticsSeries.at(-1)!.users)}
                  delta="+1.4% week over week"
                  tone="success"
                  icon={UserCheck}
                />
                <StatCard
                  label="Sessions"
                  value={fmt(analyticsSeries.at(-1)!.sessions)}
                  delta="+2.8% week over week"
                  tone="success"
                  icon={Activity}
                />
                <StatCard
                  label="Games played"
                  value={fmt(analyticsSeries.at(-1)!.plays)}
                  delta="+5.8% week over week"
                  tone="success"
                  icon={Play}
                />
                <StatCard
                  label="Avg session"
                  value={engagement.avgSession}
                  delta="-2s week over week"
                  icon={Timer}
                />
                <StatCard
                  label="Sessions per user"
                  value={engagement.sessionsPerUser}
                  delta="+0.2 week over week"
                  tone="success"
                  icon={BarChart3}
                />
                <StatCard
                  label="DAU / MAU"
                  value={engagement.dauMau}
                  delta="Stable"
                  icon={Gamepad2}
                />
              </>
            )}
          </div>

          <SectionCard
            title="Activity over time"
            action={
              <div
                className="flex gap-1 rounded-lg bg-surface-2 p-1 text-xs"
                role="group"
                aria-label="Chart metric"
              >
                {metrics.map((m) => (
                  <button
                    key={m.key}
                    onClick={() => setMetric(m.key)}
                    aria-pressed={metric === m.key}
                    className={cn(
                      "press rounded-md px-2 py-1",
                      metric === m.key ? "bg-surface text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            }
            bodyClassName="p-4"
          >
            {s === "loading" ? (
              <Skeleton className="h-56 w-full md:h-64" />
            ) : (
              <TrendArea
                data={analyticsSeries}
                series={[{ key: active.key, label: active.label, color: active.color }]}
              />
            )}
            <p className="mt-2 text-xs text-muted-foreground tabular">
              Total over 14 days: {fmt(totals[metric])} {active.label.toLowerCase()}
            </p>
          </SectionCard>

          <div className="grid gap-4 lg:grid-cols-3">
            <SectionCard
              title="Retention"
              className="lg:col-span-1"
              action={<span className="text-xs text-muted-foreground">Cohort average</span>}
            >
              {s === "loading" ? (
                <Skeleton className="h-40 w-full" />
              ) : (
                <div className="divide-y divide-border">
                  {retention.map((r) => (
                    <MeterRow key={r.label} label={r.label} value={r.value} hint={r.change} />
                  ))}
                </div>
              )}
              <p className="mt-3 text-xs text-muted-foreground">
                Share of new players who return after signing up.
              </p>
            </SectionCard>

            <SectionCard title="Engagement" className="lg:col-span-2" bodyClassName="p-4">
              {s === "loading" ? (
                <Skeleton className="h-40 w-full" />
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {[
                    { label: "Weekly new users", value: fmt(engagement.weeklyNewUsers) },
                    { label: "Streak keepers", value: fmt(engagement.streakKeepers) },
                    { label: "Creator submissions", value: String(engagement.creatorSubmissions) },
                    { label: "Avg session", value: engagement.avgSession },
                    { label: "Sessions / user", value: engagement.sessionsPerUser },
                    { label: "DAU / MAU", value: engagement.dauMau },
                  ].map((item) => (
                    <div key={item.label} className="rounded-xl bg-surface-2 p-3">
                      <p className="text-xs text-muted-foreground">{item.label}</p>
                      <p className="mt-1 font-mono text-lg font-semibold tabular">{item.value}</p>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard
              title="Popular games"
              action={<span className="text-xs text-muted-foreground">Plays · 7 days</span>}
            >
              {s === "loading" ? (
                <Skeleton className="h-60 w-full" />
              ) : (
                <>
                  <RankedBars
                    data={popularGames.map((g) => ({
                      ...g,
                      short: g.title.length > 14 ? `${g.title.slice(0, 13)}…` : g.title,
                    }))}
                    xKey="short"
                    valueKey="plays"
                    label="Plays"
                  />
                  <ul className="mt-3 divide-y divide-border">
                    {popularGames.slice(0, 4).map((g) => (
                      <li key={g.id} className="flex items-center gap-3 py-2 text-sm">
                        <span className="min-w-0 flex-1 truncate">{g.title}</span>
                        <span className="font-mono text-xs text-muted-foreground tabular">
                          {fmt(g.plays)}
                        </span>
                        <StatusBadge tone={g.change.startsWith("+") ? "success" : "muted"}>
                          {g.change}
                        </StatusBadge>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </SectionCard>

            <SectionCard
              title="Activity by hour"
              action={<span className="text-xs text-muted-foreground">UTC · plays</span>}
            >
              {s === "loading" ? (
                <Skeleton className="h-60 w-full" />
              ) : (
                <>
                  <MiniBars
                    data={playsByHour}
                    xKey="hour"
                    series={[{ key: "plays", label: "Plays", color: "var(--chart-2)" }]}
                    height={220}
                  />
                  <p className="mt-3 text-xs text-muted-foreground">
                    Peak window is 18:00–21:00 UTC — the daily challenge drops at 08:00.
                  </p>
                </>
              )}
            </SectionCard>
          </div>
        </div>
      )}
    </AdminPage>
  );
}
