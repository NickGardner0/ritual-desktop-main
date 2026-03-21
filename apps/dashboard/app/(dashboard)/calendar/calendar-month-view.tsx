'use client';

import { memo, useMemo } from 'react';
import { format } from 'date-fns';
import { CalendarDay } from './calendar-day';
import type { HabitLog } from './tracker-events';
import type { WeekScheduledItem } from './calendar-week-view';

type CalendarMonthViewProps = {
  firstWeek: Date[];
  calendarDays: Date[];
  currentDate: Date;
  selectedDate: string | null;
  logsByDate: Map<string, HabitLog[]>;
  scheduledItems?: WeekScheduledItem[];
  range: [string, string] | null;
  localRange: [string | null, string | null];
  isDragging: boolean;
  weekStartsOnMonday?: boolean;
  handleMouseDown: (date: Date) => void;
  handleMouseEnter: (date: Date) => void;
  handleMouseUp: () => void;
  onEventClick?: (log: HabitLog) => void;
  onScheduledItemClick?: (item: WeekScheduledItem) => void;
  onDayBlockEditorOpen?: (date: Date) => void;
  onWeekClick?: (weekNumber: number, weekStart: Date) => void;
  onDayHover?: (date: Date | null, data: HabitLog[]) => void;
  heartRateSummariesByDay?: Map<string, {
    averageBpm: number;
    minBpm: number;
    maxBpm: number;
    sampleCount: number;
  }>;
};

export const CalendarMonthView = memo(function CalendarMonthView({
  firstWeek,
  calendarDays,
  currentDate,
  selectedDate,
  logsByDate,
  scheduledItems = [],
  range,
  localRange,
  isDragging,
  handleMouseDown,
  handleMouseEnter,
  handleMouseUp,
  onEventClick,
  onScheduledItemClick,
  onDayBlockEditorOpen,
  onDayHover,
  heartRateSummariesByDay = new Map(),
}: CalendarMonthViewProps) {
  const scheduledItemsByDay = useMemo(() => {
    const grouped = new Map<string, WeekScheduledItem[]>();

    for (const item of scheduledItems) {
      const existing = grouped.get(item.day) ?? [];
      existing.push(item);
      grouped.set(item.day, existing);
    }

    for (const [day, items] of grouped.entries()) {
      items.sort((a, b) => a.startMinutes - b.startMinutes);
      grouped.set(day, items);
    }

    return grouped;
  }, [scheduledItems]);

  return (
    <div className="grid grid-cols-7 gap-px border border-gray-300 dark:border-gray-700 bg-gray-300 dark:bg-gray-700">
      {/* Day headers - using firstWeek to get correct day order */}
      {firstWeek.map((day) => (
        <div
          key={day.toString()}
          className="py-5 px-3 bg-background text-xs font-medium text-[#878787] font-mono"
        >
          {format(day, 'EEE').toUpperCase()}
        </div>
      ))}

      {/* Calendar days */}
      {calendarDays.map((date, index) => {
        const dateKey = format(date, 'yyyy-MM-dd');
        const dayLogs = logsByDate.get(dateKey) || [];
        const dayScheduledItems = scheduledItemsByDay.get(dateKey) || [];
        const heartRateSummary = heartRateSummariesByDay.get(dateKey);

        return (
          <CalendarDay
            key={index}
            date={date}
            currentDate={currentDate}
            selectedDate={selectedDate}
            dayData={dayLogs}
            scheduledItems={dayScheduledItems}
            range={range}
            localRange={localRange}
            isDragging={isDragging}
            handleMouseDown={handleMouseDown}
            handleMouseEnter={handleMouseEnter}
            handleMouseUp={handleMouseUp}
            onEventClick={onEventClick}
            onScheduledItemClick={onScheduledItemClick}
            onDayBlockEditorOpen={onDayBlockEditorOpen}
            onHover={onDayHover}
            heartRateSummary={heartRateSummary}
          />
        );
      })}
    </div>
  );
});
