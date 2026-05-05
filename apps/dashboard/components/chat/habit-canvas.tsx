'use client';

import React, { memo } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

const CANVAS_TABLE_BORDER = 'border-[#e6e6e6]';
const CANVAS_TABLE_WRAPPER = `overflow-hidden border bg-white ${CANVAS_TABLE_BORDER}`;
const CANVAS_TABLE = 'w-full table-fixed text-xs font-sans border-separate border-spacing-0';
const CANVAS_HEADER_ROW = 'bg-white';
const CANVAS_HEADER_CELL = `h-10 px-4 align-middle bg-white text-[12px] font-medium text-[#666] border-b ${CANVAS_TABLE_BORDER}`;
const CANVAS_BODY_CELL = 'px-4 py-2 align-middle font-normal';

function TableCols({ widths }: { widths: string[] }) {
  return (
    <colgroup>
      {widths.map((width, index) => (
        <col key={`${width}-${index}`} style={{ width }} />
      ))}
    </colgroup>
  );
}

// Types for trend data
interface TrendItem {
  habit_id: string;
  habit_name: string;
  unit: string;
  category?: string;
  window_days: number;
  current_avg: number;
  previous_avg: number;
  absolute_change: number;
  percent_change: number;
  days_with_data_current: number;
  days_with_data_previous: number;
  direction: 'up' | 'down' | 'flat';
  confidence: 'high' | 'medium' | 'low';
}

interface TrendsData {
  success: boolean;
  window_days: number;
  current_period: { start: string; end: string };
  previous_period: { start: string; end: string };
  trends: TrendItem[];
  summary: {
    total_habits: number;
    improving: number;
    declining: number;
    stable: number;
  };
  suggested_followups?: string[];
}

// Types for anomaly data
interface AnomalyItem {
  date: string;
  value: number;
  z_score: number;
  type: 'spike' | 'drop';
  entries_count?: number;
  deviation_from_avg: number;
}

interface AnomaliesData {
  success: boolean;
  habit: { id: string; name: string; unit: string };
  date_range: { start: string; end: string };
  days_analyzed: number;
  baseline_avg: number;
  baseline_std_dev: number;
  z_threshold: number;
  anomalies: AnomalyItem[];
  summary: {
    total_anomalies: number;
    spikes: number;
    drops: number;
  };
  suggested_followups?: string[];
}

interface WeeklyOverviewHabitDailyRow {
  date: string;
  value: number;
  unit?: string;
  total_hours?: number | null;
  total_duration_seconds?: number | null;
  total_amount?: number | null;
  sleep_start?: string;
  sleep_end?: string;
  entries?: Array<{
    time?: string;
    amount?: number;
    duration_seconds?: number;
    notes?: string;
    sleep_start?: string;
    sleep_end?: string;
  }>;
}

interface WeeklyOverviewHabit {
  id: string;
  name: string;
  category?: string;
  unit?: string;
  total: number;
  average: number;
  min: number;
  max: number;
  days_with_data: number;
  total_entries: number;
  daily: WeeklyOverviewHabitDailyRow[];
}

interface WeeklyOverviewComputerActivity {
  days_with_data: number;
  total_hours: number;
  average_daily_hours: number;
  min_daily_hours: number;
  max_daily_hours: number;
  daily: Array<{
    day: string;
    active_hours: number;
    events_count: number;
    apps_count: number;
  }>;
  top_apps: Array<{
    app_name?: string;
    total_active_ms?: number;
    total_events?: number;
    days_used?: number;
    hours?: number;
  }>;
  top_domains: Array<{
    domain?: string;
    total_active_ms?: number;
    total_events?: number;
    days_used?: number;
    hours?: number;
    minutes?: number;
  }>;
}

interface WeeklyOverviewData {
  success: boolean;
  date_range: {
    start: string;
    end: string;
    days: number;
  };
  summary: {
    habits_with_data: number;
    total_habits_tracked: number;
  };
  habits: WeeklyOverviewHabit[];
  computer_activity?: WeeklyOverviewComputerActivity;
  suggested_followups?: string[];
}

export interface HabitCanvasData {
  type: 'trends' | 'stats' | 'breakdown' | 'anomalies' | 'weeklyOverview';
  title: string;
  habitName?: string;
  dateRange?: { start: string; end: string };
  dailyData?: Array<{
    date: string;
    hours?: number;
    amount?: number;
    value?: number;
    entries?: Array<{
      time?: string;
      amount?: number;
      duration_seconds?: number;
      notes?: string;
      sleep_start?: string;
      sleep_end?: string;
    }>;
  }>;
  stats?: {
    totalHours?: number;
    totalAmount?: number;
    daysTracked: number;
    avgPerDay?: number;
    minValue?: number;
    maxValue?: number;
    unit?: string;
  };
  insights?: string[];
  trends?: TrendsData;
  anomalies?: AnomaliesData;
  weeklyOverview?: WeeklyOverviewData;
}

interface HabitCanvasProps {
  data: HabitCanvasData | null;
  onClose: () => void;
  onFollowUp?: (question: string) => void;
}

function formatDate(dateStr: string): string {
  try {
    const ymdMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
    const date = ymdMatch
      ? new Date(Number(ymdMatch[1]), Number(ymdMatch[2]) - 1, Number(ymdMatch[3]))
      : new Date(dateStr);
    if (isNaN(date.getTime())) {
      return dateStr;
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

function formatDateRange(start: string, end: string): string {
  return `${formatDate(start)} - ${formatDate(end)}`;
}

function formatUnit(unit?: string, isHours?: boolean): string {
  if (isHours) return 'h';
  if (!unit) return '';
  
  const unitMap: Record<string, string> = {
    'hours': 'h', 'hour': 'h', 'h': 'h',
    'minutes': 'm', 'minute': 'm', 'min': 'm', 'm': 'm',
    'milligrams': 'mg', 'milligram': 'mg', 'mg': 'mg',
    'grams': 'g', 'gram': 'g', 'g': 'g',
    'calories': ' cal', 'cal': ' cal',
    'steps': ' steps', 'miles': ' mi', 'mi': ' mi',
    'kilometers': ' km', 'km': ' km',
    'count': '', 'reps': ' reps', 'sets': ' sets',
    'oz': ' oz', 'ounces': ' oz',
    'glasses': ' glasses', 'cups': ' cups',
    'liters': 'L', 'l': 'L', 'ml': 'ml', 'milliliters': 'ml',
    'sessions': '', 'pages': ' pages',
  };
  
  const normalized = unit.toLowerCase().trim();
  return unitMap[normalized] ?? ` ${unit}`;
}

function formatValueWithUnit(value: number | undefined, unit?: string, isHours?: boolean): string {
  if (value === undefined) return '';
  const formattedValue = Number.isInteger(value) ? value.toString() : value.toFixed(1);
  return `${formattedValue}${formatUnit(unit, isHours)}`;
}

function isSleepDurationHabit(name?: string): boolean {
  return String(name || '').trim().toLowerCase() === 'sleep duration';
}

function formatTimeList(values: Array<string | undefined | null>): string {
  const uniqueValues = Array.from(
    new Set(
      values
        .map((value) => String(value || '').trim())
        .filter(Boolean),
    ),
  );

  return uniqueValues.length > 0 ? uniqueValues.join(', ') : '—';
}

interface HabitDailyTableRow {
  date: string;
  value: string;
  entries: string;
  time?: string;
  sleepTime?: string;
  wakeTime?: string;
}

const HabitDailyTable = memo(function HabitDailyTable({
  rows,
  emptyText,
  isSleepHabit,
}: {
  rows: HabitDailyTableRow[];
  emptyText: string;
  isSleepHabit: boolean;
}) {
  const columnCount = isSleepHabit ? 5 : 4;
  const bodyCellBase = `${CANVAS_BODY_CELL} whitespace-nowrap overflow-hidden text-ellipsis`;

  return (
    <div className={cn(CANVAS_TABLE_WRAPPER, 'max-h-[260px] overflow-y-auto')}>
      <table className={CANVAS_TABLE}>
        <TableCols
          widths={
            isSleepHabit
              ? ['20%', '20%', '20%', '20%', '20%']
              : ['25%', '25%', '25%', '25%']
          }
        />
        <thead className="sticky top-0 bg-white">
          <tr className={cn(CANVAS_HEADER_ROW, 'sticky top-0')}>
            <th className={`${CANVAS_HEADER_CELL} text-left border-r ${CANVAS_TABLE_BORDER}`}>Date</th>
            <th className={`${CANVAS_HEADER_CELL} text-left border-r ${CANVAS_TABLE_BORDER}`}>Value</th>
            {isSleepHabit ? (
              <>
                <th className={`${CANVAS_HEADER_CELL} text-left border-r ${CANVAS_TABLE_BORDER}`}>Sleep Time</th>
                <th className={`${CANVAS_HEADER_CELL} text-left border-r ${CANVAS_TABLE_BORDER}`}>Wake Time</th>
                <th className={`${CANVAS_HEADER_CELL} text-left`}>Entries</th>
              </>
            ) : (
              <>
                <th className={`${CANVAS_HEADER_CELL} text-left border-r ${CANVAS_TABLE_BORDER}`}>Time</th>
                <th className={`${CANVAS_HEADER_CELL} text-left`}>Entries</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columnCount} className="px-4 py-5 text-center text-xs text-[#666]">
                {emptyText}
              </td>
            </tr>
          ) : (
            rows.map((row, idx) => (
              <tr key={`${row.date}-${idx}`} className="transition-colors hover:bg-neutral-50/80">
                <td className={cn(`${bodyCellBase} text-[#1a1a1a] border-r ${CANVAS_TABLE_BORDER}`, idx !== rows.length - 1 && `border-b ${CANVAS_TABLE_BORDER}`)}>
                  {row.date}
                </td>
                <td className={cn(`${bodyCellBase} text-[#1a1a1a] text-left tabular-nums border-r ${CANVAS_TABLE_BORDER}`, idx !== rows.length - 1 && `border-b ${CANVAS_TABLE_BORDER}`)}>
                  {row.value}
                </td>
                {isSleepHabit ? (
                  <>
                    <td className={cn(`${bodyCellBase} text-[#666] border-r ${CANVAS_TABLE_BORDER}`, idx !== rows.length - 1 && `border-b ${CANVAS_TABLE_BORDER}`)}>
                      {row.sleepTime || '—'}
                    </td>
                    <td className={cn(`${bodyCellBase} text-[#666] border-r ${CANVAS_TABLE_BORDER}`, idx !== rows.length - 1 && `border-b ${CANVAS_TABLE_BORDER}`)}>
                      {row.wakeTime || '—'}
                    </td>
                    <td className={cn(`${bodyCellBase} text-[#666] text-left tabular-nums`, idx !== rows.length - 1 && `border-b ${CANVAS_TABLE_BORDER}`)}>
                      {row.entries}
                    </td>
                  </>
                ) : (
                  <>
                    <td className={cn(`${bodyCellBase} text-[#666] border-r ${CANVAS_TABLE_BORDER}`, idx !== rows.length - 1 && `border-b ${CANVAS_TABLE_BORDER}`)}>
                      {row.time || '—'}
                    </td>
                    <td className={cn(`${bodyCellBase} text-[#666] text-left tabular-nums`, idx !== rows.length - 1 && `border-b ${CANVAS_TABLE_BORDER}`)}>
                      {row.entries}
                    </td>
                  </>
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
});

// ====================
// MIDDAY-STYLE TRENDS SECTION
// ====================
const TrendsSection = memo(function TrendsSection({ trends }: { trends: TrendsData }) {
  const improvers = trends.trends.filter(t => t.direction === 'up');
  const decliners = trends.trends.filter(t => t.direction === 'down');
  const stable = trends.trends.filter(t => t.direction === 'flat');
  
  const sortedImprovers = [...improvers].sort((a, b) => b.percent_change - a.percent_change);
  const sortedDecliners = [...decliners].sort((a, b) => a.percent_change - b.percent_change);
  
  const topImprover = sortedImprovers[0];
  
  return (
    <div className="space-y-8">
      {/* Improvers Table - Midday style with borders */}
      {sortedImprovers.length > 0 && (
        <div>
          <h4 className="text-sm font-normal text-[#1a1a1a] mb-4">
            Top improvements
          </h4>

          <div className="border border-[#ebebeb] overflow-hidden">
            <table className="w-full table-fixed">
              <colgroup>
                <col className="w-[30%]" />
                <col className="w-[18%]" />
                <col className="w-[36%]" />
                <col className="w-[16%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-[#e6e6e6]">
                  <th className="px-2 py-2 text-left text-[11px] text-[#707070] font-normal border-r border-[#e6e6e6]">Habit</th>
                  <th className="px-2 py-2 text-center text-[11px] text-[#707070] font-normal border-r border-[#e6e6e6]">Conf.</th>
                  <th className="px-2 py-2 text-right text-[11px] text-[#707070] font-normal border-r border-[#e6e6e6]">Average</th>
                  <th className="px-2 py-2 text-right text-[11px] text-[#707070] font-normal">Change</th>
                </tr>
              </thead>
              <tbody>
                {sortedImprovers.slice(0, 5).map((trend, index) => (
                  <tr
                    key={trend.habit_id}
                    className={cn(
                      "hover:bg-[#F2F1EF] transition-colors",
                      index !== sortedImprovers.slice(0, 5).length - 1 && "border-b border-[#e6e6e6]"
                    )}
                  >
                    <td className="px-2 py-2 text-[11px] text-black border-r border-[#e6e6e6] truncate" title={trend.habit_name}>{trend.habit_name}</td>
                    <td className="px-2 py-2 text-center text-[10px] uppercase text-[#707070] border-r border-[#e6e6e6] whitespace-nowrap">
                      {trend.confidence}
                    </td>
                    <td className="px-2 py-2 text-right text-[11px] text-[#707070] tabular-nums border-r border-[#e6e6e6] whitespace-nowrap">
                      {trend.previous_avg.toFixed(1)} → {trend.current_avg.toFixed(1)}
                    </td>
                    <td className="px-2 py-2 text-right text-[11px] text-[#16a34a] tabular-nums whitespace-nowrap">
                      +{trend.percent_change.toFixed(0)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Decliners Table - Midday style with borders */}
      {sortedDecliners.length > 0 && (
        <div>
          <h4 className="text-sm font-normal text-[#1a1a1a] mb-4">
            Top decliners
          </h4>

          <div className="border border-[#ebebeb] overflow-hidden">
            <table className="w-full table-fixed">
              <colgroup>
                <col className="w-[30%]" />
                <col className="w-[18%]" />
                <col className="w-[36%]" />
                <col className="w-[16%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-[#e6e6e6]">
                  <th className="px-2 py-2 text-left text-[11px] text-[#707070] font-normal border-r border-[#e6e6e6]">Habit</th>
                  <th className="px-2 py-2 text-center text-[11px] text-[#707070] font-normal border-r border-[#e6e6e6]">Conf.</th>
                  <th className="px-2 py-2 text-right text-[11px] text-[#707070] font-normal border-r border-[#e6e6e6]">Average</th>
                  <th className="px-2 py-2 text-right text-[11px] text-[#707070] font-normal">Change</th>
                </tr>
              </thead>
              <tbody>
                {sortedDecliners.slice(0, 5).map((trend, index) => (
                  <tr
                    key={trend.habit_id}
                    className={cn(
                      "hover:bg-[#F2F1EF] transition-colors",
                      index !== sortedDecliners.slice(0, 5).length - 1 && "border-b border-[#e6e6e6]"
                    )}
                  >
                    <td className="px-2 py-2 text-[11px] text-black border-r border-[#e6e6e6] truncate" title={trend.habit_name}>{trend.habit_name}</td>
                    <td className="px-2 py-2 text-center text-[10px] uppercase text-[#707070] border-r border-[#e6e6e6] whitespace-nowrap">
                      {trend.confidence}
                    </td>
                    <td className="px-2 py-2 text-right text-[11px] text-[#707070] tabular-nums border-r border-[#e6e6e6] whitespace-nowrap">
                      {trend.previous_avg.toFixed(1)} → {trend.current_avg.toFixed(1)}
                    </td>
                    <td className="px-2 py-2 text-right text-[11px] text-[#dc2626] tabular-nums whitespace-nowrap">
                      {trend.percent_change.toFixed(0)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Summary Cards - Exact Midday style */}
      <div className="grid grid-cols-2 gap-3">
        <div className="border border-[#ebebeb] p-3 bg-white">
          <div className="text-[12px] text-[#707070] mb-1">
            Habits tracked
          </div>
          <div className="text-sm font-normal text-[#1a1a1a] mb-1">
            {trends.summary.total_habits}
          </div>
          <div className="text-[10px] text-[#707070]">
            {trends.summary.improving} improving, {trends.summary.declining} declining
          </div>
        </div>

        {topImprover && (
          <div className="border border-[#ebebeb] p-3 bg-white">
            <div className="text-[12px] text-[#707070] mb-1">
              Biggest improvement
            </div>
            <div className="text-sm font-normal text-[#1a1a1a] mb-1">
              {topImprover.habit_name}
            </div>
            <div className="text-[10px] text-[#16a34a]">
              +{topImprover.percent_change.toFixed(0)}% increase
            </div>
          </div>
        )}
      </div>

      {/* Stable habits */}
      {stable.length > 0 && (
        <div className="mt-4">
          <h4 className="text-[12px] leading-normal mb-2 text-[#707070]">
            Stable habits ({stable.length})
          </h4>
          <div className="text-[12px] leading-[17px] text-black">
            {stable.map(t => t.habit_name).join(', ')}
          </div>
        </div>
      )}
    </div>
  );
});

// ====================
// MIDDAY-STYLE ANOMALIES SECTION
// ====================
const AnomaliesSection = memo(function AnomaliesSection({ anomalies }: { anomalies: AnomaliesData }) {
  return (
    <div className="space-y-6">
      {/* Anomalies Table - Midday style with borders */}
      {anomalies.anomalies.length > 0 ? (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-sm font-normal text-[#1a1a1a]">
              Unusual days
            </h4>
            <span className="text-[12px] text-[#707070]">
              {anomalies.summary.spikes} spikes, {anomalies.summary.drops} drops
            </span>
          </div>

          <div className="border border-[#ebebeb]">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#e6e6e6]">
                  <th className="px-3 py-2 text-left text-[12px] text-[#707070] font-normal border-r border-[#e6e6e6]">Date</th>
                  <th className="px-3 py-2 text-right text-[12px] text-[#707070] font-normal border-r border-[#e6e6e6]">Value</th>
                  <th className="px-3 py-2 text-right text-[12px] text-[#707070] font-normal border-r border-[#e6e6e6]">Type</th>
                  <th className="px-3 py-2 text-right text-[12px] text-[#707070] font-normal">Deviation</th>
                </tr>
              </thead>
              <tbody>
                {anomalies.anomalies.map((anomaly, index) => (
                  <tr
                    key={index}
                    className={cn(
                      "hover:bg-[#F2F1EF] transition-colors",
                      index !== anomalies.anomalies.length - 1 && "border-b border-[#e6e6e6]"
                    )}
                  >
                    <td className="px-3 py-2 text-[12px] text-black border-r border-[#e6e6e6] whitespace-nowrap">{formatDate(anomaly.date)}</td>
                    <td className="px-3 py-2 text-right text-[12px] text-black tabular-nums border-r border-[#e6e6e6] whitespace-nowrap">
                      {anomaly.value.toFixed(1)}{formatUnit(anomalies.habit.unit)}
                    </td>
                    <td className="px-3 py-2 text-right border-r border-[#e6e6e6] whitespace-nowrap">
                      <span className={cn(
                        "text-[10px] uppercase",
                        anomaly.type === 'spike' ? 'text-[#dc2626]' : 'text-[#2563eb]'
                      )}>
                        {anomaly.type}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right text-[12px] text-[#707070] tabular-nums whitespace-nowrap">
                      {anomaly.z_score > 0 ? '+' : ''}{anomaly.z_score.toFixed(1)}σ
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="text-center py-8 text-[12px] text-[#707070]">
          <AlertTriangle className="w-5 h-5 mx-auto mb-2 opacity-40" />
          No anomalies detected in this period
        </div>
      )}

      {/* Summary Cards - Midday style */}
      <div className="grid grid-cols-2 gap-3">
        <div className="border border-[#ebebeb] p-3 bg-white">
          <div className="text-[12px] text-[#707070] mb-1">
            Baseline average
          </div>
          <div className="text-sm font-normal text-[#1a1a1a] mb-1">
            {anomalies.baseline_avg.toFixed(1)}{formatUnit(anomalies.habit.unit)}
          </div>
          <div className="text-[10px] text-[#707070]">
            Across {anomalies.days_analyzed} days analyzed
          </div>
        </div>

        <div className="border border-[#ebebeb] p-3 bg-white">
          <div className="text-[12px] text-[#707070] mb-1">
            Standard deviation
          </div>
          <div className="text-sm font-normal text-[#1a1a1a] mb-1">
            ±{anomalies.baseline_std_dev.toFixed(2)}
          </div>
          <div className="text-[10px] text-[#707070]">
            Normal variation range
          </div>
        </div>
      </div>
    </div>
  );
});

const WeeklyOverviewSection = memo(function WeeklyOverviewSection({
  weeklyOverview,
}: {
  weeklyOverview: WeeklyOverviewData;
}) {
  const habits = [...(weeklyOverview.habits || [])].sort((a, b) => a.name.localeCompare(b.name));
  const computer = weeklyOverview.computer_activity;

  const formatNumber = (value: number) => {
    if (!Number.isFinite(value)) return '0';
    // Round values that are very close to integers (floating point artifacts)
    const rounded = Math.round(value);
    if (Math.abs(value - rounded) < 0.1) return String(rounded);
    return value.toFixed(1);
  };

  const formatMetric = (value: number, unit?: string) => {
    const normalized = (unit || '').toLowerCase().trim();
    if (normalized === 'hours' || normalized === 'hour' || normalized === 'h') {
      return `${formatNumber(value)}h`;
    }
    if (normalized === 'minutes' || normalized === 'minute' || normalized === 'min' || normalized === 'm') {
      return `${formatNumber(value)}m`;
    }
    if (normalized === 'milligrams' || normalized === 'milligram' || normalized === 'mg') {
      return `${formatNumber(value)}mg`;
    }
    if (normalized === 'grams' || normalized === 'gram' || normalized === 'g') {
      return `${formatNumber(value)}g`;
    }
    return `${formatNumber(value)}${formatUnit(unit)}`;
  };

  const formatEvents = (value?: number) => (value || 0).toLocaleString();

  const renderRankedUsageTable = (
    title: string,
    emptyText: string,
    rows: Array<{ name: string; hours: number; events: number }>,
    nameHeader: string,
  ) => (
    <div className="space-y-2">
      <div className="text-sm font-normal text-[#1a1a1a]">{title}</div>
      <div className={cn(CANVAS_TABLE_WRAPPER, 'max-h-[240px] overflow-y-auto')}>
        <table className={CANVAS_TABLE}>
          <TableCols widths={['10%', '52%', '20%', '18%']} />
          <thead className="sticky top-0 bg-white">
            <tr className={cn(CANVAS_HEADER_ROW, 'sticky top-0')}>
              <th className={`${CANVAS_HEADER_CELL} w-[44px] text-left border-r ${CANVAS_TABLE_BORDER}`}>#</th>
              <th className={`${CANVAS_HEADER_CELL} text-left border-r ${CANVAS_TABLE_BORDER}`}>{nameHeader}</th>
              <th className={`${CANVAS_HEADER_CELL} text-right border-r ${CANVAS_TABLE_BORDER}`}>Hours</th>
              <th className={`${CANVAS_HEADER_CELL} text-right`}>Events</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-5 text-center text-xs text-[#666]">
                  {emptyText}
                </td>
              </tr>
          ) : (
            rows.map((row, idx) => (
                <tr key={`${row.name}-${idx}`} className="transition-colors hover:bg-neutral-50/80">
                  <td className={cn(`${CANVAS_BODY_CELL} text-[#666] border-r ${CANVAS_TABLE_BORDER}`, idx !== rows.length - 1 && `border-b ${CANVAS_TABLE_BORDER}`)}>{idx + 1}</td>
                  <td className={cn(`${CANVAS_BODY_CELL} text-[#1a1a1a] border-r ${CANVAS_TABLE_BORDER}`, idx !== rows.length - 1 && `border-b ${CANVAS_TABLE_BORDER}`)}><span className="line-clamp-1">{row.name}</span></td>
                  <td className={cn(`${CANVAS_BODY_CELL} text-[#1a1a1a] text-right tabular-nums border-r ${CANVAS_TABLE_BORDER}`, idx !== rows.length - 1 && `border-b ${CANVAS_TABLE_BORDER}`)}>{formatNumber(row.hours)}h</td>
                  <td className={cn(`${CANVAS_BODY_CELL} text-[#666] text-right tabular-nums`, idx !== rows.length - 1 && `border-b ${CANVAS_TABLE_BORDER}`)}>{row.events.toLocaleString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  const computerDailyRows = [...(computer?.daily || [])].sort((a, b) => String(a.day).localeCompare(String(b.day)));
  const computerDailyTableRows = computerDailyRows.map((row) => ({
    date: row.day,
    value: `${formatNumber(row.active_hours)}h`,
    entries: row.events_count || 0,
  }));
  const appTableRows = (computer?.top_apps || []).slice(0, 10).map((app) => ({
    name: app.app_name || 'Unknown',
    hours: app.hours || 0,
    events: app.total_events || 0,
  }));
  const domainTableRows = (computer?.top_domains || []).slice(0, 10).map((domain) => ({
    name: domain.domain || 'Unknown',
    hours: domain.hours || 0,
    events: domain.total_events || 0,
  }));

  return (
    <div className="space-y-6">
      {habits.map((habit) => (
        <div key={habit.id} className="space-y-2">
          <h4 className="text-sm font-normal text-[#1a1a1a]">{habit.name}</h4>

          {(() => {
            const isSleepHabit = isSleepDurationHabit(habit.name);
            const dailyRows = [...(habit.daily || [])].sort((a, b) => a.date.localeCompare(b.date));

            const detailRows = dailyRows.map((row) => {
              const sleepStart = formatTimeList([
                row.sleep_start,
                ...(row.entries || []).map((entry) => entry.sleep_start),
              ]);
              const sleepEnd = formatTimeList([
                row.sleep_end,
                ...(row.entries || []).map((entry) => entry.sleep_end),
              ]);
              const displayValue =
                row.total_hours != null && row.total_hours > 0
                  ? formatMetric(row.total_hours, habit.unit)
                  : row.total_amount != null && row.total_amount > 0
                    ? formatMetric(row.total_amount, habit.unit)
                    : formatMetric(row.value || 0, habit.unit);

              return {
                date: formatDate(row.date),
                value: displayValue,
                entries: `${row.entries?.length || 0}`,
                time: formatTimeList((row.entries || []).map((entry) => entry.time)),
                sleepTime: sleepStart,
                wakeTime: sleepEnd,
              };
            });

            return (
              <HabitDailyTable
                rows={detailRows}
                isSleepHabit={isSleepHabit}
                emptyText="No rows available for this habit in the selected range."
              />
            );
          })()}
        </div>
      ))}

      {computer && (
        <div className="space-y-2">
          <h4 className="text-sm font-normal text-[#1a1a1a]">Computer Time</h4>
          <HabitDailyTable
            rows={computerDailyTableRows.map((row) => ({
              date: formatDate(row.date),
              value: row.value,
              time: '—',
              entries: formatEvents(row.entries),
            }))}
            isSleepHabit={false}
            emptyText="No computer time rows found for this date range."
          />

          {renderRankedUsageTable(
            'Top Apps',
            'No application activity found for this date range.',
            appTableRows,
            'App',
          )}

          {renderRankedUsageTable(
            'Top Websites',
            'No domain activity found for this date range.',
            domainTableRows,
            'Website',
          )}
        </div>
      )}
    </div>
  );
});

// ====================
// MAIN CANVAS COMPONENT - MIDDAY STYLE
// ====================
export const HabitCanvas = memo(function HabitCanvas({ data, onClose }: HabitCanvasProps) {
  if (!data) return null;

  const hasTrends = data.trends && data.trends.success;
  const hasAnomalies = data.anomalies && data.anomalies.success;
  const hasWeeklyOverview = data.weeklyOverview && data.weeklyOverview.success;
  const hasStats = data.stats;
  const hasDailyData = data.dailyData && data.dailyData.length > 0;

  const isHoursBased = data.stats?.totalHours !== undefined && data.stats.totalHours > 0;
  const unit = data.stats?.unit;
  const totalValue = isHoursBased ? data.stats?.totalHours : data.stats?.totalAmount;
  
  return (
    <div className="w-full h-full bg-white flex flex-col overflow-hidden">
      {/* Header — single title with date range and close */}
      <div className="flex items-start justify-between border-b border-[#e6e6e6] px-6 py-4 shrink-0">
        <div>
          <h2 className="text-lg font-normal text-[#1a1a1a] leading-tight">
            {data.title}
          </h2>
          {data.dateRange && (
            <p className="text-xs text-[#666] mt-1">
              {formatDateRange(data.dateRange.start, data.dateRange.end)}
            </p>
          )}
          {hasTrends && data.trends && (
            <p className="text-xs text-[#666] mt-1">
              Last {data.trends.window_days} days vs prior {data.trends.window_days} days
            </p>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-1 text-[#999] hover:text-black transition-colors mt-0.5"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Main content - scrollable, Midday padding */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {/* Trends Section */}
        {hasTrends && data.trends && (
          <TrendsSection trends={data.trends} />
        )}

        {/* Anomalies Section */}
        {hasAnomalies && data.anomalies && (
          <AnomaliesSection anomalies={data.anomalies} />
        )}

        {/* Weekly Overview Section */}
        {hasWeeklyOverview && data.weeklyOverview && (
          <WeeklyOverviewSection weeklyOverview={data.weeklyOverview} />
        )}

        {/* Stats Summary - Midday style */}
        {hasStats && !hasTrends && !hasAnomalies && !hasWeeklyOverview && (
          <div className="grid grid-cols-2 gap-3 mb-6">
            {totalValue !== undefined && (
              <div className="border border-[#ebebeb] p-3 bg-white">
                <div className="text-[12px] text-[#707070] mb-1">Total</div>
                <div className="text-sm font-normal text-[#1a1a1a]">
                  {formatValueWithUnit(totalValue, unit, isHoursBased)}
                </div>
              </div>
            )}
            {data.stats && data.stats.avgPerDay !== undefined && (
              <div className="border border-[#ebebeb] p-3 bg-white">
                <div className="text-[12px] text-[#707070] mb-1">Average per day</div>
                <div className="text-sm font-normal text-[#1a1a1a]">
                  {formatValueWithUnit(data.stats.avgPerDay, unit, isHoursBased)}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Daily Data Table - Midday style with borders */}
        {hasDailyData && data.dailyData && !hasWeeklyOverview && (() => {
          const isSleepData = isSleepDurationHabit(data.habitName);
          
          return (
            <div className="mb-6">
              <h4 className="text-sm font-normal text-[#1a1a1a] mb-4">
                Daily breakdown
              </h4>

              <HabitDailyTable
                rows={data.dailyData.map((day) => {
                  const displayValue = day.hours !== undefined
                    ? formatValueWithUnit(day.hours, unit, true)
                    : day.amount !== undefined
                      ? formatValueWithUnit(day.amount, unit, false)
                      : day.value !== undefined
                        ? formatValueWithUnit(day.value, unit, isHoursBased)
                        : '—';

                  return {
                    date: formatDate(day.date),
                    value: displayValue,
                    entries: `${day.entries?.length || 0}`,
                    time: formatTimeList((day.entries || []).map((entry) => entry.time)),
                    sleepTime: formatTimeList((day.entries || []).map((entry) => entry.sleep_start)),
                    wakeTime: formatTimeList((day.entries || []).map((entry) => entry.sleep_end)),
                  };
                })}
                isSleepHabit={isSleepData}
                emptyText="No habit rows available for this range."
              />
            </div>
          );
        })()}
      </div>
    </div>
  );
});

export default HabitCanvas;
