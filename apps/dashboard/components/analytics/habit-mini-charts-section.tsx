'use client'

import React, { useMemo, useState } from 'react'
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { eachDayOfInterval, format, startOfDay, subDays } from 'date-fns'
import {
  buildMetricsBarData,
  formatMetricBarValue,
  type MetricDailyRow,
  type MetricHabitLike,
} from '@/components/analytics/metrics-derived'
import { ExpandedChartTooltip } from '@/components/charts/ChartTooltip'
import {
  RangeSegmentedControl,
  type RangeOption,
} from '@/components/metrics/RangeSegmentedControl'
import type { RangeKey } from '@/components/charts/PerplexityExpandedHabitChart'

const COMPUTER_ACTIVITY_SOURCE_ID = '__computer_activity__'

export interface HabitSparkSource {
  habitId: string
  name: string
  unit: string
  higherIsBetter: boolean | null
  /** Per-day log rows for regular habits. Empty for computer activity. */
  logs: MetricDailyRow[]
  /** Only provided for the synthetic computer activity source. */
  computerActivityDaily?: MetricDailyRow[]
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
  sources: HabitSparkSource[]
  emptyHint?: string
  defaultRange?: RangeKey
  rangeOptions?: RangeOption[]
}

function getRangeDatesForCard(range: RangeKey): { from: Date; to: Date } {
  const now = new Date()
  const today = startOfDay(now)
  switch (range) {
    case '1D': return { from: today, to: now }
    case '5D': return { from: subDays(today, 4), to: now }
    case '1W': return { from: subDays(today, 6), to: now }
    case '1M': return { from: subDays(today, 29), to: now }
    case '3M': return { from: subDays(today, 89), to: now }
    case '6M': return { from: subDays(today, 179), to: now }
    case 'YTD': return { from: startOfDay(new Date(now.getFullYear(), 0, 1)), to: now }
    case '1Y': return { from: subDays(today, 364), to: now }
    case '5Y': return { from: subDays(today, 365 * 5 - 1), to: now }
    case 'MAX':
    case 'ALL':
      return { from: subDays(today, 365 * 5 - 1), to: now }
    default:
      return { from: subDays(today, 29), to: now }
  }
}

function rangeToLabel(range: RangeKey): string {
  switch (range) {
    case '1D': return 'Today'
    case '5D': return 'Last 5 days'
    case '1W': return 'Last 7 days'
    case '1M': return 'Last 30 days'
    case '3M': return 'Last 90 days'
    case '6M': return 'Last 6 months'
    case 'YTD': return 'Year to date'
    case '1Y': return 'Last 12 months'
    case '5Y': return 'Last 5 years'
    case 'MAX':
    case 'ALL':
      return 'All time'
    default: return ''
  }
}

interface CardSeries {
  avg: number
  total: number
  change?: number
  daysWithData: number
  data: { date: string; t: number; label: string; value: number }[]
}

function buildCardSeries(source: HabitSparkSource, range: RangeKey): CardSeries {
  const { from, to } = getRangeDatesForCard(range)
  const days = eachDayOfInterval({ start: from, end: to })
  const showShortLabel = days.length > 14
  const toKey = (d: Date) => format(d, 'yyyy-MM-dd')

  const isComputer = source.habitId === COMPUTER_ACTIVITY_SOURCE_ID
  const habitRecord: MetricHabitLike = {
    habit_id: source.habitId,
    habit_name: source.name,
    unit_type: source.unit,
  }

  const barData = buildMetricsBarData({
    habits: isComputer ? [] : [habitRecord],
    analyticsDataByHabit: isComputer ? {} : { [source.habitId]: source.logs },
    summaryByHabit: {},
    rangeFrom: from,
    rangeTo: to,
    computerActivityDaily: isComputer ? (source.computerActivityDaily ?? []) : [],
  })
  const meta = barData.find((d) => d.habitId === source.habitId)

  const dailyMap = new Map<string, number>()
  if (isComputer) {
    for (const row of source.computerActivityDaily ?? []) {
      if (!row.day) continue
      dailyMap.set(
        String(row.day),
        (dailyMap.get(String(row.day)) ?? 0) + Number(row.active_hours || 0),
      )
    }
  } else {
    for (const log of source.logs) {
      if (!log.date) continue
      const v = Number(log.daily_value ?? log.value ?? log.total_amount ?? 0)
      dailyMap.set(log.date, (dailyMap.get(log.date) ?? 0) + v)
    }
  }

  const data = days.map((day) => {
    const key = toKey(day)
    return {
      date: key,
      t: day.getTime(),
      label: showShortLabel ? format(day, 'M/d') : format(day, 'MMM d'),
      value: dailyMap.get(key) ?? 0,
    }
  })

  return {
    avg: meta?.avg ?? 0,
    total: data.reduce((s, d) => s + d.value, 0),
    change: meta?.change,
    daysWithData: meta?.daysWithData ?? 0,
    data,
  }
}

function MiniBarChartCard({
  source,
  defaultRange,
  rangeOptions,
}: {
  source: HabitSparkSource
  defaultRange: RangeKey
  rangeOptions: RangeOption[]
}) {
  const [range, setRange] = useState<RangeKey>(defaultRange)
  const series = useMemo(() => buildCardSeries(source, range), [source, range])

  const maxValue = useMemo(() => {
    const max = Math.max(...series.data.map((d) => d.value), 0)
    return max > 0 ? max : 1
  }, [series.data])

  const displayValue = formatMetricBarValue(series.avg, source.unit)

  const changeText =
    series.change === undefined || !Number.isFinite(series.change)
      ? null
      : `${series.change >= 0 ? '+' : ''}${Math.round(series.change)}%`

  const changeColor = (() => {
    if (changeText === null) return 'text-[rgba(39,37,30,0.40)]'
    if (source.higherIsBetter === null || source.higherIsBetter === undefined) {
      return 'text-[rgba(39,37,30,0.55)]'
    }
    const goodDirection =
      (series.change! >= 0 && source.higherIsBetter) ||
      (series.change! < 0 && !source.higherIsBetter)
    return goodDirection ? 'text-emerald-600' : 'text-red-500'
  })()

  const tickInterval = useMemo(() => {
    if (series.data.length <= 8) return 0
    return Math.max(0, Math.floor(series.data.length / 6) - 1)
  }, [series.data.length])

  return (
    <div className="border border-[rgba(39,37,30,0.08)] bg-white rounded-sm overflow-hidden flex min-h-[292px] flex-col h-full shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
      <div className="flex items-start justify-between px-5 pt-4 pb-1 gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-[#27251E] truncate">{source.name}</div>
          <div className="text-[11px] font-normal text-[rgba(39,37,30,0.40)]">
            {rangeToLabel(range)}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[13px] font-medium tabular-nums text-[#27251E]">{displayValue}</div>
          {changeText ? (
            <div className={`text-[11px] tabular-nums ${changeColor}`}>{changeText}</div>
          ) : null}
        </div>
      </div>

      <div className="px-3 pb-1">
        <RangeSegmentedControl
          value={range}
          onValueChange={(next) => setRange(next as RangeKey)}
          options={rangeOptions}
          className="w-full justify-start overflow-x-auto"
        />
      </div>

      <div className="flex-1 min-h-0 px-2 pb-3">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={series.data} margin={{ top: 12, right: 8, bottom: 2, left: 8 }}>
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
                  unit={source.unit}
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
  sources,
  emptyHint,
  defaultRange = '1M',
  rangeOptions = DEFAULT_MINI_CHART_RANGE_OPTIONS,
}: HabitMiniChartsSectionProps) {
  if (sources.length === 0) {
    return emptyHint ? (
      <div className="flex min-h-[90px] items-center justify-center rounded-sm border border-dashed border-[rgba(39,37,30,0.12)] bg-white/60 text-[12px] text-[rgba(39,37,30,0.45)]">
        {emptyHint}
      </div>
    ) : null
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-[5px]">
      {sources.map((source) => (
        <MiniBarChartCard
          key={source.habitId}
          source={source}
          defaultRange={defaultRange}
          rangeOptions={rangeOptions}
        />
      ))}
    </div>
  )
}
