'use client';

import { memo } from 'react';
import { format, isToday, isSameMonth } from 'date-fns';
import { cn } from '@/lib/utils';
import { formatHour } from './utils';
import type { HabitLog } from './tracker-events';

const HOUR_HEIGHT = 26; // Height per hour row

type CalendarWeekViewProps = {
  weekDays: Date[];
  currentDate: Date;
  selectedDate: string | null;
  logsByDate: Map<string, HabitLog[]>;
  range: [string, string] | null;
  localRange: [string | null, string | null];
  isDragging: boolean;
  handleMouseDown: (date: Date) => void;
  handleMouseEnter: (date: Date) => void;
  handleMouseUp: () => void;
  onEventClick?: (log: HabitLog) => void;
};

// Static hours array (0-23)
const hours = Array.from({ length: 24 }, (_, i) => i);

// Day column component for performance
const DayColumn = memo(function DayColumn({
  day,
  isDayToday,
  handleMouseDown,
  handleMouseEnter,
  handleMouseUp,
}: {
  day: Date;
  isDayToday: boolean;
  handleMouseDown: (date: Date) => void;
  handleMouseEnter: (date: Date) => void;
  handleMouseUp: () => void;
}) {
  return (
    <div
      className={cn(
        'relative bg-background',
        isDayToday && 'bg-[#f5f5f5]/30 dark:bg-[#1a1a1a]/30'
      )}
    >
      {/* Hour grid lines */}
      {hours.map((hour) => (
        <div
          key={`${day.toISOString()}-${hour}`}
          className="hover:bg-muted/10 transition-colors cursor-pointer border-b border-gray-300 dark:border-gray-700 relative group"
          style={{ height: `${HOUR_HEIGHT}px` }}
          onMouseDown={() => handleMouseDown(day)}
          onMouseEnter={() => handleMouseEnter(day)}
          onMouseUp={handleMouseUp}
        >
          {/* Hour hover indicator */}
          <div className="absolute inset-0 bg-primary/5 opacity-0 group-hover:opacity-100 pointer-events-none" />
        </div>
      ))}
    </div>
  );
});

export const CalendarWeekView = memo(function CalendarWeekView({
  weekDays,
  currentDate,
  handleMouseDown,
  handleMouseEnter,
  handleMouseUp,
}: CalendarWeekViewProps) {
  return (
    <div className="flex flex-col border border-gray-300 dark:border-gray-700 border-b-0">
      {/* Day headers */}
      <div
        className="grid gap-px bg-gray-300 dark:bg-gray-700 border-b border-gray-300 dark:border-gray-700"
        style={{ gridTemplateColumns: '80px repeat(7, 1fr)' }}
      >
        {/* Empty space above time column */}
        <div className="py-4 px-2 bg-background" />

        {/* Day headers - name and date on same row */}
        {weekDays.map((day) => {
          const isDayToday = isToday(day);
          const isCurrentMonth = isSameMonth(day, currentDate);

          return (
            <div
              key={day.toString()}
              className={cn(
                'py-4 px-2 bg-background text-xs font-medium text-[#878787] text-center',
                isDayToday && 'bg-[#f5f5f5] dark:bg-[#1a1a1a]'
              )}
            >
              <div className="flex flex-row items-end justify-center gap-2">
                <span className="uppercase">{format(day, 'EEE')}</span>
                <span
                  className={cn(
                    'text-foreground font-medium',
                    isDayToday &&
                      'bg-primary text-primary-foreground px-1.5 py-0.5 rounded-full text-xs'
                  )}
                >
                  {format(day, 'd')}
                </span>
                {!isCurrentMonth && (
                  <span className="text-[10px] text-[#878787] uppercase">
                    {format(day, 'MMM')}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Time grid */}
      <div
        className="grid gap-px bg-gray-300 dark:bg-gray-700 flex-1 overflow-auto"
        style={{ gridTemplateColumns: '80px repeat(7, 1fr)' }}
      >
        {/* Time labels column */}
        <div className="bg-background">
          {hours.map((hour) => (
            <div
              key={hour}
              className="flex items-center justify-center text-[12px] text-[#878787] border-b border-gray-300 dark:border-gray-700"
              style={{ height: `${HOUR_HEIGHT}px` }}
            >
              {formatHour(hour, 12)}
            </div>
          ))}
        </div>

        {/* Day columns */}
        {weekDays.map((day) => {
          const dateKey = format(day, 'yyyy-MM-dd');
          const isDayToday = isToday(day);

          return (
            <DayColumn
              key={dateKey}
              day={day}
              isDayToday={isDayToday}
              handleMouseDown={handleMouseDown}
              handleMouseEnter={handleMouseEnter}
              handleMouseUp={handleMouseUp}
            />
          );
        })}
      </div>
    </div>
  );
});
