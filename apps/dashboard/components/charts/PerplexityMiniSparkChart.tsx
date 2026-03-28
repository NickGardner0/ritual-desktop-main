'use client';

import React, { useId, useMemo } from 'react';
import {
  Area,
  AreaChart,
  ReferenceLine,
  ResponsiveContainer,
  YAxis,
} from 'recharts';

type MiniSparkTrend = 'up' | 'down' | 'neutral';

interface PerplexityMiniSparkChartProps {
  values: number[];
  trend: MiniSparkTrend;
  height?: number;
  /** When false, uses linear interpolation with no smoothing for a jagged/detailed look */
  smooth?: boolean;
}

interface ChartPoint {
  index: number;
  value: number;
}

const COLORS = {
  positive: '#136A22',
  negative: '#A23544',
  neutral: '#6B7280',
  baseline: 'rgba(39, 37, 30, 0.28)',
};

const POINT_COUNT = 70;

function resampleValues(values: number[], targetCount: number): number[] {
  if (values.length === 0) return [];
  if (values.length === 1) return Array.from({ length: targetCount }, () => values[0]);

  const interpolated = Array.from({ length: targetCount }, (_, index) => {
    const position = (index / Math.max(targetCount - 1, 1)) * (values.length - 1);
    const lowIndex = Math.floor(position);
    const highIndex = Math.min(values.length - 1, Math.ceil(position));
    const ratio = position - lowIndex;
    const low = values[lowIndex];
    const high = values[highIndex];
    return low + (high - low) * ratio;
  });

  return interpolated.map((_, index) => {
    const start = Math.max(0, index - 2);
    const end = Math.min(interpolated.length - 1, index + 2);
    let sum = 0;
    for (let pointIndex = start; pointIndex <= end; pointIndex += 1) {
      sum += interpolated[pointIndex];
    }
    return sum / (end - start + 1);
  });
}

export function PerplexityMiniSparkChart({ values, trend, height = 33.33, smooth = true }: PerplexityMiniSparkChartProps) {
  const chartId = useId().replace(/[^a-zA-Z0-9_-]/g, '');

  const chart = useMemo(() => {
    const numericValues = values.filter((value) => Number.isFinite(value));
    if (numericValues.length === 0) return null;

    const sparkline = smooth
      ? resampleValues(numericValues, Math.max(POINT_COUNT, numericValues.length))
      : numericValues;
    const chartData: ChartPoint[] = sparkline.map((value, index) => ({ index, value }));

    const referenceValue = sparkline[0];
    const min = Math.min(...sparkline);
    const max = Math.max(...sparkline);
    const range = Math.max(max - min, 1e-6);
    const padding = range * 0.05;

    const yMin = min - padding;
    const yMax = max + padding;

    const stroke = trend === 'down'
      ? COLORS.negative
      : trend === 'up'
        ? COLORS.positive
        : COLORS.neutral;

    return {
      chartData,
      referenceValue,
      yMin,
      yMax,
      stroke,
    };
  }, [values, trend, smooth]);

  if (!chart) {
    return <div style={{ width: '100%', height }} aria-hidden="true" />;
  }

  const fillGradientId = `spark-fill-${chartId}`;
  const curveType = smooth ? 'monotone' : 'linear';
  const strokeW = smooth ? 1.6 : 1.2;

  return (
    <div
      style={{
        width: '100%',
        height,
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={chart.chartData}
          margin={{ top: 2, right: 0, left: 0, bottom: 0 }}
        >
          <defs>
            <linearGradient id={fillGradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={chart.stroke} stopOpacity={smooth ? 0.35 : 0.12} />
              <stop offset="60%" stopColor={chart.stroke} stopOpacity={smooth ? 0.08 : 0.03} />
              <stop offset="100%" stopColor={chart.stroke} stopOpacity={0} />
            </linearGradient>
          </defs>

          <YAxis domain={[chart.yMin, chart.yMax]} hide />

          <Area
            type={curveType}
            dataKey="value"
            baseValue={chart.referenceValue}
            stroke="none"
            fill={`url(#${fillGradientId})`}
            isAnimationActive={false}
            dot={false}
            activeDot={false}
          />

          <ReferenceLine
            y={chart.referenceValue}
            stroke={COLORS.baseline}
            strokeDasharray="3.5 3"
            strokeWidth={1}
            ifOverflow="extendDomain"
          />

          <Area
            type={curveType}
            dataKey="value"
            stroke={chart.stroke}
            strokeWidth={strokeW}
            fill="none"
            isAnimationActive={false}
            dot={false}
            activeDot={false}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export default PerplexityMiniSparkChart;
