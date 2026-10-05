import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { cn } from "@/lib/utils";

export type Series = { key: string; label: string; color: string };

function configFor(series: Series[]): ChartConfig {
  return Object.fromEntries(series.map((s) => [s.key, { label: s.label, color: s.color }]));
}

export function TrendArea({
  data,
  series,
  xKey = "day",
  className,
}: {
  data: Record<string, string | number>[];
  series: Series[];
  xKey?: string;
  className?: string;
}) {
  return (
    <ChartContainer
      config={configFor(series)}
      className={cn("aspect-auto h-56 w-full md:h-64", className)}
    >
      <AreaChart data={data} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey={xKey}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={24}
          interval="preserveStartEnd"
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={44}
          tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}K` : `${v}`)}
        />
        <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" />} />
        {series.map((s) => (
          <Area
            key={s.key}
            dataKey={s.key}
            type="monotone"
            stroke={`var(--color-${s.key})`}
            fill={`var(--color-${s.key})`}
            fillOpacity={0.12}
            strokeWidth={2}
          />
        ))}
      </AreaChart>
    </ChartContainer>
  );
}

export function MiniBars({
  data,
  series,
  xKey,
  className,
  height = 180,
}: {
  data: Record<string, string | number>[];
  series: Series[];
  xKey: string;
  className?: string;
  height?: number;
}) {
  return (
    <ChartContainer
      config={configFor(series)}
      className={cn("aspect-auto w-full", className)}
      style={{ height }}
    >
      <BarChart data={data} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey={xKey} tickLine={false} axisLine={false} tickMargin={8} minTickGap={12} />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={44}
          tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}K` : `${v}`)}
        />
        <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
        {series.map((s) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            fill={`var(--color-${s.key})`}
            radius={4}
            maxBarSize={40}
          />
        ))}
      </BarChart>
    </ChartContainer>
  );
}

export function RankedBars({
  data,
  xKey = "title",
  valueKey = "plays",
  label,
  className,
  height = 240,
}: {
  data: Record<string, string | number>[];
  xKey?: string;
  valueKey?: string;
  label: string;
  className?: string;
  height?: number;
}) {
  return (
    <ChartContainer
      config={{ [valueKey]: { label, color: "var(--chart-1)" } }}
      className={cn("aspect-auto w-full", className)}
      style={{ height }}
    >
      <BarChart data={data} layout="vertical" margin={{ left: 4, right: 12, top: 4, bottom: 4 }}>
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey={xKey}
          tickLine={false}
          axisLine={false}
          width={104}
          tick={{ fontSize: 11 }}
        />
        <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
        <Bar dataKey={valueKey} fill="var(--color-plays)" radius={4} maxBarSize={18} />
      </BarChart>
    </ChartContainer>
  );
}

/** Horizontal retention meter — plain divs, matches the design system's list surfaces. */
export function MeterRow({
  label,
  value,
  suffix = "%",
  hint,
}: {
  label: string;
  value: number;
  suffix?: string;
  hint?: string;
}) {
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="w-14 shrink-0 text-sm text-muted-foreground">{label}</span>
      <div
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2"
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div className="h-full rounded-full bg-primary" style={{ width: `${value}%` }} />
      </div>
      <span className="w-12 shrink-0 text-right font-mono text-sm font-medium tabular">
        {value}
        {suffix}
      </span>
      {hint && (
        <span className="hidden w-14 shrink-0 text-right text-xs text-muted-foreground tabular sm:block">
          {hint}
        </span>
      )}
    </div>
  );
}
