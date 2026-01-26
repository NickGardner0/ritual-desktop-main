'use client';

import { memo } from 'react';
import { cn } from '@/lib/utils';
import { secondsToHoursAndMinutes } from './utils';

export type HabitLog = {
  id: string;
  habit_id: string;
  habit_name: string;
  date: string;
  duration?: number;
  amount?: number;
  unit_type?: string;
  icon?: string;
  category?: string;
};

type TrackerEventsProps = {
  data: HabitLog[];
  isToday: boolean;
  maxVisible?: number;
  onEventClick?: (log: HabitLog) => void;
};

export const TrackerEvents = memo(function TrackerEvents({
  data,
  isToday,
  maxVisible = 3,
  onEventClick,
}: TrackerEventsProps) {
  if (data.length === 0) return null;

  return (
    <div className="flex flex-col space-y-1.5 font-sans w-full overflow-hidden mt-0.5">
      {data.slice(0, maxVisible).map((log, index) => {
        const displayDuration = log.duration ?? 0;
        const hasAmount = log.amount && !log.duration;

        return (
          <div
            key={log.id || index}
            onClick={(e) => {
              e.stopPropagation();
              onEventClick?.(log);
            }}
            className={cn(
              'text-xs p-1 w-full text-left min-h-[22px] flex items-center overflow-hidden transition-colors cursor-pointer',
              // Same styling as Midday
              'bg-[#F0F0F0] dark:bg-[#1D1D1D] text-[#606060] dark:text-[#878787]',
              'hover:bg-[#E8E8E8] dark:hover:bg-[#252525]',
              // On today, use background color
              isToday && '!bg-background border border-border'
            )}
            data-event-id={log.id}
          >
            <div className="truncate w-full">
              <span className="truncate">
                {log.habit_name}
                {displayDuration > 0 && (
                  <span className="text-[#878787] dark:text-[#606060]">
                    {' '}({secondsToHoursAndMinutes(displayDuration)})
                  </span>
                )}
                {hasAmount && (
                  <span className="text-[#878787] dark:text-[#606060]">
                    {' '}({log.amount} {log.unit_type || ''})
                  </span>
                )}
              </span>
            </div>
          </div>
        );
      })}

      {/* More indicator */}
      {data.length > maxVisible && (
        <div
          className="text-xs text-primary p-1 w-full text-left cursor-pointer overflow-hidden"
          data-show-all-events="true"
        >
          <div className="truncate">+{data.length - maxVisible} more</div>
        </div>
      )}
    </div>
  );
});
