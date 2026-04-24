'use client';

import React from 'react';
import { useOverviewWidgetMetrics } from '@/hooks/use-overview-widget-metrics';

/**
 * Formats an hours number as a short label, e.g. 4.25 -> "4.3h", 12 -> "12h".
 * Returns null when the input is null so callers can render the empty state.
 */
function formatHours(hours: number | null): string | null {
  if (hours === null || !Number.isFinite(hours)) return null;
  if (hours >= 10) return `${Math.round(hours)}h`;
  return `${hours.toFixed(1)}h`;
}

function formatCount(value: number): string {
  return value.toLocaleString();
}

function pluralize(count: number, singular: string, plural?: string): string {
  if (count === 1) return singular;
  return plural ?? `${singular}s`;
}

interface CardProps {
  title: string;
  /** Main value, or null to render the muted "Not tracked yet" fallback. */
  value: string | null;
  /** Muted subtitle below the value. */
  subtitle?: string | null;
  /** When true, render the not-tracked-yet empty state regardless of value. */
  emptyState?: boolean;
}

function SummaryCard({ title, value, subtitle, emptyState = false }: CardProps) {
  const isEmpty = emptyState || value === null;

  return (
    <div className="flex h-full min-h-[104px] flex-col justify-between rounded-sm border border-[#e6e6e6] bg-white px-4 py-3">
      <span className="text-[12px] font-normal leading-4 text-[rgba(39,37,30,0.58)]">
        {title}
      </span>

      {isEmpty ? (
        <span className="text-[13px] font-normal text-[rgba(39,37,30,0.42)]">
          Not tracked yet
        </span>
      ) : (
        <div className="flex items-baseline gap-1.5 min-w-0">
          <span className="text-[22px] font-normal leading-[1.15] tabular-nums text-[#27251E] truncate">
            {value}
          </span>
          {subtitle ? (
            <span className="text-[12px] font-normal leading-4 text-[rgba(39,37,30,0.58)] tabular-nums truncate">
              {subtitle}
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function OverviewSummaryCards() {
  const metrics = useOverviewWidgetMetrics();

  // 1. Today
  const todayValue = formatCount(metrics.today.logCount);
  const todaySubtitle = metrics.today.logCount === 0
    ? 'No logs yet'
    : metrics.today.topHabitName
      ? `top: ${metrics.today.topHabitName}`
      : null;

  // 2. This week
  const weekValue = formatCount(metrics.week.thisWeekCount);
  const weekDelta = metrics.week.deltaPct;
  let weekSubtitle: string | null = null;
  if (metrics.week.lastWeekCount === 0 && metrics.week.thisWeekCount === 0) {
    weekSubtitle = 'No logs this week';
  } else if (weekDelta === null) {
    weekSubtitle = 'vs 0 last week';
  } else if (weekDelta === 0) {
    weekSubtitle = 'same as last week';
  } else {
    const sign = weekDelta > 0 ? '+' : '';
    weekSubtitle = `${sign}${weekDelta}% vs last week`;
  }

  // 3. Active streak
  const streakValue = formatCount(metrics.streak.days);
  const streakSubtitle =
    metrics.streak.days === 0 ? 'start a streak today' : pluralize(metrics.streak.days, 'day');

  // 4. Most tracked (7d)
  const mostTrackedEmpty = !metrics.mostTracked.habitName || metrics.mostTracked.count === 0;
  const mostTrackedValue = mostTrackedEmpty ? null : metrics.mostTracked.habitName!;
  const mostTrackedSubtitle = mostTrackedEmpty
    ? null
    : `${metrics.mostTracked.count} ${pluralize(metrics.mostTracked.count, 'log')} · 7d`;

  // 5. Sleep
  const sleepLastNight = formatHours(metrics.sleep.lastNightHours);
  const sleepAvg = formatHours(metrics.sleep.sevenDayAvgHours);
  const sleepEmpty = sleepLastNight === null && sleepAvg === null;
  const sleepValue = sleepEmpty ? null : sleepLastNight ?? sleepAvg;
  const sleepSubtitle = sleepEmpty
    ? null
    : sleepAvg
      ? `7d avg ${sleepAvg}`
      : null;

  // 6. Computer Time — yesterday + past 7 days
  const computerYesterday = formatHours(metrics.computerTime.yesterdayHours);
  const computerSevenDay = formatHours(metrics.computerTime.sevenDayHours);
  const computerEmpty = computerYesterday === null && computerSevenDay === null;
  const computerValue = computerEmpty ? null : computerYesterday ?? '0h';
  const computerSubtitle = computerEmpty
    ? null
    : computerSevenDay
      ? `${computerSevenDay} past 7 days`
      : null;

  return (
    <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <SummaryCard title="Today" value={todayValue} subtitle={todaySubtitle} />
      <SummaryCard title="This week" value={weekValue} subtitle={weekSubtitle} />
      <SummaryCard title="Active streak" value={streakValue} subtitle={streakSubtitle} />
      <SummaryCard
        title="Most tracked (7d)"
        value={mostTrackedValue}
        subtitle={mostTrackedSubtitle}
        emptyState={mostTrackedEmpty}
      />
      <SummaryCard
        title="Sleep"
        value={sleepValue}
        subtitle={sleepSubtitle}
        emptyState={sleepEmpty}
      />
      <SummaryCard
        title="Computer Time"
        value={computerValue}
        subtitle={computerSubtitle}
        emptyState={computerEmpty}
      />
    </div>
  );
}

export default OverviewSummaryCards;
