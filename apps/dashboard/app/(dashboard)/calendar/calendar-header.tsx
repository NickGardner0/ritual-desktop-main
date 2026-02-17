'use client';

import { memo, useMemo } from 'react';
import { format, startOfWeek, endOfWeek, isSameMonth, isSameWeek, startOfToday } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

type ViewMode = 'week' | 'month';

type CalendarHeaderProps = {
  totalDuration: number;
  currentDate: Date;
  viewMode: ViewMode;
  weekStartsOnMonday?: boolean;
  onViewChange: (view: ViewMode) => void;
  onNavigatePrevious: () => void;
  onNavigateNext: () => void;
  onNavigateToToday: () => void;
  onSettingsChange?: (settings: { weekStartsOnMonday?: boolean }) => void;
};

export const CalendarHeader = memo(function CalendarHeader({
  currentDate,
  viewMode,
  weekStartsOnMonday = false,
  onViewChange,
  onNavigatePrevious,
  onNavigateNext,
  onNavigateToToday,
}: CalendarHeaderProps) {
  const today = startOfToday();

  // Check if we're currently viewing today's period
  const isViewingCurrentPeriod = useMemo(() => {
    if (viewMode === 'month') {
      return isSameMonth(currentDate, today);
    } else {
      return isSameWeek(currentDate, today, { weekStartsOn: weekStartsOnMonday ? 1 : 0 });
    }
  }, [currentDate, today, viewMode, weekStartsOnMonday]);

  // Get the period label based on view mode
  const getPeriodLabel = () => {
    if (viewMode === 'week') {
      const weekStart = startOfWeek(currentDate, {
        weekStartsOn: weekStartsOnMonday ? 1 : 0,
      });
      const weekEnd = endOfWeek(currentDate, {
        weekStartsOn: weekStartsOnMonday ? 1 : 0,
      });

      // If week spans across months, show both months
      if (weekStart.getMonth() !== weekEnd.getMonth()) {
        return `${format(weekStart, 'MMM d')} - ${format(weekEnd, 'MMM d, yyyy')}`;
      }

      // If same month, show month once
      return `${format(weekStart, 'MMM d')} - ${format(weekEnd, 'd, yyyy')}`;
    }
    return format(currentDate, 'MMMM');
  };

  return (
    <div className="flex items-center justify-end mb-6">
      {/* Controls */}
      <div className="flex items-center gap-2">
        {/* Today button - only show when not viewing current period */}
        {!isViewingCurrentPeriod && (
          <Button
            variant="outline"
            size="sm"
            onClick={onNavigateToToday}
            className="h-9 px-3 text-sm border-gray-300 dark:border-gray-700"
          >
            Today
          </Button>
        )}

        {/* Period selector with navigation */}
        <div className="flex items-center border border-gray-300 dark:border-gray-700 h-9">
          <Button
            variant="ghost"
            size="icon"
            className="p-0 w-5 h-5 hover:bg-transparent ml-2"
            onClick={onNavigatePrevious}
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-center text-sm px-2">
            {getPeriodLabel()}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="p-0 w-5 h-5 hover:bg-transparent mr-2"
            onClick={onNavigateNext}
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>

        {/* View mode toggle - Midday style */}
        <div className="flex items-stretch bg-[#f7f7f7] dark:bg-[#131313] h-9">
          <button
            onClick={() => onViewChange('week')}
            className={cn(
              'flex items-center px-3 text-sm transition-all border border-transparent',
              'text-[#707070] hover:text-foreground dark:text-[#666666] dark:hover:text-white',
              viewMode === 'week' &&
                'text-foreground bg-[#e6e6e6] dark:text-white dark:bg-[#1d1d1d]'
            )}
          >
            Week
          </button>
          <button
            onClick={() => onViewChange('month')}
            className={cn(
              'flex items-center px-3 text-sm transition-all border border-transparent',
              'text-[#707070] hover:text-foreground dark:text-[#666666] dark:hover:text-white',
              viewMode === 'month' &&
                'text-foreground bg-[#e6e6e6] dark:text-white dark:bg-[#1d1d1d]'
            )}
          >
            Month
          </button>
        </div>
      </div>
    </div>
  );
});
