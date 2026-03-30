'use client';

import React, { useState, useMemo, useId } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import { format, parseISO, subDays, subMonths, subYears } from 'date-fns';
import { cn } from '@/lib/utils';

/**
 * Multi-habit overlay chart — Perplexity Finance style.
 *
 * Shows top 5 habits by default with smooth monotone curves,
 * a range selector, and a Perplexity-style legend table below
 * showing current value + % change for each habit.
 */

interface HabitSeries {
  habitId: string;
  name: string;
  unit: string;
  logs: any[];
  color: string;
}

interface MultiHabitOverlayChartProps {
  habits: HabitSeries[];
  height?: number;
}

// Perplexity-inspired palette — distinct, muted, works on white
const PALETTE = [
  '#3B82C4', // steel blue
  '#C75A3A', // terracotta
  '#D4A843', // gold
  '#8B5EA7', // mauve
  '#C4476C', // rose
  '#2D8F6F', // sage
  '#5B7FD6', // cornflower
  '#E08D3B', // tangerine
];

type RangeKey = '1M' | '3M' | '6M' | '1Y' | 'MAX';

const RANGE_OPTIONS: { value: RangeKey; label: string }[] = [
  { value: '1M', label: '1M' },
  { value: '3M', label: '3M' },
  { value: '6M', label: '6M' },
  { value: '1Y', label: '1Y' },
  { value: 'MAX', label: 'MAX' },
];

function getRangeCutoff(range: RangeKey): Date {
  const now = new Date();
  switch (range) {
    case '1M': return subMonths(now, 1);
    case '3M': return subMonths(now, 3);
    case '6M': return subMonths(now, 6);
    case '1Y': return subYears(now, 1);
    case 'MAX': return new Date(0);
  }
}

function extractValue(log: any): number {
  return Number(log.daily_value ?? log.value ?? log.total_amount ?? log.amount ?? 0);
}

function normalise(value: number, min: number, max: number): number {
  if (max === min) return 50;
  return ((value - min) / (max - min)) * 100;
}

// Apply a simple 3-point moving average to smooth out noise
function smooth(values: (number | undefined)[]): (number | undefined)[] {
  return values.map((v, i) => {
    if (v === undefined) return undefined;
    const prev = i > 0 ? values[i - 1] : undefined;
    const next = i < values.length - 1 ? values[i + 1] : undefined;
    const nums = [prev, v, next].filter((n): n is number => n !== undefined);
    return nums.reduce((a, b) => a + b, 0) / nums.length;
  });
}

interface ChartRow {
  date: string;
  label: string;
  [key: string]: number | string | undefined;
}

interface HabitInfo {
  habitId: string;
  name: string;
  unit: string;
  key: string;
  color: string;
  byDate: Record<string, number>;
  min: number;
  max: number;
  latestValue: number;
  change: number | undefined;
  dataPoints: number;
}

// Custom tooltip — clean, minimal
function OverlayTooltip({ active, payload, label, habitMeta }: any) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-lg border border-[rgba(39,37,30,0.08)] bg-white px-3 py-2 shadow-lg">
      <p className="mb-1.5 text-[11px] font-medium text-[rgba(39,37,30,0.45)]">{label}</p>
      {payload
        .filter((entry: any) => entry.value !== undefined)
        .sort((a: any, b: any) => (b.value ?? 0) - (a.value ?? 0))
        .map((entry: any) => {
          const meta = habitMeta[entry.dataKey];
          if (!meta) return null;
          return (
            <div key={entry.dataKey} className="flex items-center gap-2 py-[1px] text-[12px]">
              <span
                className="inline-block h-[6px] w-[6px] rounded-full"
                style={{ backgroundColor: entry.color }}
              />
              <span className="text-[#27251E]">{meta.name}</span>
              <span className="ml-auto pl-4 tabular-nums text-[rgba(39,37,30,0.55)]">
                {meta.rawValues[label] !== undefined
                  ? `${Number(meta.rawValues[label]).toLocaleString(undefined, { maximumFractionDigits: 1 })} ${meta.unit}`
                  : '—'}
              </span>
            </div>
          );
        })}
    </div>
  );
}

const MAX_VISIBLE = 5;

export function MultiHabitOverlayChart({ habits, height = 300 }: MultiHabitOverlayChartProps) {
  const [range, setRange] = useState<RangeKey>('1M');
  const [showAll, setShowAll] = useState(false);

  const { chartData, habitMeta, rankedHabits } = useMemo(() => {
    const cutoff = getRangeCutoff(range);

    // Build per-habit daily maps filtered to range
    const habitInfos: HabitInfo[] = habits.map((h, idx) => {
      const byDate: Record<string, number> = {};
      for (const log of h.logs) {
        if (!log.date) continue;
        const d = parseISO(log.date);
        if (d < cutoff) continue;
        const dateStr = log.date;
        const val = extractValue(log);
        byDate[dateStr] = (byDate[dateStr] || 0) + val;
      }
      const sortedDates = Object.keys(byDate).sort();
      const values = Object.values(byDate);
      const min = values.length > 0 ? Math.min(...values) : 0;
      const max = values.length > 0 ? Math.max(...values) : 0;

      // Compute latest value and % change (first half avg → second half avg)
      const latestValue = sortedDates.length > 0 ? byDate[sortedDates[sortedDates.length - 1]] : 0;
      let change: number | undefined;
      if (values.length >= 2) {
        const mid = Math.floor(values.length / 2);
        const firstHalf = values.slice(0, mid);
        const secondHalf = values.slice(mid);
        const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
        const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
        if (firstAvg > 0) {
          change = ((secondAvg - firstAvg) / firstAvg) * 100;
        }
      }

      return {
        ...h,
        byDate,
        min,
        max,
        latestValue,
        change,
        dataPoints: sortedDates.length,
        color: h.color || PALETTE[idx % PALETTE.length],
        key: `h_${idx}`,
      };
    });

    // Filter to habits with data, rank by data points
    const withData = habitInfos
      .filter((h) => h.dataPoints > 0)
      .sort((a, b) => b.dataPoints - a.dataPoints);

    // Collect all dates
    const allDates = new Set<string>();
    for (const h of withData) {
      for (const d of Object.keys(h.byDate)) allDates.add(d);
    }
    const sortedDates = [...allDates].sort();

    // Build chart rows with smoothed normalised values
    const rawRows: ChartRow[] = sortedDates.map((date) => {
      const row: ChartRow = {
        date,
        label: format(parseISO(date), 'MMM d'),
      };
      for (const h of withData) {
        const raw = h.byDate[date];
        if (raw !== undefined) {
          row[h.key] = normalise(raw, h.min, h.max);
        }
      }
      return row;
    });

    // Smooth each habit's values
    for (const h of withData) {
      const vals = rawRows.map((r) => r[h.key] as number | undefined);
      const smoothed = smooth(vals);
      for (let i = 0; i < rawRows.length; i++) {
        if (smoothed[i] !== undefined) {
          rawRows[i][h.key] = smoothed[i];
        }
      }
    }

    // Build meta for tooltip
    const meta: Record<string, { name: string; unit: string; rawValues: Record<string, number> }> = {};
    for (const h of withData) {
      meta[h.key] = {
        name: h.name,
        unit: h.unit,
        rawValues: Object.fromEntries(
          Object.entries(h.byDate).map(([d, v]) => [format(parseISO(d), 'MMM d'), v])
        ),
      };
    }

    return { chartData: rawRows, habitMeta: meta, rankedHabits: withData };
  }, [habits, range]);

  if (rankedHabits.length === 0) return null;

  const displayHabits = showAll ? rankedHabits : rankedHabits.slice(0, MAX_VISIBLE);
  const hiddenCount = rankedHabits.length - MAX_VISIBLE;

  // ~5-6 x-axis ticks
  const tickInterval = Math.max(1, Math.floor(chartData.length / 6));

  return (
    <div className="overflow-hidden rounded-xl border border-[rgba(39,37,30,0.08)] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
      {/* Header with range selector */}
      <div className="flex items-start justify-between px-4 pt-3 pb-1">
        <div>
          <h3 className="text-[14px] font-medium tracking-[-0.3px] text-[#27251E]">
            Habit Trends
          </h3>
          <p className="mt-0.5 text-[11px] tracking-[-0.1px] text-[rgba(39,37,30,0.4)]">
            Normalised comparison across all habits
          </p>
        </div>
        <div className="inline-flex items-center rounded-lg border border-[rgba(39,37,30,0.07)] bg-white p-[3px]">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setRange(opt.value)}
              className={cn(
                'h-[25px] min-w-[32px] rounded-md px-2 text-[11.5px] font-medium leading-[16px] tracking-[-0.4px] transition-all duration-150',
                range === opt.value
                  ? 'bg-[rgba(39,37,30,0.06)] text-[#27251E]'
                  : 'text-[rgba(39,37,30,0.5)] hover:text-[#27251E]'
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div className="px-2 pb-1">
        <ResponsiveContainer width="100%" height={height}>
          <LineChart
            data={chartData}
            margin={{ top: 8, right: 12, left: 0, bottom: 4 }}
          >
            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 10, fill: 'rgba(39,37,30,0.3)' }}
              interval={tickInterval}
            />
            <YAxis
              domain={[0, 100]}
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 10, fill: 'rgba(39,37,30,0.3)' }}
              tickFormatter={(v: number) => `${v}%`}
              width={36}
              ticks={[0, 20, 40, 60, 80, 100]}
            />

            <Tooltip
              content={<OverlayTooltip habitMeta={habitMeta} />}
              cursor={{ stroke: 'rgba(39,37,30,0.06)', strokeWidth: 1 }}
            />

            {displayHabits.map((h) => (
              <Line
                key={h.key}
                type="monotone"
                dataKey={h.key}
                stroke={h.color}
                strokeWidth={1.8}
                dot={false}
                activeDot={{ r: 3, strokeWidth: 0, fill: h.color }}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Perplexity-style legend table */}
      <div className="border-t border-[rgba(39,37,30,0.06)]">
        {displayHabits.map((h, idx) => (
          <div
            key={h.key}
            className={cn(
              'flex items-center gap-3 px-4 py-2',
              idx !== displayHabits.length - 1 && 'border-b border-[rgba(39,37,30,0.04)]'
            )}
          >
            <span
              className="inline-block h-[7px] w-[7px] shrink-0 rounded-full"
              style={{ backgroundColor: h.color }}
            />
            <span className="min-w-0 flex-1 truncate text-[13px] text-[#27251E]">
              {h.name}
            </span>
            <span className="shrink-0 text-[13px] tabular-nums text-[rgba(39,37,30,0.6)]">
              {h.latestValue.toLocaleString(undefined, { maximumFractionDigits: 1 })}{' '}
              <span className="text-[11px] text-[rgba(39,37,30,0.4)]">{h.unit}</span>
            </span>
            {h.change !== undefined ? (
              <span
                className={cn(
                  'ml-2 shrink-0 rounded-[4px] px-1.5 py-0.5 text-[11px] font-medium tabular-nums',
                  h.change >= 0
                    ? 'bg-[rgba(19,106,34,0.08)] text-[#136A22]'
                    : 'bg-[rgba(162,53,68,0.08)] text-[#A23544]'
                )}
              >
                {h.change >= 0 ? '↗' : '↘'} {Math.abs(h.change).toFixed(1)}%
              </span>
            ) : null}
          </div>
        ))}

        {/* "See N more" toggle */}
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => setShowAll(!showAll)}
            className="w-full px-4 py-2 text-left text-[12px] text-[rgba(39,37,30,0.4)] transition-colors hover:text-[rgba(39,37,30,0.6)]"
          >
            {showAll ? 'Show fewer' : `See ${hiddenCount} more`}
          </button>
        )}
      </div>
    </div>
  );
}

export default MultiHabitOverlayChart;
