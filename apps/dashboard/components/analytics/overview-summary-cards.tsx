'use client';

import React from 'react';
import { Card } from '@ritual/ui/card';
import { useOverviewWidgetMetrics } from '@/hooks/use-overview-widget-metrics';

function Sparkline({ data }: { data: number[] }) {
  const max = Math.max(...data, 0);
  if (max <= 0) return null;

  return (
    <div className="mt-3 flex h-4 items-end gap-[3px]" aria-hidden="true">
      {data.map((value, index) => (
        <span
          key={index}
          className="min-w-[3px] flex-1 rounded-[1px] bg-[var(--text-primary)]"
          style={{
            height: `${Math.max(12, Math.round((value / max) * 100))}%`,
            opacity: value > 0 ? 0.88 : 0.16,
          }}
        />
      ))}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  detail,
  sparkline,
}: {
  label: string;
  value: string;
  detail?: string;
  sparkline?: number[];
}) {
  return (
    <Card
      density="compact"
      className="flex h-full min-h-[128px] flex-col justify-between p-5 shadow-none transition-none hover:border-[var(--border-floating)]"
    >
      <span className="text-[12px] font-medium leading-none tracking-[-0.01em] text-[var(--text-muted)]">
        {label}
      </span>
      <div className="mt-6 min-w-0">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-[22px] font-medium leading-none tracking-[-0.03em] text-[var(--text-primary)] tabular-nums">
            {value}
          </span>
          {detail ? (
            <span className="min-w-0 truncate text-[12px] leading-none text-[var(--text-muted)]">
              {detail}
            </span>
          ) : null}
        </div>
        {sparkline ? <Sparkline data={sparkline} /> : null}
      </div>
    </Card>
  );
}

function formatHours(hours: number | null): string | null {
  if (hours === null || !Number.isFinite(hours)) return null;
  if (hours >= 10) return `${Math.round(hours)}h`;
  return `${hours.toFixed(1)}h`;
}

function pluralize(count: number, singular: string, plural?: string): string {
  if (count === 1) return singular;
  return plural ?? `${singular}s`;
}

export function OverviewSummaryCards() {
  const metrics = useOverviewWidgetMetrics();

  const todayDetail =
    metrics.today.logCount === 0
      ? 'No logs yet'
      : metrics.today.topHabitName
        ? `mostly ${metrics.today.topHabitName}`
        : pluralize(metrics.today.logCount, 'log');

  let weekDetail: string;
  if (metrics.week.thisWeekCount === 0 && metrics.week.lastWeekCount === 0) {
    weekDetail = 'No logs this week';
  } else if (metrics.week.deltaPct === null) {
    weekDetail = 'First week tracking';
  } else if (metrics.week.deltaPct === 0) {
    weekDetail = 'Same as last week';
  } else {
    const sign = metrics.week.deltaPct > 0 ? '+' : '';
    weekDetail = `${sign}${metrics.week.deltaPct}% vs last week`;
  }
  const weekSparkline = metrics.week.dailyCounts.some((value) => value > 0)
    ? metrics.week.dailyCounts
    : undefined;

  const streakDetail =
    metrics.streak.days === 0
      ? 'Log today to start'
      : pluralize(metrics.streak.days, 'day');

  const mostTrackedEmpty = !metrics.mostTracked.habitName || metrics.mostTracked.count === 0;

  const sleepLastNight = formatHours(metrics.sleep.lastNightHours);
  const sleepAvg = formatHours(metrics.sleep.sevenDayAvgHours);
  const sleepEmpty = sleepLastNight === null && sleepAvg === null;
  const sleepSparkline = metrics.sleep.dailySeries.some((value) => value > 0)
    ? metrics.sleep.dailySeries
    : undefined;
  const sleepValue = sleepLastNight ?? sleepAvg ?? '—';
  const sleepDetail = sleepEmpty
    ? 'Not tracked yet'
    : sleepLastNight && sleepAvg && sleepLastNight !== sleepAvg
      ? `7-day avg ${sleepAvg}`
      : sleepLastNight
        ? 'Last night'
        : '7-day average';

  const computerYesterday = formatHours(metrics.computerTime.yesterdayHours);
  const computerSevenDay = formatHours(metrics.computerTime.sevenDayHours);
  const computerEmpty = computerYesterday === null && computerSevenDay === null;
  const computerSparkline = metrics.computerTime.dailySeries.some((value) => value > 0)
    ? metrics.computerTime.dailySeries
    : undefined;
  const computerValue = computerYesterday ?? computerSevenDay ?? '—';
  const computerDetail = computerEmpty
    ? 'Not tracked yet'
    : computerYesterday && computerSevenDay
      ? `${computerSevenDay} over 7 days`
      : computerYesterday
        ? 'Yesterday'
        : 'Past 7 days';

  return (
    <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <SummaryCard
        label="Today"
        value={String(metrics.today.logCount)}
        detail={todayDetail}
      />
      <SummaryCard
        label="This week"
        value={String(metrics.week.thisWeekCount)}
        detail={weekDetail}
        sparkline={weekSparkline}
      />
      <SummaryCard
        label="Streak"
        value={metrics.streak.days.toLocaleString()}
        detail={streakDetail}
      />
      <SummaryCard
        label="Most tracked"
        value={mostTrackedEmpty ? '—' : metrics.mostTracked.habitName!}
        detail={
          mostTrackedEmpty
            ? 'Nothing this week'
            : `${metrics.mostTracked.count} ${pluralize(metrics.mostTracked.count, 'log')} · 7 days`
        }
      />
      <SummaryCard
        label="Sleep"
        value={sleepValue}
        detail={sleepDetail}
        sparkline={sleepSparkline}
      />
      <SummaryCard
        label="Computer"
        value={computerValue}
        detail={computerDetail}
        sparkline={computerSparkline}
      />
    </div>
  );
}

export default OverviewSummaryCards;
