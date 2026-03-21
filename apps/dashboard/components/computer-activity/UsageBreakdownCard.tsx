/**
 * UsageBreakdownCard
 * 
 * Compact daily usage breakdown card for a selected app/domain.
 */

'use client'

import React from 'react'
import { X } from 'lucide-react'
import { BarChart, Bar, XAxis, ResponsiveContainer, Tooltip } from 'recharts'
import { msToHuman } from '@/lib/computerActivity/derive'
import type { BreakdownPoint, UsageBreakdownKind } from '@ritual/shared-contracts/computer-activity'
import { AppIcon } from './RankedBars'

interface UsageBreakdownCardProps {
  kind: UsageBreakdownKind
  label: string
  itemKey: string
  rangeLabel: string
  startDate: string
  endDate: string
  points: BreakdownPoint[]
  totalSeconds: number
  totalMs?: number
  isLoading: boolean
  error?: string | null
  hint?: string | null
  onClose?: () => void
}

function formatLocalDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function LoadingBars() {
  return (
    <div className="h-[180px] w-full">
      <div className="flex items-end gap-1 h-full">
        {Array.from({ length: 12 }).map((_, index) => (
          <div
            key={`skeleton-${index}`}
            className="flex-1 bg-gray-100 animate-pulse rounded-sm"
            style={{ height: `${25 + (index % 6) * 10}%` }}
          />
        ))}
      </div>
    </div>
  )
}

function UsageTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const data = payload[0].payload
  return (
    <div
      className="px-2 py-1.5 border border-white/50 shadow-[0_10px_35px_rgba(15,23,42,0.16)] text-[11px] leading-snug rounded-md"
      style={{
        background: 'linear-gradient(145deg, rgba(255,255,255,0.75), rgba(255,255,255,0.55))',
        backdropFilter: 'blur(18px) saturate(200%)',
        WebkitBackdropFilter: 'blur(18px) saturate(200%)',
      }}
    >
      <div className="font-medium text-gray-900">{data.label}</div>
      <div className="text-gray-600">Total: {msToHuman(data.activeMs || data.seconds * 1000, true)}</div>
      <div className="text-gray-500">
        {data.startTime && data.endTime ? `${data.startTime}–${data.endTime}` : 'No active sessions'}
      </div>
    </div>
  )
}

export function UsageBreakdownCard({
  kind,
  label,
  itemKey,
  rangeLabel,
  startDate,
  endDate,
  points,
  totalSeconds,
  totalMs: totalMsProp,
  isLoading,
  error,
  hint,
  onClose,
}: UsageBreakdownCardProps) {
  const totalMs = totalMsProp ?? totalSeconds * 1000
  const avgMs = points.length ? Math.round(totalMs / points.length) : 0
  const isEmpty = !isLoading && !error && totalMs === 0
  const isApp = kind === 'app'
  const chartData = points.map((point) => ({
    date: point.date,
    label: formatLocalDate(point.date),
    seconds: point.seconds,
    activeMs: point.activeMs,
    startTime: point.startTime,
    endTime: point.endTime,
  }))

  return (
    <div className="rounded-sm border border-[rgba(39,37,30,0.07)] bg-[rgba(39,26,0,0.02)] px-3 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <div className="mt-0.5 text-gray-400">
            {isApp ? (
              <AppIcon appName={label} bundleId={itemKey} className="w-4 h-4 rounded" />
            ) : (
              <img
                src={`https://www.google.com/s2/favicons?domain=${label}&sz=64`}
                alt=""
                className="w-4 h-4 rounded"
                onError={(e) => {
                  e.currentTarget.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%239ca3af" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>'
                }}
              />
            )}
          </div>
          <div>
            <p className="text-[13px] font-medium tracking-[-0.02em] text-[#27251E]">
              {label} · Daily usage ({rangeLabel})
            </p>
            <p className="text-[11px] text-[rgba(39,37,30,0.42)]">
              {formatLocalDate(startDate)} → {formatLocalDate(endDate)}
            </p>
          </div>
        </div>
        <div className="flex items-start gap-2 text-right">
          <div>
            <p className="text-[11px] text-[rgba(39,37,30,0.42)]">Total</p>
            <p className="text-[13px] font-medium text-[#27251E] tabular-nums">
              {msToHuman(totalMs, true)}
            </p>
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-sm p-1 text-[rgba(39,37,30,0.42)] transition-colors hover:text-[#27251E]"
              aria-label="Close breakdown"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {hint && (
        <p className="mt-2 text-[11px] text-[rgba(39,37,30,0.42)]">{hint}</p>
      )}

      <div className="mt-3">
        {isLoading ? (
          <LoadingBars />
        ) : error ? (
          <p className="text-xs text-red-500">Failed to load breakdown.</p>
        ) : isEmpty ? (
          <p className="text-xs text-gray-400">
            No activity recorded for this item in this range.
          </p>
        ) : (
          <div className="h-[180px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <XAxis
                  dataKey="label"
                  stroke="#9CA3AF"
                  tick={{ fill: '#6B7280', fontSize: 11 }}
                  axisLine={{ stroke: '#E5E7EB' }}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <Tooltip content={<UsageTooltip />} cursor={{ fill: 'rgba(0,0,0,0.05)' }} />
                <Bar
                  dataKey="seconds"
                  fill="#1F2937"
                  radius={[0, 0, 0, 0]}
                  maxBarSize={28}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {!isLoading && !error && !isEmpty && (
          <div className="mt-2 flex items-center justify-between text-[11px] text-[rgba(39,37,30,0.42)]">
            <span className="tabular-nums">Avg/day: {msToHuman(avgMs, true)}</span>
            <span>
              {points.length} {points.length === 1 ? 'day' : 'days'}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

export default UsageBreakdownCard
