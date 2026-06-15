'use client';

import { memo } from 'react';
import { HabitDailyTable } from './habit-canvas-daily-table';
import {
  CANVAS_BODY_CELL,
  CANVAS_HEADER_CELL,
  CANVAS_HEADER_ROW,
  CANVAS_TABLE,
  CANVAS_TABLE_BORDER,
  CANVAS_TABLE_WRAPPER,
  TableCols,
  cn,
  formatDate,
  formatDateRange,
  formatTimeList,
  formatUnit,
  formatValueWithUnit,
  isSleepDurationHabit,
  type WeeklyOverviewData,
} from './habit-canvas.shared';

export const WeeklyOverviewSection = memo(function WeeklyOverviewSection({
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
