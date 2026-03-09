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
}: PerplexityExpandedHabitChartProps) {
  const baseline = points[0]?.close ?? 0;

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
  const dataMin = hasData ? Math.min(...allValues, baseline) : 0;
  const dataMax = hasData ? Math.max(...allValues, baseline) : 1;
  const span = Math.max(dataMax - dataMin, 1);
  const domainMin = dataMin - span * 0.15;
  const domainMax = dataMax + span * 0.15;
  const isBarChart = chartType === "bar";
  const chartDomainMin = isBarChart ? Math.min(0, dataMin) : domainMin;
  const chartDomainMax = isBarChart ? Math.max(0, dataMax) : domainMax;

  const gradientOffset = React.useMemo(() => {
    const range = domainMax - domainMin;
    if (range <= 0) return 0.5;
    return Math.max(0, Math.min(1, (domainMax - baseline) / range));
  }, [domainMax, domainMin, baseline]);

  const yTicks = React.useMemo(() => {
    if (!hasData) return [0];
    const ticks = (isBarChart
      ? [chartDomainMin, 0, chartDomainMax]
      : [domainMin, baseline, domainMax])
      .map((tick) => Number(tick.toFixed(2)))
      .filter((tick, index, arr) => arr.indexOf(tick) === index)
      .sort((a, b) => a - b);
    return ticks;
  }, [baseline, chartDomainMax, chartDomainMin, domainMax, domainMin, hasData, isBarChart]);

  const reactId = React.useId().replace(/:/g, "");
  const fillGradientId = `expanded-fill-${reactId}`;
  const strokeGradientId = `expanded-stroke-${reactId}`;

  const off = `${(gradientOffset * 100).toFixed(2)}%`;

  const showDenseGrid = chartType === "bar";

  return (
    <div className="h-[225px] w-full">
      {hasData ? (
        <ResponsiveContainer width="100%" height="100%">
          {isBarChart ? (
            <BarChart data={data} margin={{ top: 8, right: 4, bottom: 4, left: 0 }} barGap={0}>
              <CartesianGrid
                horizontal
                vertical={showDenseGrid}
                stroke="rgba(39,37,30,0.06)"
                strokeWidth={1}
                strokeOpacity={showGrid ? 1 : 0}
              />

              <XAxis
                dataKey="t"
                type="number"
                domain={["dataMin", "dataMax"]}
                tickLine={false}
                axisLine={false}
                tickMargin={10}
                tickFormatter={(value) => formatDateLabel(value, range)}
                ticks={data.length <= 14 ? data.map((d) => d.t) : undefined}
                minTickGap={data.length <= 14 ? 0 : 48}
                tickCount={data.length <= 14 ? data.length : undefined}
                tick={{ fill: "rgba(39,37,30,0.35)", fontSize: 11 }}
              />

              <YAxis
                domain={[chartDomainMin, chartDomainMax]}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) => formatAxisValue(value)}
                ticks={yTicks}
                tick={{ fill: "rgba(39,37,30,0.35)", fontSize: 11 }}
                width={38}
              />

              {showReferenceLine ? (
                <ReferenceLine
                  y={0}
                  stroke={COLORS.baseline}
                  strokeDasharray="3.5 3"
                  strokeWidth={1}
                />
              ) : null}

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

              <Bar
                dataKey="value"
                fill="#4A4A4C"
                radius={[1.5, 1.5, 0, 0]}
                barSize={14}
                isAnimationActive={false}
              />
              {hasCompareSeries ? (
                <Bar
                  dataKey="compareValue"
                  fill="#9CA3AF"
                  radius={[1.5, 1.5, 0, 0]}
                  barSize={14}
                  isAnimationActive={false}
                />
              ) : null}
            </BarChart>
          ) : (
            <AreaChart data={data} margin={{ top: 8, right: 4, bottom: 4, left: 0 }}>
              <defs>
                <linearGradient id={fillGradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLORS.positive} stopOpacity={0.35} />
                  <stop offset={off} stopColor={COLORS.positive} stopOpacity={0} />
                  <stop offset={off} stopColor={COLORS.negative} stopOpacity={0} />
                  <stop offset="100%" stopColor={COLORS.negative} stopOpacity={0.35} />
                </linearGradient>
                <linearGradient id={strokeGradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset={off} stopColor={COLORS.positive} stopOpacity={1} />
                  <stop offset={off} stopColor={COLORS.negative} stopOpacity={1} />
                </linearGradient>
              </defs>

              <CartesianGrid
                horizontal
                vertical={showDenseGrid}
                stroke="rgba(39,37,30,0.06)"
                strokeWidth={1}
                strokeOpacity={showGrid ? 1 : 0}
              />

              <XAxis
                dataKey="t"
                type="number"
                domain={["dataMin", "dataMax"]}
                tickLine={false}
                axisLine={false}
                tickMargin={10}
                tickFormatter={(value) => formatDateLabel(value, range)}
                ticks={data.length <= 14 ? data.map((d) => d.t) : undefined}
                minTickGap={data.length <= 14 ? 0 : 48}
                tickCount={data.length <= 14 ? data.length : undefined}
                tick={{ fill: "rgba(39,37,30,0.35)", fontSize: 11 }}
              />

              <YAxis
                domain={[chartDomainMin, chartDomainMax]}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) => formatAxisValue(value)}
                ticks={yTicks}
                tick={{ fill: "rgba(39,37,30,0.35)", fontSize: 11 }}
                width={38}
              />

              <Area
                type="monotone"
                dataKey="value"
                baseValue={baseline}
                stroke="none"
                fill={`url(#${fillGradientId})`}
                isAnimationActive={false}
                dot={false}
                activeDot={false}
              />

              {showReferenceLine ? (
                <ReferenceLine
                  y={baseline}
                  stroke={COLORS.baseline}
                  strokeDasharray="3.5 3"
                  strokeWidth={1}
                />
              ) : null}

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
                  stroke: COLORS.baseline,
                  strokeWidth: 1,
                  strokeDasharray: "3 3",
                }}
              />

              {hasCompareSeries ? (
                <Area
                  type="monotone"
                  dataKey="compareValue"
                  stroke="#6B7280"
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  fill="none"
                  isAnimationActive={false}
                  dot={false}
                  activeDot={{
                    r: 2.5,
                    fill: "#6B7280",
                    stroke: "#FFFFFF",
                    strokeWidth: 2,
                  }}
                  connectNulls={false}
                />
              ) : null}

              <Area
                type="monotone"
                dataKey="value"
                stroke={`url(#${strokeGradientId})`}
                strokeWidth={1.75}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
                isAnimationActive={false}
                dot={false}
                activeDot={{
                  r: 3,
                  fill: "#27251E",
                  stroke: "#FFFFFF",
                  strokeWidth: 2,
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
