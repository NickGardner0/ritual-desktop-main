'use client';

import Link from 'next/link';
import { Separator } from '@ritual/ui/separator';
import { useOverviewWidgetMetrics, type OverviewWidgetMetrics } from '@/hooks/use-overview-widget-metrics';

type FetchRow = {
  key: string;
  label: string;
  value: string;
  detail?: string;
  href: string;
  series?: number[];
};

function formatHours(hours: number | null): string | null {
  if (hours === null || !Number.isFinite(hours) || hours <= 0) return null;
  if (hours >= 10) return `${Math.round(hours)}h`;
  return `${hours.toFixed(1)}h`;
}

function pluralize(count: number, singular: string, plural?: string): string {
  if (count === 1) return singular;
  return plural ?? `${singular}s`;
}

function FetchSpark({ series }: { series: number[] }) {
  const numeric = series.filter((value) => Number.isFinite(value));
  if (numeric.length < 2 || numeric.every((value) => value === 0)) {
    return null;
  }

  const min = Math.min(...numeric);
  const max = Math.max(...numeric);
  const range = Math.max(max - min, 1e-6);
  const width = 56;
  const height = 16;
  const points = numeric
    .map((value, index) => {
      const x = (index / (numeric.length - 1)) * width;
      const y = height - ((value - min) / range) * (height - 2) - 1;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="shrink-0 text-[var(--text-muted)]"
      aria-hidden="true"
    >
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={points}
      />
    </svg>
  );
}

export function buildOverviewFetchRows(metrics: OverviewWidgetMetrics): FetchRow[] {
  const mostTrackedEmpty = !metrics.mostTracked.habitName || metrics.mostTracked.count === 0;

  let weekValue: string;
  let weekDetail: string | undefined;
  if (metrics.week.thisWeekCount === 0 && metrics.week.lastWeekCount === 0) {
    weekValue = '0';
    weekDetail = 'No logs this week';
  } else if (metrics.week.deltaPct === null) {
    weekValue = String(metrics.week.thisWeekCount);
    weekDetail = 'First week tracking';
  } else if (metrics.week.deltaPct === 0) {
    weekValue = String(metrics.week.thisWeekCount);
    weekDetail = 'Same as last week';
  } else {
    const sign = metrics.week.deltaPct > 0 ? '+' : '';
    weekValue = String(metrics.week.thisWeekCount);
    weekDetail = `${sign}${metrics.week.deltaPct}% vs last week`;
  }

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

  return [
    {
      key: 'today',
      label: 'Today',
      value: String(metrics.today.logCount),
      detail:
        metrics.today.logCount === 0
          ? 'No logs yet'
          : metrics.today.topHabitName
            ? `mostly ${metrics.today.topHabitName}`
            : pluralize(metrics.today.logCount, 'log'),
      href: '/dashboard',
    },
    {
      key: 'streak',
      label: 'Streak',
      value: metrics.streak.days.toLocaleString(),
      detail: metrics.streak.days === 0 ? 'Log today to start' : pluralize(metrics.streak.days, 'day'),
      href: '/dashboard',
    },
    {
      key: 'most-tracked',
      label: 'Most tracked',
      value: mostTrackedEmpty ? '—' : metrics.mostTracked.habitName!,
      detail: mostTrackedEmpty
        ? 'Nothing this week'
        : `${metrics.mostTracked.count} ${pluralize(metrics.mostTracked.count, 'log')} · 7 days`,
      href: '/dashboard?view=metrics',
    },
    {
      key: 'week',
      label: 'This week',
      value: weekValue,
      detail: weekDetail,
      href: '/dashboard?view=metrics',
      series: metrics.week.dailyCounts,
    },
    {
      key: 'sleep',
      label: 'Sleep',
      value: sleepValue,
      detail: sleepDetail,
      href: '/dashboard?view=metrics',
      series: metrics.sleep.dailySeries,
    },
    {
      key: 'computer',
      label: 'Computer',
      value: computerValue,
      detail: computerDetail,
      href: '/integrations',
      series: metrics.computerTime.dailySeries,
    },
  ];
}

export function OverviewFetchBlock() {
  const metrics = useOverviewWidgetMetrics();
  const rows = buildOverviewFetchRows(metrics);

  return (
    <section aria-label="Ritual snapshot" className="w-full pb-6">
      <Separator />
      <ul className="mt-3 flex flex-col gap-1.5">
        {rows.map((row) => (
          <li key={row.key}>
            <Link
              href={row.href}
              className="grid grid-cols-[7.5rem_minmax(0,1fr)_auto] items-center gap-x-3 py-0.5 text-[13px] leading-[1.45] transition-colors hover:text-[var(--text-primary)]"
            >
              <span className="text-[var(--text-muted)]">{row.label}</span>
              <span className="min-w-0 truncate text-[var(--text-primary)]">
                <span className="tabular-nums">{row.value}</span>
                {row.detail ? (
                  <span className="text-[var(--text-muted)]"> · {row.detail}</span>
                ) : null}
              </span>
              {row.series ? <FetchSpark series={row.series} /> : <span />}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default OverviewFetchBlock;
