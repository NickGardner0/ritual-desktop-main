"use client";

import * as React from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
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
  compareClose?: number | null;
  volume: number;
  sleepOnset?: string;
  sleepEnd?: string;
  time?: string;
  unit?: string;
};

const COLORS = {
  positive: "#136A22",
  negative: "#A23544",
  neutral: "#6B7280",
  baseline: "rgba(39, 37, 30, 0.28)",
};

function formatDateLabel(ms: number, range: RangeKey) {
  const date = new Date(ms);

  if (range === "1D") {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatAxisValue(value: number) {
  if (!Number.isFinite(value)) return "";
  if (Math.abs(value) >= 1000) return Math.round(value).toLocaleString();
  if (Math.abs(value) >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

function toOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

interface PerplexityExpandedHabitChartProps {
  points: FinancePoint[];
  range: RangeKey;
  unit?: string;
  compareLabel?: string;
  compareUnit?: string;
  chartType?: "spark" | "bar";
  showReferenceLine?: boolean;
  showGrid?: boolean;
  /** Determines gradient color: true/undefined=green, false=red */
  higherIsBetter?: boolean | null;
}

export function PerplexityExpandedHabitChart({
  points,
  range,
  unit,
  compareLabel,
  compareUnit,
  chartType = "spark",
  showReferenceLine = true,
  showGrid = true,
  higherIsBetter,
}: PerplexityExpandedHabitChartProps) {
  const baseline = points[0]?.close ?? 0;
  const lastValue = points[points.length - 1]?.close ?? 0;
  const avgValue = React.useMemo(() => {
    const vals = points.map((p) => p.close).filter(Number.isFinite);
    return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  }, [points]);

  const data = React.useMemo(
    () =>
      points.map((point) => ({
        ...point,
        value: point.close,
        compareValue: toOptionalNumber(point.compareClose),
      })),
    [points]
  );
  const hasCompareSeries = React.useMemo(
    () =>
      points.some((point) => toOptionalNumber(point.compareClose) !== null),
    [points]
  );

  const allValues = React.useMemo(
    () =>
      points
        .flatMap((point) => [point.close, point.compareClose])
        .filter((value): value is number => Number.isFinite(value)),
    [points]
  );

  const hasData = allValues.length > 0;
  const dataMin = hasData ? Math.min(...allValues) : 0;
  const dataMax = hasData ? Math.max(...allValues) : 1;
  const span = Math.max(dataMax - dataMin, 1);
  const domainMin = dataMin - span * 0.08;
  const domainMax = dataMax + span * 0.08;
  const isBarChart = chartType === "bar";
  const chartDomainMin = isBarChart ? Math.min(0, dataMin) : domainMin;
  const chartDomainMax = isBarChart ? Math.max(0, dataMax) : domainMax;

  // Determine chart color based on trend direction and higherIsBetter
  const trendUp = lastValue >= baseline;
  const isGoodTrend = higherIsBetter === false ? !trendUp : trendUp;
  const chartColor = isGoodTrend ? COLORS.positive : COLORS.negative;

  const yTicks = React.useMemo(() => {
    if (!hasData) return [0];
    const lo = isBarChart ? chartDomainMin : domainMin;
    const hi = isBarChart ? chartDomainMax : domainMax;
    const range = hi - lo;
    if (range <= 0) return [lo];
    const step = range / 3;
    const ticks = [lo, lo + step, lo + step * 2, hi]
      .map((tick) => Number(tick.toFixed(2)))
      .filter((tick, index, arr) => arr.indexOf(tick) === index);
    return ticks;
  }, [chartDomainMax, chartDomainMin, domainMax, domainMin, hasData, isBarChart]);

  const reactId = React.useId().replace(/:/g, "");
  const fillGradientId = `expanded-fill-${reactId}`;

  return (
    <div className="h-[220px] w-full">
      {hasData ? (
        <ResponsiveContainer width="100%" height="100%">
          {isBarChart ? (
            <BarChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 0 }} barGap={2} barCategoryGap="20%" maxBarSize={data.length <= 7 ? 40 : data.length <= 14 ? 32 : undefined}>
              <CartesianGrid
                horizontal
                vertical={false}
                stroke="rgba(39,37,30,0.06)"
                strokeWidth={1}
                strokeOpacity={showGrid ? 1 : 0}
              />

              <XAxis
                dataKey="t"
                type="category"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tickFormatter={(value) => formatDateLabel(Number(value), range)}
                interval={data.length <= 14 ? 0 : Math.ceil(data.length / 8)}
                tick={{ fill: "rgba(39,37,30,0.3)", fontSize: 10 }}
              />

              <YAxis
                domain={[chartDomainMin, chartDomainMax]}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) => formatAxisValue(value)}
                ticks={yTicks}
                tick={{ fill: "rgba(39,37,30,0.3)", fontSize: 10 }}
                width={50}
              />

              <Tooltip
                content={(
                  <ExpandedChartTooltip
                    unit={unit}
                    valueKey="value"
                    dateKey="t"
                    compareLabel={compareLabel}
                    compareUnit={compareUnit}
                  />
                )}
                cursor={false}
              />

              <ReferenceLine
                y={avgValue}
                stroke="rgba(39,37,30,0.28)"
                strokeWidth={1}
                strokeDasharray="6 4"
                label={false}
              />

              <Bar
                dataKey="value"
                fill="#27251E"
                fillOpacity={0.85}
                radius={[2, 2, 0, 0]}
                isAnimationActive={false}
              />
              {hasCompareSeries ? (
                <Bar
                  dataKey="compareValue"
                  fill="rgba(39,37,30,0.20)"
                  fillOpacity={1}
                  radius={[2, 2, 0, 0]}
                  isAnimationActive={false}
                />
              ) : null}
            </BarChart>
          ) : (
            <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
              <defs>
                <linearGradient id={fillGradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={chartColor} stopOpacity={0.35} />
                  <stop offset="40%" stopColor={chartColor} stopOpacity={0.18} />
                  <stop offset="75%" stopColor={chartColor} stopOpacity={0.08} />
                  <stop offset="100%" stopColor={chartColor} stopOpacity={0.02} />
                </linearGradient>
              </defs>

              <CartesianGrid
                horizontal
                vertical={false}
                stroke="rgba(39,37,30,0.05)"
                strokeWidth={1}
                strokeOpacity={showGrid ? 1 : 0}
              />

              <XAxis
                dataKey="t"
                type="number"
                domain={["dataMin", "dataMax"]}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tickFormatter={(value) => formatDateLabel(value, range)}
                ticks={data.length <= 14 ? data.map((d) => d.t) : undefined}
                minTickGap={data.length <= 14 ? 0 : 48}
                tickCount={data.length <= 14 ? data.length : undefined}
                tick={{ fill: "rgba(39,37,30,0.3)", fontSize: 10 }}
              />

              <YAxis
                domain={[chartDomainMin, chartDomainMax]}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) => formatAxisValue(value)}
                ticks={yTicks}
                tick={{ fill: "rgba(39,37,30,0.3)", fontSize: 10 }}
                width={40}
              />

              <Tooltip
                content={(
                  <ExpandedChartTooltip
                    unit={unit}
                    valueKey="value"
                    dateKey="t"
                    compareLabel={compareLabel}
                    compareUnit={compareUnit}
                  />
                )}
                cursor={{
                  stroke: "rgba(39,37,30,0.12)",
                  strokeWidth: 1,
                }}
              />

              {/* Gradient fill area */}
              <Area
                type="monotone"
                dataKey="value"
                stroke="none"
                fill={`url(#${fillGradientId})`}
                isAnimationActive={false}
                dot={false}
                activeDot={false}
                connectNulls
              />

              {/* Compare series */}
              {hasCompareSeries ? (
                <Area
                  type="monotone"
                  dataKey="compareValue"
                  stroke="rgba(39,37,30,0.3)"
                  strokeWidth={1.25}
                  strokeDasharray="4 3"
                  fill="none"
                  isAnimationActive={false}
                  dot={false}
                  activeDot={{
                    r: 2.5,
                    fill: "rgba(39,37,30,0.4)",
                    stroke: "#FFFFFF",
                    strokeWidth: 1.5,
                  }}
                  connectNulls={false}
                />
              ) : null}

              {/* Main line on top */}
              <Area
                type="monotone"
                dataKey="value"
                stroke={chartColor}
                strokeWidth={1.25}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
                isAnimationActive={false}
                dot={false}
                activeDot={{
                  r: 3.5,
                  fill: chartColor,
                  stroke: "#FFFFFF",
                  strokeWidth: 2,
                }}
                connectNulls
              />
            </AreaChart>
          )}
        </ResponsiveContainer>
      ) : (
        <div className="flex h-full items-center justify-center text-[12px] text-[rgba(39,37,30,0.4)]">
          No data for selected range
        </div>
      )}
    </div>
  );
}

export default PerplexityExpandedHabitChart;
