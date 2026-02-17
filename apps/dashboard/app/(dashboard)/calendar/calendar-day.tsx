'use client';

import { memo, useCallback } from 'react';
import { format, formatISO, isToday } from 'date-fns';
import { cn } from '@/lib/utils';
import type { HabitLog } from './tracker-events';
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
  range: [string, string] | null;
  localRange: [string | null, string | null];
  isDragging: boolean;
  handleMouseDown: (date: Date) => void;
  handleMouseEnter: (date: Date) => void;
  handleMouseUp: () => void;
  onEventClick?: (log: HabitLog) => void;
  onHover?: (date: Date | null, data: HabitLog[]) => void;
};

export const CalendarDay = memo(function CalendarDay({
  date,
  currentDate,
  selectedDate,
  dayData,
  range,
  localRange,
  isDragging,
  handleMouseDown,
  handleMouseEnter,
  handleMouseUp,
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
      className={cn(
        'aspect-square md:aspect-[4/2] pt-2 pb-10 px-3 text-lg relative transition-all duration-100 text-left flex space-x-2 select-none cursor-pointer bg-background',
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
      <div>{format(date, 'd')}</div>
    </div>
  );
});
