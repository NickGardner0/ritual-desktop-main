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
import { ExpandedChartTooltip } from "./ChartTooltip";

export type RangeKey =
  | "1D"
  | "5D"
  | "1W"
  | "1M"
  | "3M"
  | "6M"
  | "YTD"
  | "1Y"
  | "5Y"
  | "ALL"
  | "MAX";

export type FinancePoint = {
  t: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  sleepOnset?: string;
  sleepEnd?: string;
  time?: string;
  unit?: string;
};

const COLORS = {
  up: "#15803D",
  down: "#B42318",
  neutral: "#6B7280",
};

const GRID_COLOR = "hsl(var(--border))";
const MUTED_TICK = "hsl(var(--muted-foreground))";
const BASELINE_COLOR = "hsl(var(--muted-foreground))";
const GRID_OPACITY = 0.28;

function formatDateLabel(ms: number, range: RangeKey) {
  const date = new Date(ms);

  if (range === "1D") {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  if (range === "5D" || range === "1W") {
    return date.toLocaleDateString([], { weekday: "short" });
  }

  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatAxisValue(value: number) {
  if (!Number.isFinite(value)) return "";
  if (Math.abs(value) >= 1000) return Math.round(value).toLocaleString();
  if (Math.abs(value) >= 100) return value.toFixed(0);
  if (Math.abs(value) >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

interface PerplexityExpandedHabitChartProps {
  points: FinancePoint[];
  range: RangeKey;
  unit?: string;
  chartType?: "spark" | "bar";
  showReferenceLine?: boolean;
  showGrid?: boolean;
}

export function PerplexityExpandedHabitChart({
  points,
  range,
  unit,
  chartType = "spark",
  showReferenceLine = true,
  showGrid = true,
}: PerplexityExpandedHabitChartProps) {
  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];

  const baseline = firstPoint?.close ?? 0;
  const current = lastPoint?.close ?? 0;
  const changePct = baseline ? ((current - baseline) / baseline) * 100 : 0;

  const trendColor = Number.isFinite(changePct)
    ? (Math.abs(changePct) < 0.5 ? COLORS.neutral : (changePct >= 0 ? COLORS.up : COLORS.down))
    : COLORS.neutral;

  const data = React.useMemo(
    () =>
      points.map((point) => ({
        ...point,
        value: point.close,
      })),
    [points]
  );

  const allValues = React.useMemo(
    () =>
      points
        .map((point) => point.close)
        .filter((value): value is number => Number.isFinite(value)),
    [points]
  );

  const hasData = allValues.length > 0;
  const minY = hasData ? Math.min(...allValues) : 0;
  const maxY = hasData ? Math.max(...allValues) : 1;
  const span = Math.max(maxY - minY, 1);
  const domainMin = minY - span * 0.05;
  const domainMax = maxY + span * 0.1;
  const yTicks = React.useMemo(() => {
    if (!hasData) return [0];
    const step = (domainMax - domainMin) / 2;
    return [domainMin, domainMin + step, domainMax];
  }, [domainMax, domainMin, hasData]);

  const reactId = React.useId().replace(/:/g, "");
  const gradientId = `expanded-chart-gradient-${reactId}`;

  return (
    <div className="h-[200px] w-full sm:h-[220px]">
      {hasData ? (
        <ResponsiveContainer width="100%" height="100%">
          {chartType === "bar" ? (
            <BarChart
              data={data}
              margin={{ top: 2, right: 4, bottom: 0, left: 0 }}
              barCategoryGap="22%"
            >
              <CartesianGrid
                vertical
                stroke={GRID_COLOR}
                strokeOpacity={showGrid ? GRID_OPACITY : 0}
              />

              <XAxis
                dataKey="t"
                type="number"
                domain={["dataMin", "dataMax"]}
                tickLine={false}
                axisLine={false}
                tickMargin={6}
                tickFormatter={(value) => formatDateLabel(value, range)}
                minTickGap={42}
                tickCount={4}
                tick={{ fill: MUTED_TICK, fontSize: 9 }}
              />

              <YAxis
                domain={[domainMin, domainMax]}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) => formatAxisValue(value)}
                ticks={yTicks}
                tick={{ fill: MUTED_TICK, fontSize: 9 }}
                width={34}
              />

              {showReferenceLine && (
                <ReferenceLine
                  y={baseline}
                  stroke={BASELINE_COLOR}
                  strokeDasharray="5 5"
                  strokeOpacity={0.45}
                  strokeWidth={1}
                />
              )}

              <Tooltip
                content={<ExpandedChartTooltip unit={unit} valueKey="value" dateKey="t" />}
                cursor={{ fill: "rgba(15,23,42,0.03)" }}
              />

              <Bar
                dataKey="value"
                fill="hsl(var(--foreground))"
                radius={[0, 0, 0, 0]}
                isAnimationActive={false}
                maxBarSize={14}
                minPointSize={2}
              />
            </BarChart>
          ) : (
            <AreaChart data={data} margin={{ top: 2, right: 4, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={trendColor} stopOpacity={0.16} />
                  <stop offset="100%" stopColor={trendColor} stopOpacity={0.03} />
                </linearGradient>
              </defs>

              <CartesianGrid
                vertical
                stroke={GRID_COLOR}
                strokeOpacity={showGrid ? GRID_OPACITY : 0}
              />

              <XAxis
                dataKey="t"
                type="number"
                domain={["dataMin", "dataMax"]}
                tickLine={false}
                axisLine={false}
                tickMargin={6}
                tickFormatter={(value) => formatDateLabel(value, range)}
                minTickGap={42}
                tickCount={4}
                tick={{ fill: MUTED_TICK, fontSize: 9 }}
              />

              <YAxis
                domain={[domainMin, domainMax]}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) => formatAxisValue(value)}
                ticks={yTicks}
                tick={{ fill: MUTED_TICK, fontSize: 9 }}
                width={34}
              />

              {showReferenceLine && (
                <ReferenceLine
                  y={baseline}
                  stroke={BASELINE_COLOR}
                  strokeDasharray="5 5"
                  strokeOpacity={0.45}
                  strokeWidth={1}
                />
              )}

              <Tooltip
                content={<ExpandedChartTooltip unit={unit} valueKey="value" dateKey="t" />}
                cursor={{
                  stroke: trendColor,
                  strokeWidth: 1,
                  strokeDasharray: "3 3",
                }}
              />

              <Area
                type="monotone"
                dataKey="value"
                baseValue="dataMin"
                stroke={trendColor}
                strokeWidth={1.6}
                fill={`url(#${gradientId})`}
                isAnimationActive={false}
                dot={false}
                activeDot={{
                  r: 2.5,
                  fill: trendColor,
                  stroke: "hsl(var(--background))",
                  strokeWidth: 1,
                }}
                connectNulls
              />
            </AreaChart>
          )}
        </ResponsiveContainer>
      ) : (
        <div className="flex h-full items-center justify-center border border-dashed border-border/70 bg-muted/20 text-sm text-muted-foreground">
          No data for selected range
        </div>
      )}
    </div>
  );
}

export default PerplexityExpandedHabitChart;
