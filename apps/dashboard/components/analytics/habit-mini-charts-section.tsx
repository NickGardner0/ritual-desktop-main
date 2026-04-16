'use client'

import React, { useMemo } from 'react'
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { format } from 'date-fns'
import { formatMetricBarValue } from '@/components/analytics/metrics-derived'

export interface HabitSparkPoint {
  date: string
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

interface HabitMiniChartsSectionProps {
  series: HabitSparkSeries[]
  rangeLabel: string
}

function formatTooltipValue(value: number, unit: string): string {
  return formatMetricBarValue(Math.max(0, Number(value) || 0), unit)
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
              contentStyle={{
                border: '1px solid rgba(39,37,30,0.08)',
                borderRadius: '4px',
                fontSize: '11px',
                padding: '4px 8px',
                boxShadow: '0 2px 6px rgba(0,0,0,0.06)',
                background: 'white',
              }}
              labelStyle={{ color: 'rgba(39,37,30,0.40)', fontSize: '10px' }}
              itemStyle={{ color: '#27251E', fontSize: '11px', padding: 0 }}
              formatter={(value: number) => [formatTooltipValue(value, habit.unit), habit.name]}
              separator=": "
            />
            <Bar dataKey="value" fill="#2f7d4f" radius={[2, 2, 0, 0]} maxBarSize={12} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export function HabitMiniChartsSection({ series, rangeLabel }: HabitMiniChartsSectionProps) {
  if (series.length === 0) return null
  return (
    <div className="mt-[5px] grid grid-cols-1 lg:grid-cols-2 gap-[5px]">
      {series.map((habit) => (
        <MiniBarChartCard key={habit.habitId} habit={habit} rangeLabel={rangeLabel} />
      ))}
    </div>
  )
}

// Exported for callers that only need a stable formatter (kept co-located so
// all mini-chart UI + label formatting lives here).
export function formatHabitSparkLabel(date: Date): string {
  return format(date, 'MMM d')
}
