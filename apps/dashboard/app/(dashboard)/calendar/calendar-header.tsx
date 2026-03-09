'use client';

import { memo, useMemo } from 'react';
import { format, startOfWeek, endOfWeek, isSameMonth, isSameWeek, startOfToday } from 'date-fns';
import { ChevronLeft, ChevronRight, SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';

type ViewMode = 'week' | 'month';

type CalendarHeaderProps = {
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
  onSettingsChange,
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
    <div className="mb-6 flex items-center justify-end">
      {/* Controls */}
      <div className="flex items-center gap-2">
        {/* Today button - only show when not viewing current period */}
        {!isViewingCurrentPeriod && (
          <Button
            variant="outline"
            size="sm"
            onClick={onNavigateToToday}
            className="h-9 rounded-none border-gray-300 px-3 text-sm text-[#4B5563]"
          >
            Today
          </Button>
        )}

        {/* Period selector with navigation */}
        <div className="inline-flex h-9 items-center border border-gray-300 bg-white">
          <Button
            variant="ghost"
            size="icon"
            className="ml-2 h-5 w-5 rounded-none p-0 hover:bg-transparent"
            onClick={onNavigatePrevious}
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="whitespace-nowrap px-2 text-center text-sm">
            {getPeriodLabel()}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="mr-2 h-5 w-5 rounded-none p-0 hover:bg-transparent"
            onClick={onNavigateNext}
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9 rounded-none border-gray-300"
              title="Calendar settings"
            >
              <SlidersHorizontal className="h-4 w-4 text-[#6B7280]" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56" align="end">
            <div className="flex items-center space-x-2 py-2">
              <Checkbox
                id="week-starts"
                checked={weekStartsOnMonday}
                onCheckedChange={(checked) => {
                  onSettingsChange?.({ weekStartsOnMonday: Boolean(checked) });
                }}
              />
              <Label htmlFor="week-starts" className="text-sm font-normal cursor-pointer">
                Week starts on Monday
              </Label>
            </div>
          </PopoverContent>
        </Popover>

        {/* View mode toggle */}
        <div className="flex h-9 items-stretch border border-gray-300">
          <button
            onClick={() => onViewChange('week')}
            className={cn(
              'flex items-center border-r border-gray-300 px-3 text-sm transition-colors',
              viewMode === 'week'
                ? 'bg-[#EDEDED] text-[#111827]'
                : 'bg-white text-[#707070] hover:text-[#111827]'
            )}
          >
            Week
          </button>
          <button
            onClick={() => onViewChange('month')}
            className={cn(
              'flex items-center px-3 text-sm transition-colors',
              viewMode === 'month'
                ? 'bg-[#EDEDED] text-[#111827]'
                : 'bg-white text-[#707070] hover:text-[#111827]'
            )}
          >
            Month
          </button>
        </div>
      </div>
    </div>
  );
});
