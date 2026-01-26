'use client';

import { memo } from 'react';
import { format } from 'date-fns';
import { CalendarDay } from './calendar-day';
import type { HabitLog } from './tracker-events';

type CalendarMonthViewProps = {
  firstWeek: Date[];
  calendarDays: Date[];
  currentDate: Date;
  selectedDate: string | null;
  logsByDate: Map<string, HabitLog[]>;
  range: [string, string] | null;
  localRange: [string | null, string | null];
  isDragging: boolean;
  weekStartsOnMonday?: boolean;
  handleMouseDown: (date: Date) => void;
  handleMouseEnter: (date: Date) => void;
  handleMouseUp: () => void;
  onEventClick?: (log: HabitLog) => void;
  onWeekClick?: (weekNumber: number, weekStart: Date) => void;
  onDayHover?: (date: Date | null, data: HabitLog[]) => void;
};

export const CalendarMonthView = memo(function CalendarMonthView({
  firstWeek,
  calendarDays,
  currentDate,
  selectedDate,
  logsByDate,
  range,
  localRange,
  isDragging,
  handleMouseDown,
  handleMouseEnter,
  handleMouseUp,
  onEventClick,
  onDayHover,
}: CalendarMonthViewProps) {
  return (
    <div className="grid grid-cols-7 gap-px border border-gray-300 dark:border-gray-700 bg-gray-300 dark:bg-gray-700">
      {/* Day headers - using firstWeek to get correct day order */}
      {firstWeek.map((day) => (
        <div
          key={day.toString()}
          className="py-4 px-3 bg-background text-xs font-medium text-[#878787] font-mono"
        >
          {format(day, 'EEE').toUpperCase()}
        </div>
      ))}

      {/* Calendar days */}
      {calendarDays.map((date, index) => {
        const dateKey = format(date, 'yyyy-MM-dd');
        const dayLogs = logsByDate.get(dateKey) || [];

        return (
          <CalendarDay
            key={index}
            date={date}
            currentDate={currentDate}
            selectedDate={selectedDate}
            dayData={dayLogs}
            range={range}
            localRange={localRange}
            isDragging={isDragging}
            handleMouseDown={handleMouseDown}
            handleMouseEnter={handleMouseEnter}
            handleMouseUp={handleMouseUp}
            onEventClick={onEventClick}
            onHover={onDayHover}
          />
        );
      })}
    </div>
  );
});
