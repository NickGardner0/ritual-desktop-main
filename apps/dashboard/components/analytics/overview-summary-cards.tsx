'use client';

import React from 'react';
import { Card } from '@ritual/ui/card';
import { PerplexityMiniSparkChart } from '@/components/charts/PerplexityMiniSparkChart';
import { useOverviewWidgetMetrics } from '@/hooks/use-overview-widget-metrics';

type SparkTrend = 'up' | 'down' | 'neutral';

function trendFromSeries(series: number[]): SparkTrend {
  const numeric = series.filter((value) => Number.isFinite(value));
  if (numeric.length < 2) return 'neutral';
  const first = numeric[0];
  const last = numeric[numeric.length - 1];
  if (last > first) return 'up';
  if (last < first) return 'down';
  return 'neutral';
}

function percentFromSeries(series: number[]): number | null {
  const numeric = series.filter((value) => Number.isFinite(value));
  if (numeric.length < 2) return null;
  const first = numeric[0];
  const last = numeric[numeric.length - 1];
  if (first === 0) return last === 0 ? 0 : null;
  return Math.round(((last - first) / Math.abs(first)) * 100);
}

function formatHours(hours: number | null): string | null {
  if (hours === null || !Number.isFinite(hours) || hours <= 0) return null;
  if (hours >= 10) return `${Math.round(hours)}h`;
  return `${hours.toFixed(1)}h`;
}

function pluralize(count: number, singular: string, plural?: string): string {
  if (count === 1) return singular;
  return plural ?? `${singular}s`;
}

function CompactCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <Card density="compact" className="flex min-h-[110px] flex-col justify-between p-5 shadow-none">
      <span className="text-xs text-[var(--text-muted)]">{label}</span>
      <div className="mt-3 min-w-0">
        <span className="text-xl font-medium leading-none tracking-[-0.03em] text-[var(--text-primary)] tabular-nums">
          {value}
        </span>
        {detail ? (
          <span className="ml-2 text-xs text-[var(--text-muted)]">{detail}</span>
        ) : null}
      </div>
    </Card>
  );
}

function SparkCard({
  label,
  value,
  detail,
  series,
  trend,
  changePct,
}: {
  label: string;
  value: string;
  detail?: string;
  series: number[];
  trend: SparkTrend;
  changePct?: number | null;
}) {
  const hasSeries = series.some((value) => value > 0);
  const changeLabel =
    changePct === null || changePct === undefined || !Number.isFinite(changePct)
      ? null
      : `${changePct > 0 ? '+' : ''}${changePct}%`;
  const changeColor =
    trend === 'up'
      ? 'text-[#136A22]'
      : trend === 'down'
        ? 'text-[#A23544]'
        : 'text-[var(--text-muted)]';

  return (
    <Card density="compact" className="flex h-[100px] flex-col overflow-hidden p-0 shadow-none">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 px-3 pt-2.5">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium leading-none tracking-[-0.02em] text-[var(--text-primary)]">
            {label}
          </div>
          <div className="mt-1 truncate text-[11px] leading-none text-[var(--text-muted)]">
            <span className="tabular-nums text-[var(--text-secondary)]">{value}</span>
            {detail ? <span> · {detail}</span> : null}
          </div>
        </div>
        {changeLabel ? (
          <span className={`pt-0.5 text-[11px] font-medium tabular-nums ${changeColor}`}>
            {trend === 'up' ? '↗ ' : trend === 'down' ? '↘ ' : ''}
            {changeLabel}
          </span>
        ) : null}
      </div>
      <div className="mt-auto min-h-0 flex-1 px-0.5 pb-0.5">
        {hasSeries ? (
          <PerplexityMiniSparkChart values={series} trend={trend} height={36} />
        ) : null}
      </div>
    </Card>
  );
}

export function OverviewSummaryCards() {
  const metrics = useOverviewWidgetMetrics();

  const todayDetail =
    metrics.today.logCount === 0
      ? 'No logs yet'
      : metrics.today.topHabitName
        ? `mostly ${metrics.today.topHabitName}`
        : pluralize(metrics.today.logCount, 'log');

  const streakDetail =
    metrics.streak.days === 0
      ? 'Log today to start'
      : pluralize(metrics.streak.days, 'day');

  const mostTrackedEmpty = !metrics.mostTracked.habitName || metrics.mostTracked.count === 0;

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
  const weekTrend: SparkTrend =
    metrics.week.deltaPct === null || metrics.week.deltaPct === 0
      ? 'neutral'
      : metrics.week.deltaPct > 0
        ? 'up'
        : 'down';

  const sleepLastNight = formatHours(metrics.sleep.lastNightHours);
  const sleepAvg = formatHours(metrics.sleep.sevenDayAvgHours);
  const sleepEmpty = sleepLastNight === null && sleepAvg === null;
  const sleepValue = sleepLastNight ?? sleepAvg ?? '—';
  const sleepDetail = sleepEmpty
    ? 'Not tracked yet'
    : sleepLastNight && sleepAvg && sleepLastNight !== sleepAvg
      ? `avg ${sleepAvg}`
      : sleepLastNight
        ? 'Last night'
        : '7-day average';

  const computerYesterday = formatHours(metrics.computerTime.yesterdayHours);
  const computerSevenDay = formatHours(metrics.computerTime.sevenDayHours);
  const computerEmpty = computerYesterday === null && computerSevenDay === null;
  const computerValue = computerYesterday ?? computerSevenDay ?? '—';
  const computerDetail = computerEmpty
    ? 'Not tracked yet'
    : computerYesterday
      ? 'Yesterday'
      : 'Past 7 days';

  return (
    <div className="flex flex-col gap-3">
      <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-3">
        <CompactCard
          label="Today"
          value={String(metrics.today.logCount)}
          detail={todayDetail}
        />
        <CompactCard
          label="Streak"
          value={metrics.streak.days.toLocaleString()}
          detail={streakDetail}
        />
        <CompactCard
          label="Most tracked"
          value={mostTrackedEmpty ? '—' : metrics.mostTracked.habitName!}
          detail={
            mostTrackedEmpty
              ? 'Nothing this week'
              : `${metrics.mostTracked.count} ${pluralize(metrics.mostTracked.count, 'log')} · 7 days`
          }
        />
      </div>

      <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-3">
        <SparkCard
          label="This week"
          value={String(metrics.week.thisWeekCount)}
          detail={weekDetail}
          series={metrics.week.dailyCounts}
          trend={weekTrend}
          changePct={metrics.week.deltaPct}
        />
        <SparkCard
          label="Sleep"
          value={sleepValue}
          detail={sleepDetail}
          series={metrics.sleep.dailySeries}
          trend={trendFromSeries(metrics.sleep.dailySeries)}
          changePct={percentFromSeries(metrics.sleep.dailySeries)}
        />
        <SparkCard
          label="Computer"
          value={computerValue}
          detail={computerDetail}
          series={metrics.computerTime.dailySeries}
          trend={trendFromSeries(metrics.computerTime.dailySeries)}
          changePct={percentFromSeries(metrics.computerTime.dailySeries)}
        />
      </div>
    </div>
  );
}

export default OverviewSummaryCards;
