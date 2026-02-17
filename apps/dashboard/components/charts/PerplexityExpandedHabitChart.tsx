"use client";

import * as React from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";

export type RangeKey = "1D" | "1W" | "1M" | "3M" | "6M" | "YTD" | "1Y" | "ALL";

/**
 * Simple data point for spark-style charts
 */
export type FinancePoint = {
  t: number; // unix ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  // Optional metadata from habit logs
  sleepOnset?: string;
  sleepEnd?: string;
  time?: string;
  unit?: string;
};

// Perplexity-style colors
const COLORS = {
  tealGreen: "#1A7F37",
  negativeColor: "#8a1a25",
  neutral: "#6B7280",
  muted: "#94A3B8",
  baseline: "#E2E8F0",
  grid: "#E5E7EB",
};

function formatCompact(n: number) {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: n < 10 ? 2 : 0,
  }).format(n);
}

function formatDateLabel(ms: number, range: RangeKey) {
  const d = new Date(ms);
  if (range === "1D") {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatAxisValue(n: number) {
  if (!Number.isFinite(n)) return "";
  if (Math.abs(n) >= 1000) return Math.round(n).toLocaleString();
  if (Math.abs(n) >= 100) return n.toFixed(0);
  if (Math.abs(n) >= 10) return n.toFixed(1);
  return n.toFixed(2);
}

// Clean spark-style tooltip matching Perplexity
function SparkTooltip({
  active,
  payload,
  unit,
}: {
  active?: boolean;
  payload?: any[];
  unit?: string;
}) {
  if (!active || !payload?.length) return null;

  const p = payload[0]?.payload;
  if (!p) return null;

  const value = p.close;
  const date = new Date(p.t);
  const formattedDate = date.toLocaleDateString([], { 
    month: "short", 
    day: "numeric",
    year: date.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined 
  });

  return (
    <div 
      className="border border-gray-200/80 px-2.5 py-1.5 shadow-md rounded-none"
      style={{
        background: 'rgba(255, 255, 255, 0.92)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
      }}
    >
      <div className="text-[11px] text-gray-500 mb-0.5">{formattedDate}</div>
      <div className="text-sm font-normal text-gray-900 tabular-nums">
        {formatCompact(value)} {unit && <span className="text-gray-400 font-normal text-xs">{unit}</span>}
      </div>
    </div>
  );
}

interface PerplexityExpandedHabitChartProps {
  title: string;
  subtitle?: string;
  points: FinancePoint[];
  range: RangeKey;
  onRangeChange: (r: RangeKey) => void;
  ranges?: RangeKey[];
  unit?: string;
  showRangePills?: boolean;
  comparisonPoints?: FinancePoint[];
  comparisonTitle?: string;
  comparisonUnit?: string;
  toolbar?: React.ReactNode;
  trendPercent?: number;
  trendDelta?: number;
  /** "bar" = bar chart, "spark" = area/line chart. Matches the Spark/Bar view toggle. */
  chartType?: "spark" | "bar";
}

/**
 * Perplexity-style expanded chart - compact spark design
 */
export function PerplexityExpandedHabitChart({
  title,
  subtitle,
  points,
  range,
  onRangeChange,
  ranges = ["1D", "1W", "1M", "3M", "6M", "YTD", "1Y", "ALL"],
  unit,
  showRangePills = false,
  comparisonPoints,
  comparisonTitle,
  comparisonUnit,
  toolbar,
  trendPercent,
  trendDelta,
  chartType = "spark",
}: PerplexityExpandedHabitChartProps) {
  const first = points[0];
  const last = points[points.length - 1];

  const baseline = first?.close ?? 0;
  const current = last?.close ?? 0;

  const rawDelta = current - baseline;
  const rawPct = baseline ? (rawDelta / baseline) * 100 : 0;
  const resolvedDelta = typeof trendDelta === "number" && Number.isFinite(trendDelta) ? trendDelta : rawDelta;
  const resolvedPct = typeof trendPercent === "number" && Number.isFinite(trendPercent) ? trendPercent : rawPct;
  const isUp = resolvedPct >= 0;
  const isNeutral = Math.abs(resolvedPct) < 0.5;

  // Determine chart color based on trend
  const chartColor = isNeutral 
    ? COLORS.neutral 
    : (isUp ? COLORS.tealGreen : COLORS.negativeColor);

  // Prepare data
  const data = React.useMemo(() => {
    return points.map((p) => ({
      ...p,
      value: p.close,
    }));
  }, [points]);

  // Calculate Y domain with padding
  const allValues = points
    .map((p) => p.close)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const hasData = allValues.length > 0;
  const minY = hasData ? Math.min(...allValues) : 0;
  const maxY = hasData ? Math.max(...allValues) : 1;
  const span = Math.max(maxY - minY, 1);
  const domainMin = minY - (span * 0.04);
  const domainMax = maxY + (span * 0.2);
  const yTicks = React.useMemo(() => {
    if (!hasData) return [0];
    const step = (domainMax - domainMin) / 3;
    return [domainMin, domainMin + step, domainMin + step * 2, domainMax];
  }, [domainMin, domainMax, hasData]);

  // Stable gradient ID without render-time randomness
  const reactId = React.useId().replace(/:/g, "");
  const gradientId = React.useMemo(
    () => `gradient-${title.replace(/[^a-zA-Z0-9]/g, "")}-${reactId}`,
    [title, reactId]
  );

  // Format the close date
  const closeDate = last?.t 
    ? new Date(last.t).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
    : '';

  return (
    <div className="w-full">
      {/* Value header - Perplexity style */}
      <div className="mb-1 flex items-baseline gap-2">
        <span className="text-[clamp(2rem,2.7vw,2.9rem)] font-normal leading-none tracking-[-0.01em] tabular-nums text-gray-900">
          {formatCompact(current)}
        </span>
        {unit && <span className="text-[clamp(1rem,1.3vw,1.3rem)] font-normal text-gray-400">{unit}</span>}
        <span
          className={`text-[clamp(1rem,1.35vw,1.35rem)] tabular-nums font-normal ${isNeutral ? "text-gray-500" : ""}`}
          style={!isNeutral ? { color: isUp ? COLORS.tealGreen : COLORS.negativeColor } : undefined}
        >
          {resolvedDelta >= 0 ? "+" : ""}{formatCompact(resolvedDelta)} ({resolvedPct >= 0 ? "+" : ""}{resolvedPct.toFixed(2)}%)
        </span>
      </div>
      <div className="mb-1.5 text-[13px] text-gray-500">{subtitle || `At close: ${closeDate}`}</div>

      {toolbar && (
        <div className="mb-1.5 border-t border-[#D5D9DF] pt-1.5">
          {toolbar}
        </div>
      )}

      {/* Chart */}
      <div className="h-[214px] w-full">
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            {chartType === "bar" ? (
              <BarChart
                data={data}
                margin={{ top: 6, right: 6, bottom: 2, left: 2 }}
              >
                <CartesianGrid vertical={false} stroke={COLORS.grid} strokeOpacity={0.4} />

                <XAxis
                  dataKey="t"
                  type="number"
                  domain={["dataMin", "dataMax"]}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={10}
                  tickFormatter={(v) => formatDateLabel(v, range)}
                  minTickGap={58}
                  tick={{ fill: COLORS.muted, fontSize: 11 }}
                />

                <YAxis
                  domain={[domainMin, domainMax]}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => formatAxisValue(v)}
                  ticks={yTicks}
                  tick={{ fill: "#9CA3AF", fontSize: 11 }}
                  width={46}
                />

                <ReferenceLine
                  y={baseline}
                  stroke={COLORS.baseline}
                  strokeDasharray="4 4"
                  strokeWidth={1}
                />

                <Tooltip
                  content={<SparkTooltip unit={unit} />}
                  cursor={{ fill: "rgba(0,0,0,0.04)" }}
                />

                <Bar
                  dataKey="value"
                  fill="#4A4A4C"
                  radius={[1, 1, 0, 0]}
                  isAnimationActive={false}
                  maxBarSize={24}
                  minPointSize={2}
                />
              </BarChart>
            ) : (
              <AreaChart
                data={data}
                margin={{ top: 6, right: 6, bottom: 2, left: 2 }}
              >
                <defs>
                  <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={chartColor} stopOpacity={0.42} />
                    <stop offset="100%" stopColor={chartColor} stopOpacity={0.26} />
                  </linearGradient>
                </defs>

                <CartesianGrid vertical={false} stroke={COLORS.grid} strokeOpacity={0.4} />

                <XAxis
                  dataKey="t"
                  type="number"
                  domain={["dataMin", "dataMax"]}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={10}
                  tickFormatter={(v) => formatDateLabel(v, range)}
                  minTickGap={58}
                  tick={{ fill: COLORS.muted, fontSize: 11 }}
                />

                <YAxis
                  domain={[domainMin, domainMax]}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => formatAxisValue(v)}
                  ticks={yTicks}
                  tick={{ fill: "#9CA3AF", fontSize: 11 }}
                  width={46}
                />

                <ReferenceLine
                  y={baseline}
                  stroke={COLORS.baseline}
                  strokeDasharray="4 4"
                  strokeWidth={1}
                />

                <Tooltip
                  content={<SparkTooltip unit={unit} />}
                  cursor={{
                    stroke: chartColor,
                    strokeWidth: 1,
                    strokeDasharray: "3 3",
                  }}
                />

                <Area
                  type="monotone"
                  dataKey="value"
                  baseValue="dataMin"
                  stroke={chartColor}
                  strokeWidth={2}
                  fill={`url(#${gradientId})`}
                  isAnimationActive={false}
                  dot={false}
                  activeDot={{
                    r: 3.5,
                    fill: chartColor,
                    stroke: "#fff",
                    strokeWidth: 2,
                  }}
                  connectNulls
                />
              </AreaChart>
            )}
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center rounded-none border border-dashed border-gray-200 text-sm text-gray-400">
            No data for selected range
          </div>
        )}
      </div>
    </div>
  );
}

export default PerplexityExpandedHabitChart;
