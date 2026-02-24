'use client';

import { memo, useCallback } from 'react';
import { format, formatISO, isToday } from 'date-fns';
import { cn } from '@/lib/utils';
import type { HabitLog } from './tracker-events';
import type { WeekScheduledItem } from './calendar-week-view';
import {
  checkIsInRange,
  checkIsFirstSelectedDate,
  checkIsLastSelectedDate,
} from './utils';

type CalendarDayProps = {
  date: Date;
  currentDate: Date;
  selectedDate: string | null;
  dayData: HabitLog[];
  scheduledItems: WeekScheduledItem[];
  range: [string, string] | null;
  localRange: [string | null, string | null];
  isDragging: boolean;
  handleMouseDown: (date: Date) => void;
  handleMouseEnter: (date: Date) => void;
  handleMouseUp: () => void;
  onEventClick?: (log: HabitLog) => void;
  onScheduledItemClick?: (item: WeekScheduledItem) => void;
  onDayBlockEditorOpen?: (date: Date) => void;
  onHover?: (date: Date | null, data: HabitLog[]) => void;
};

export const CalendarDay = memo(function CalendarDay({
  date,
  currentDate,
  selectedDate,
  dayData,
  scheduledItems,
  range,
  localRange,
  isDragging,
  handleMouseDown,
  handleMouseEnter,
  handleMouseUp,
  onScheduledItemClick,
  onDayBlockEditorOpen,
  onHover,
}: CalendarDayProps) {
  const isCurrentMonth = date.getMonth() === currentDate.getMonth();
  const isDayToday = isToday(date);
  const formattedDate = formatISO(date, { representation: 'date' });
  const isSelected = selectedDate === formattedDate;

  const isInRange = useCallback(
    (d: Date) => checkIsInRange(d, isDragging, localRange, range),
    [isDragging, localRange, range]
  );

  const isFirstSelectedDate = useCallback(
    (d: Date) => checkIsFirstSelectedDate(d, isDragging, localRange, range),
    [isDragging, localRange, range]
  );

  const isLastSelectedDate = useCallback(
    (d: Date) => checkIsLastSelectedDate(d, isDragging, localRange, range),
    [isDragging, localRange, range]
  );

  const handleDayClick = () => {
    handleMouseDown(date);
  };

  const handleDayHover = () => {
    handleMouseEnter(date);
    onHover?.(date, dayData);
  };

  const handleDayLeave = () => {
    onHover?.(null, []);
  };

  const inRange = isInRange(date) || isFirstSelectedDate(date) || isLastSelectedDate(date);

  return (
    <div
      onMouseDown={handleDayClick}
      onMouseEnter={handleDayHover}
      onMouseLeave={handleDayLeave}
      onMouseUp={handleMouseUp}
      onDoubleClick={() => onDayBlockEditorOpen?.(date)}
      className={cn(
        'group aspect-square md:aspect-[4/2.25] pt-2 pb-2 px-3 text-lg relative transition-all duration-100 text-left flex space-x-2 select-none cursor-pointer bg-background overflow-hidden',
        // Today styling - subtle gray background
        isCurrentMonth && isDayToday && 'bg-[#f5f5f5] dark:bg-[#1a1a1a]',
        // Non-current month - just muted text, no pattern
        !isCurrentMonth && 'text-[#c0c0c0] dark:text-[#555]',
        // Selected state
        isSelected && 'ring-1 ring-primary',
        // In range states
        inRange && 'ring-1 ring-primary bg-opacity-50',
      )}
    >
      <div className="w-full">
        <div className="flex items-start justify-between">
          <div>{format(date, 'd')}</div>
          <button
            type="button"
            aria-label={`Add block on ${format(date, 'MMM d')}`}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onDayBlockEditorOpen?.(date);
            }}
            className="flex h-5 w-5 items-center justify-center text-[14px] leading-none text-[#8A8A8A] opacity-70 transition-opacity hover:text-[#111827] md:opacity-0 md:group-hover:opacity-100"
          >
            +
          </button>
        </div>

        {scheduledItems.length > 0 && (
          <div className="mt-1.5 space-y-1">
            {scheduledItems.slice(0, 3).map((item) => (
              <button
                key={item.id}
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onScheduledItemClick?.(item);
                }}
                className="w-full truncate border border-[#111827]/20 bg-[#111827] px-1.5 py-0.5 text-left text-[10px] font-medium text-white"
                title={item.title}
              >
                {item.title}
              </button>
            ))}

            {scheduledItems.length > 3 && (
              <div className="truncate text-[10px] text-[#6B7280]">
                +{scheduledItems.length - 3} more
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
});
