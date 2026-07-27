'use client';

import React from 'react';
import {
  Bar,
  BarChart,
  Line,
  LineChart,
  ResponsiveContainer,
  YAxis,
} from 'recharts';
import { useOverviewWidgetMetrics } from '@/hooks/use-overview-widget-metrics';

// ---- Chart subcomponents -------------------------------------------------

function MiniBarChart({ data }: { data: number[] }) {
  const chartData = React.useMemo(
    () => data.map((value, index) => ({ index, value })),
    [data],
  );
  const max = Math.max(...data, 1);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
        <YAxis domain={[0, max]} hide />
        <Bar
          dataKey="value"
          fill="#27251E"
          radius={[1, 1, 0, 0]}
          isAnimationActive={false}
          maxBarSize={14}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

function MiniLineChart({ data }: { data: number[] }) {
  const chartData = React.useMemo(
    () => data.map((value, index) => ({ index, value })),
    [data],
  );
  // Pad domain slightly so the line doesn't clip the top/bottom.
  const min = Math.min(...data);
  const max = Math.max(...data);
  const padding = Math.max((max - min) * 0.08, 0.2);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={chartData} margin={{ top: 4, right: 2, left: 2, bottom: 2 }}>
        <YAxis domain={[min - padding, max + padding]} hide />
        <Line
          type="monotone"
          dataKey="value"
          stroke="#27251E"
          strokeWidth={1.25}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ---- Card shell ----------------------------------------------------------

interface SummaryCardProps {
  title: string;
  /**
   * Narrative children can include <strong> spans for inline emphasis on values.
   */
  narrative: React.ReactNode;
  /** Large number/word displayed below the narrative. Mutually exclusive with `chart`. */
  value?: string;
  /** Chart element rendered below the narrative. Takes precedence over `value`. */
  chart?: React.ReactNode;
  /** Muted footer text (usually a secondary stat). */
  footer?: string;
  /** When true, render the "Not tracked yet" fallback instead of value/chart/footer. */
  emptyState?: boolean;
}

function SummaryCard({
  title,
  narrative,
  value,
  chart,
  footer,
  emptyState = false,
}: SummaryCardProps) {
  return (
    <div className="flex h-full min-h-[150px] flex-col rounded-md border border-[#e6e6e6] bg-white px-4 py-3.5 transition-colors duration-100 hover:bg-[var(--surface-panel)]">
      <span className="text-[12px] font-normal leading-none tracking-[-0.01em] text-[rgba(39,37,30,0.5)]">
        {title}
      </span>

      {emptyState ? (
        <div className="mt-auto flex flex-col justify-end">
          <span className="text-[12.5px] font-normal text-[rgba(39,37,30,0.42)]">
            Not tracked yet
          </span>
        </div>
      ) : (
        <>
          <p className="mt-3 text-[12.5px] font-normal leading-[1.45] tracking-[-0.005em] text-[#27251E]">
            {narrative}
          </p>

          <div className="mt-auto pt-2.5">
            {chart ? (
              <div className="h-[44px] w-full">{chart}</div>
            ) : value ? (
              <div className="text-[22px] font-normal leading-[1.15] tracking-[-0.02em] tabular-nums text-[#27251E] truncate">
                {value}
              </div>
            ) : null}

            {footer ? (
              <div className="mt-1.5 text-[11px] font-normal text-[rgba(39,37,30,0.45)] tabular-nums truncate">
                {footer}
              </div>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

// ---- Formatters ----------------------------------------------------------

function formatHours(hours: number | null): string | null {
  if (hours === null || !Number.isFinite(hours)) return null;
  if (hours >= 10) return `${Math.round(hours)}h`;
  return `${hours.toFixed(1)}h`;
}

function pluralize(count: number, singular: string, plural?: string): string {
  if (count === 1) return singular;
  return plural ?? `${singular}s`;
}

// ---- Main component ------------------------------------------------------

export function OverviewSummaryCards() {
  const metrics = useOverviewWidgetMetrics();

  // --- Today
  const todayNarrative =
    metrics.today.logCount === 0 ? (
      <>You haven&apos;t logged anything yet today.</>
    ) : metrics.today.topHabitName ? (
      <>
        You&apos;ve logged{' '}
        <strong className="font-medium">
          {metrics.today.logCount} {pluralize(metrics.today.logCount, 'habit')}
        </strong>{' '}
        today, most often{' '}
        <strong className="font-medium">{metrics.today.topHabitName}</strong>.
      </>
    ) : (
      <>
        You&apos;ve logged{' '}
        <strong className="font-medium">
          {metrics.today.logCount} {pluralize(metrics.today.logCount, 'habit')}
        </strong>{' '}
        today.
      </>
    );

  const todayValue =
    metrics.today.logCount === 0
      ? '0 logs'
      : `${metrics.today.logCount} ${pluralize(metrics.today.logCount, 'log')}`;

  // --- This week
  const weekDelta = metrics.week.deltaPct;
  let weekNarrative: React.ReactNode;
  if (metrics.week.thisWeekCount === 0 && metrics.week.lastWeekCount === 0) {
    weekNarrative = <>No logs this week or last week.</>;
  } else if (weekDelta === null) {
    weekNarrative = (
      <>
        <strong className="font-medium">
          {metrics.week.thisWeekCount} {pluralize(metrics.week.thisWeekCount, 'log')}
        </strong>{' '}
        this week, your first week of tracking.
      </>
    );
  } else {
    const deltaLabel =
      weekDelta === 0
        ? 'same as last week'
        : `${weekDelta > 0 ? '+' : ''}${weekDelta}% vs last week`;
    weekNarrative = (
      <>
        <strong className="font-medium">
          {metrics.week.thisWeekCount} {pluralize(metrics.week.thisWeekCount, 'log')}
        </strong>{' '}
        this week, <strong className="font-medium">{deltaLabel}</strong>.
      </>
    );
  }

  const weekHasData = metrics.week.dailyCounts.some((value) => value > 0);

  // --- Active streak
  const streakNarrative =
    metrics.streak.days === 0 ? (
      <>Log any habit today to start a streak.</>
    ) : metrics.streak.days === 1 ? (
      <>You&apos;re on your first day of consistent logging.</>
    ) : (
      <>You&apos;ve logged something every day for a stretch of</>
    );
  const streakValue = `${metrics.streak.days.toLocaleString()} ${pluralize(
    metrics.streak.days,
    'day',
  )}`;

  // --- Most tracked
  const mostTrackedEmpty =
    !metrics.mostTracked.habitName || metrics.mostTracked.count === 0;
  const mostTrackedNarrative = mostTrackedEmpty
    ? null
    : (
      <>Your most-tracked habit this week is</>
    );
  const mostTrackedValue = mostTrackedEmpty ? undefined : metrics.mostTracked.habitName!;
  const mostTrackedFooter = mostTrackedEmpty
    ? undefined
    : `${metrics.mostTracked.count} ${pluralize(metrics.mostTracked.count, 'log')} · past 7 days`;

  // --- Sleep
  const sleepLastNight = formatHours(metrics.sleep.lastNightHours);
  const sleepAvg = formatHours(metrics.sleep.sevenDayAvgHours);
  const sleepEmpty = sleepLastNight === null && sleepAvg === null;
  const sleepHasChart = metrics.sleep.dailySeries.some((v) => v > 0);
  const sleepNarrative = sleepEmpty
    ? null
    : sleepLastNight ? (
      <>
        You slept <strong className="font-medium">{sleepLastNight}</strong> last
        night{sleepAvg && sleepAvg !== sleepLastNight ? (
          <>
            , against a 7-day average of{' '}
            <strong className="font-medium">{sleepAvg}</strong>.
          </>
        ) : (
          '.'
        )}
      </>
    ) : (
      <>
        7-day sleep average is{' '}
        <strong className="font-medium">{sleepAvg}</strong>.
      </>
    );
  const sleepFooter = sleepEmpty
    ? undefined
    : sleepAvg && sleepLastNight && sleepAvg !== sleepLastNight
      ? `7-day avg: ${sleepAvg}`
      : undefined;

  // --- Computer Time
  const computerYesterday = formatHours(metrics.computerTime.yesterdayHours);
  const computerSevenDay = formatHours(metrics.computerTime.sevenDayHours);
  const computerEmpty = computerYesterday === null && computerSevenDay === null;
  const computerHasChart = metrics.computerTime.dailySeries.some((v) => v > 0);
  const computerNarrative = computerEmpty
    ? null
    : computerYesterday ? (
      <>
        <strong className="font-medium">{computerYesterday}</strong> on your
        computer yesterday.
      </>
    ) : (
      <>No computer activity logged yesterday.</>
    );
  const computerFooter = computerEmpty
    ? undefined
    : computerSevenDay
      ? `${computerSevenDay} total past 7 days`
      : undefined;

  return (
    <div className="grid w-full grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
      <SummaryCard
        title="Today"
        narrative={todayNarrative}
        value={todayValue}
      />

      <SummaryCard
        title="This week"
        narrative={weekNarrative}
        chart={weekHasData ? <MiniBarChart data={metrics.week.dailyCounts} /> : undefined}
        value={weekHasData ? undefined : '0 logs'}
      />

      <SummaryCard
        title="Active streak"
        narrative={streakNarrative}
        value={streakValue}
      />

      <SummaryCard
        title="Most tracked this week"
        narrative={mostTrackedNarrative}
        value={mostTrackedValue}
        footer={mostTrackedFooter}
        emptyState={mostTrackedEmpty}
      />

      <SummaryCard
        title="Sleep"
        narrative={sleepNarrative}
        chart={sleepHasChart ? <MiniLineChart data={metrics.sleep.dailySeries} /> : undefined}
        footer={!sleepHasChart && sleepAvg ? `7-day avg: ${sleepAvg}` : sleepFooter}
        emptyState={sleepEmpty}
      />

      <SummaryCard
        title="Computer Time"
        narrative={computerNarrative}
        chart={computerHasChart ? <MiniLineChart data={metrics.computerTime.dailySeries} /> : undefined}
        footer={computerFooter}
        emptyState={computerEmpty}
      />
    </div>
  );
}

export default OverviewSummaryCards;
