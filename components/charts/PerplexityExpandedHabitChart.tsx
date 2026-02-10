"use client";

import * as React from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
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
  tealGreen: "#0D9488",
  warmRed: "#B91C1C",
  neutral: "#6B7280",
  muted: "#94A3B8",
  baseline: "#E2E8F0",
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
      className="px-2.5 py-1.5 border border-gray-200/80 shadow-md rounded-md"
      style={{
        background: 'rgba(255, 255, 255, 0.92)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
      }}
    >
      <div className="text-[11px] text-gray-500 mb-0.5">{formattedDate}</div>
      <div className="text-sm font-semibold text-gray-900 tabular-nums">
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
}: PerplexityExpandedHabitChartProps) {
  const first = points[0];
  const last = points[points.length - 1];

  const baseline = first?.close ?? 0;
  const current = last?.close ?? 0;

  const delta = current - baseline;
  const pct = baseline ? (delta / baseline) * 100 : 0;
  const isUp = delta >= 0;
  const isNeutral = Math.abs(pct) < 0.5;

  // Determine chart color based on trend
  const chartColor = isNeutral 
    ? COLORS.neutral 
    : (isUp ? COLORS.tealGreen : COLORS.warmRed);

  // Prepare data
  const data = React.useMemo(() => {
    return points.map((p) => ({
      ...p,
      value: p.close,
    }));
  }, [points]);

  // Calculate Y domain with padding
  const allValues = points.map((p) => p.close).filter((v) => v !== null && v !== undefined);
  const minY = Math.min(...allValues);
  const maxY = Math.max(...allValues);
  const padding = (maxY - minY) * 0.12 || 1;

  // Unique gradient ID
  const gradientId = React.useMemo(
    () => `gradient-${title.replace(/[^a-zA-Z0-9]/g, '')}-${Math.random().toString(36).substr(2, 9)}`,
    [title]
  );

  // Format the close date
  const closeDate = last?.t 
    ? new Date(last.t).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
    : '';

  return (
    <div className="w-full">
      {/* Value header - Perplexity style */}
      <div className="flex items-baseline gap-2 mb-1">
        <span className="text-xl font-semibold tabular-nums text-gray-900">
          {formatCompact(current)}
        </span>
        {unit && <span className="text-sm text-gray-400">{unit}</span>}
        <span
          className={`text-sm tabular-nums font-medium ${
            isNeutral ? "text-gray-500" : (isUp ? "text-teal-600" : "text-red-700")
          }`}
        >
          {delta >= 0 ? "+" : ""}{formatCompact(delta)} ({pct >= 0 ? "+" : ""}{pct.toFixed(2)}%)
        </span>
      </div>
      <div className="text-[11px] text-gray-400 mb-2">At close: {closeDate}</div>

      {/* Chart */}
      <div className="h-[160px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={data}
            margin={{ top: 4, right: 4, bottom: 4, left: 4 }}
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={chartColor} stopOpacity={0.18} />
                <stop offset="100%" stopColor={chartColor} stopOpacity={0} />
              </linearGradient>
            </defs>

            <XAxis
              dataKey="t"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={(v) => formatDateLabel(v, range)}
              minTickGap={50}
              tick={{ fill: COLORS.muted, fontSize: 10 }}
            />

            <YAxis
              domain={[minY - padding, maxY + padding]}
              hide
            />

            {/* Baseline reference - subtle */}
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

            {/* Single area with gradient */}
            <Area
              type="monotone"
              dataKey="value"
              stroke={chartColor}
              strokeWidth={1.5}
              fill={`url(#${gradientId})`}
              isAnimationActive={false}
              dot={false}
              activeDot={{
                r: 4,
                fill: chartColor,
                stroke: "#fff",
                strokeWidth: 2,
              }}
              connectNulls
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default PerplexityExpandedHabitChart;
