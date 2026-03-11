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

function hashSeed(values: number[]): number {
  let h = 0;
  for (let i = 0; i < values.length; i++) {
    h = ((h << 5) - h) + ((values[i] * 1000) | 0);
    h |= 0;
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateMarketSparkline(trend: MiniSparkTrend, seed: number): number[] {
  const rng = mulberry32(seed);
  const drift = trend === 'up' ? 0.015 : trend === 'down' ? -0.015 : 0;
  const volatility = 0.75;
  const origin = 50;

  const raw: number[] = [origin];
  for (let i = 1; i < POINT_COUNT; i++) {
    const prev = raw[i - 1];
    const noise = (rng() - 0.5) * volatility;
    const reversion = (origin - prev) * 0.008;
    raw.push(prev + drift + noise + reversion);
  }

  const points: number[] = raw.map((_, i) => {
    const start = Math.max(0, i - 1);
    const end = Math.min(raw.length - 1, i + 1);
    let sum = 0;
    for (let j = start; j <= end; j++) sum += raw[j];
    return sum / (end - start + 1);
  });
  points[0] = raw[0];
  points[raw.length - 1] = raw[raw.length - 1];

  return points;
}

export function PerplexityMiniSparkChart({ values, trend, height = 33.33 }: PerplexityMiniSparkChartProps) {
  const chartId = useId().replace(/[^a-zA-Z0-9_-]/g, '');

  const chart = useMemo(() => {
    const numericValues = values.filter((value) => Number.isFinite(value));
    if (numericValues.length === 0) return null;

    const seed = hashSeed(numericValues);
    const sparkline = generateMarketSparkline(trend, seed);
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
  }, [values, trend]);

  if (!chart) {
    return <div style={{ width: '100%', height }} aria-hidden="true" />;
  }

  const fillGradientId = `spark-fill-${chartId}`;

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
              <stop offset="0%" stopColor={chart.stroke} stopOpacity={0.35} />
              <stop offset="60%" stopColor={chart.stroke} stopOpacity={0.08} />
              <stop offset="100%" stopColor={chart.stroke} stopOpacity={0} />
            </linearGradient>
          </defs>

          <YAxis domain={[chart.yMin, chart.yMax]} hide />

          <Area
            type="monotone"
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
            type="monotone"
            dataKey="value"
            stroke={chart.stroke}
            strokeWidth={1.6}
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
