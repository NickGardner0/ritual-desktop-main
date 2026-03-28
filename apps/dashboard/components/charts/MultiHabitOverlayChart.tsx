'use client';

import React, { useMemo, useId } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from 'recharts';
import { format, parseISO } from 'date-fns';

/**
 * Multi-habit overlay chart — Perplexity Finance "multi-line" style.
 * Normalises each habit to 0–100% scale so they can be compared
 * on the same axes regardless of unit.
 */

interface HabitSeries {
  habitId: string;
  name: string;
  unit: string;
  /** Daily log rows — each must have `.date` (YYYY-MM-DD) and a numeric value field */
  logs: any[];
  color: string;
}

interface MultiHabitOverlayChartProps {
  habits: HabitSeries[];
  height?: number;
}

// Curated palette that looks good on white — inspired by Perplexity Finance
const PALETTE = [
  '#2563EB', // blue
  '#DC2626', // red
  '#059669', // emerald
  '#D97706', // amber
  '#7C3AED', // violet
  '#0891B2', // cyan
  '#DB2777', // pink
  '#4F46E5', // indigo
  '#65A30D', // lime
  '#EA580C', // orange
  '#6366F1', // periwinkle
  '#0D9488', // teal
];

function extractValue(log: any): number {
  return Number(log.daily_value ?? log.value ?? log.total_amount ?? log.amount ?? 0);
}

/** Normalise a value to 0-100 % within a min/max range */
function normalise(value: number, min: number, max: number): number {
  if (max === min) return 50;
  return ((value - min) / (max - min)) * 100;
}

interface ChartRow {
  date: string;
  label: string;
  [key: string]: number | string | undefined;
}

// Custom tooltip
function OverlayTooltip({ active, payload, label, habitMeta }: any) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-lg border border-[rgba(39,37,30,0.08)] bg-white px-3 py-2 shadow-lg">
      <p className="mb-1 text-[11px] font-medium text-[rgba(39,37,30,0.5)]">{label}</p>
      {payload.map((entry: any) => {
        const meta = habitMeta[entry.dataKey];
        if (!meta) return null;
        return (
          <div key={entry.dataKey} className="flex items-center gap-2 text-[12px]">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: entry.color }}
            />
            <span className="text-[#27251E]">{meta.name}</span>
            <span className="ml-auto tabular-nums text-[rgba(39,37,30,0.6)]">
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

export function MultiHabitOverlayChart({ habits, height = 320 }: MultiHabitOverlayChartProps) {
  const chartId = useId().replace(/[^a-zA-Z0-9_-]/g, '');

  const { chartData, habitMeta, visibleHabits } = useMemo(() => {
    // Build per-habit daily maps and compute min/max for normalisation
    const habitInfos = habits.map((h, idx) => {
      const byDate: Record<string, number> = {};
      for (const log of h.logs) {
        if (!log.date) continue;
        const dateStr = log.date;
        const val = extractValue(log);
        byDate[dateStr] = (byDate[dateStr] || 0) + val;
      }
      const values = Object.values(byDate);
      const min = values.length > 0 ? Math.min(...values) : 0;
      const max = values.length > 0 ? Math.max(...values) : 0;
      return {
        ...h,
        byDate,
        min,
        max,
        color: h.color || PALETTE[idx % PALETTE.length],
        key: `h_${idx}`,
      };
    });

    // Only include habits that have data
    const withData = habitInfos.filter((h) => Object.keys(h.byDate).length > 0);

    // Collect all unique dates
    const allDates = new Set<string>();
    for (const h of withData) {
      for (const d of Object.keys(h.byDate)) allDates.add(d);
    }
    const sortedDates = [...allDates].sort();

    // Build chart rows
    const rows: ChartRow[] = sortedDates.map((date) => {
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

    // Build meta for tooltip (raw values lookup)
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

    return { chartData: rows, habitMeta: meta, visibleHabits: withData };
  }, [habits]);

  if (visibleHabits.length === 0) return null;

  // Show ~6 x-axis ticks
  const tickInterval = Math.max(1, Math.floor(chartData.length / 6));

  return (
    <div className="overflow-hidden rounded-xl border border-[rgba(39,37,30,0.08)] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
      <div className="px-4 pt-3 pb-1">
        <h3 className="text-[14px] font-medium tracking-[-0.3px] text-[#27251E]">
          All Habits
        </h3>
        <p className="mt-0.5 text-[11px] tracking-[-0.1px] text-[rgba(39,37,30,0.4)]">
          Normalised comparison (0–100% of each habit's range)
        </p>
      </div>

      <div className="px-2 pb-2">
        <ResponsiveContainer width="100%" height={height}>
          <LineChart
            data={chartData}
            margin={{ top: 8, right: 12, left: 0, bottom: 4 }}
          >
            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 10, fill: 'rgba(39,37,30,0.35)' }}
              interval={tickInterval}
            />
            <YAxis
              domain={[0, 100]}
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 10, fill: 'rgba(39,37,30,0.35)' }}
              tickFormatter={(v: number) => `${v}%`}
              width={36}
            />

            <Tooltip
              content={<OverlayTooltip habitMeta={habitMeta} />}
              cursor={{ stroke: 'rgba(39,37,30,0.08)', strokeWidth: 1 }}
            />

            {visibleHabits.map((h) => (
              <Line
                key={h.key}
                type="linear"
                dataKey={h.key}
                stroke={h.color}
                strokeWidth={1.5}
                dot={false}
                activeDot={{ r: 3, strokeWidth: 0, fill: h.color }}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-[rgba(39,37,30,0.06)] px-4 py-2.5">
        {visibleHabits.map((h) => (
          <div key={h.key} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: h.color }}
            />
            <span className="text-[11px] text-[rgba(39,37,30,0.6)]">{h.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default MultiHabitOverlayChart;
