'use client'

import React, { useMemo } from 'react'
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { format } from 'date-fns'
import { formatMetricBarValue } from '@/components/analytics/metrics-derived'
import { ExpandedChartTooltip } from '@/components/charts/ChartTooltip'
import {
  RangeSegmentedControl,
  type RangeOption,
} from '@/components/metrics/RangeSegmentedControl'

export interface HabitSparkPoint {
  /** ISO date string (yyyy-MM-dd) for the day this bar represents. */
  date: string
  /** Epoch millis for the start of the local day — used by the tooltip. */
  t: number
  /** Short label shown under the bar (e.g. "Mar 20"). */
  label: string
  value: number
}

export interface HabitSparkSeries {
  habitId: string
  name: string
  unit: string
  avg: number
  total: number
  change?: number
  higherIsBetter: boolean | null
  daysWithData: number
  data: HabitSparkPoint[]
}

export const DEFAULT_MINI_CHART_RANGE_OPTIONS: RangeOption[] = [
  { value: '1D', label: '1D' },
  { value: '5D', label: '5D' },
  { value: '1W', label: '1W' },
  { value: '1M', label: '1M' },
  { value: '6M', label: '6M' },
  { value: 'YTD', label: 'YTD' },
  { value: '1Y', label: '1Y' },
  { value: '5Y', label: '5Y' },
  { value: 'MAX', label: 'MAX' },
]

interface HabitMiniChartsSectionProps {
  series: HabitSparkSeries[]
  rangeLabel: string
  range: string
  onRangeChange: (value: string) => void
  rangeOptions?: RangeOption[]
  /** Shown centered in the empty state row when `series` is empty. */
  emptyHint?: string
}

function MiniBarChartCard({
  habit,
  rangeLabel,
}: {
  habit: HabitSparkSeries
  rangeLabel: string
}) {
  const maxValue = useMemo(() => {
    const max = Math.max(...habit.data.map((d) => d.value), 0)
    return max > 0 ? max : 1
  }, [habit.data])

  const displayValue = formatMetricBarValue(habit.avg, habit.unit)

  const changeText =
    habit.change === undefined || habit.change === null || !Number.isFinite(habit.change)
      ? null
      : `${habit.change >= 0 ? '+' : ''}${Math.round(habit.change)}%`

  const changeColor = (() => {
    if (changeText === null) return 'text-[rgba(39,37,30,0.40)]'
    if (habit.higherIsBetter === null || habit.higherIsBetter === undefined) {
      return 'text-[rgba(39,37,30,0.55)]'
    }
    const goodDirection =
      (habit.change! >= 0 && habit.higherIsBetter) ||
      (habit.change! < 0 && !habit.higherIsBetter)
    return goodDirection ? 'text-emerald-600' : 'text-red-500'
  })()

  const tickInterval = useMemo(() => {
    if (habit.data.length <= 8) return 0
    return Math.max(0, Math.floor(habit.data.length / 6) - 1)
  }, [habit.data.length])

  return (
    <div className="border border-[rgba(39,37,30,0.08)] bg-white rounded-sm overflow-hidden flex min-h-[292px] flex-col h-full shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
      <div className="flex items-start justify-between px-5 pt-4 pb-1">
        <div className="min-w-0 flex-1 pr-3">
          <div className="text-[13px] font-medium text-[#27251E] truncate">{habit.name}</div>
          <div className="text-[11px] font-normal text-[rgba(39,37,30,0.40)]">{rangeLabel}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[13px] font-medium tabular-nums text-[#27251E]">{displayValue}</div>
          {changeText ? (
            <div className={`text-[11px] tabular-nums ${changeColor}`}>{changeText}</div>
          ) : null}
        </div>
      </div>
      <div className="flex-1 min-h-0 px-2 pb-3">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={habit.data} margin={{ top: 12, right: 8, bottom: 2, left: 8 }}>
            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 10, fill: 'rgba(39,37,30,0.40)' }}
              interval={tickInterval}
              minTickGap={8}
            />
            <YAxis hide domain={[0, maxValue]} />
            <Tooltip
              cursor={{ fill: 'rgba(39,37,30,0.04)' }}
              content={(
                <ExpandedChartTooltip
                  unit={habit.unit}
                  valueKey="value"
                  dateKey="t"
                />
              )}
            />
            <Bar
              dataKey="value"
              fill="#27251E"
              fillOpacity={0.85}
              radius={[2, 2, 0, 0]}
              maxBarSize={12}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export function HabitMiniChartsSection({
  series,
  rangeLabel,
  range,
  onRangeChange,
  rangeOptions = DEFAULT_MINI_CHART_RANGE_OPTIONS,
  emptyHint,
}: HabitMiniChartsSectionProps) {
  // Cap the grid so a single pinned habit takes the full card width (same
  // dimensions as the Habits/Apps cards above), while 2–4 pins tile in a
  // 2-column grid — matching the Top Apps layout.
  const gridColsClass = series.length <= 1 ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-2'
  return (
    <div>
      <div className="mb-[10px] flex items-center justify-end">
        <RangeSegmentedControl
          value={range}
          onValueChange={onRangeChange}
          options={rangeOptions}
        />
      </div>
      {series.length > 0 ? (
        <div className={`grid ${gridColsClass} gap-[5px]`}>
          {series.map((habit) => (
            <MiniBarChartCard key={habit.habitId} habit={habit} rangeLabel={rangeLabel} />
          ))}
        </div>
      ) : emptyHint ? (
        <div className="flex min-h-[90px] items-center justify-center rounded-sm border border-dashed border-[rgba(39,37,30,0.12)] bg-white/60 text-[12px] text-[rgba(39,37,30,0.45)]">
          {emptyHint}
        </div>
      ) : null}
    </div>
  )
}

// Exported for callers that only need a stable formatter (kept co-located so
// all mini-chart UI + label formatting lives here).
export function formatHabitSparkLabel(date: Date): string {
  return format(date, 'MMM d')
}
