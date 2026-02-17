'use client';

import React, { useState, useMemo, useCallback, useRef } from 'react';
import { useAuth, useUser } from '@clerk/nextjs';
import { useQuery } from '@tanstack/react-query';
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  addMonths,
  subMonths,
  addWeeks,
  subWeeks,
  formatISO,
  formatDistanceToNow,
  isToday,
  isYesterday,
  isTomorrow,
  differenceInDays,
} from 'date-fns';
import { useHotkeys } from 'react-hotkeys-hook';

import { CalendarHeader } from './calendar-header';
import { CalendarMonthView } from './calendar-month-view';
import { CalendarWeekView } from './calendar-week-view';
import type { HabitLog } from './tracker-events';

type ViewMode = 'week' | 'month';

type Habit = {
  id: string;
  name: string;
  icon?: string;
  category?: string;
  unit_type?: string;
};

export function CalendarClient() {
  const ref = useRef<HTMLDivElement>(null);
  const { getToken } = useAuth();
  const { user } = useUser();

  // State
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [range, setRange] = useState<[string, string] | null>(null);
  const [weekStartsOnMonday, setWeekStartsOnMonday] = useState(false);

  // Drag selection state
  const [isDragging, setIsDragging] = useState(false);
  const [localRange, setLocalRange] = useState<[string | null, string | null]>([
    null,
    null,
  ]);

  // Hover state for the bottom panel (like Lumen)
  const [hoveredDate, setHoveredDate] = useState<Date | null>(null);
  const [hoveredData, setHoveredData] = useState<HabitLog[]>([]);

  // Fetch habits
  const { data: habits = [] } = useQuery<Habit[]>({
    queryKey: ['habits', user?.id],
    queryFn: async () => {
      const token = await getToken();
      const backendUrl =
        process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';
      const res = await fetch(`${backendUrl}/api/habits`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to fetch habits');
      return res.json();
    },
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
  });

  // Calculate date range based on view
  const dateRange = useMemo(() => {
    if (viewMode === 'month') {
      const monthStart = startOfMonth(currentDate);
      const monthEnd = endOfMonth(currentDate);
      const calendarStart = startOfWeek(monthStart, {
        weekStartsOn: weekStartsOnMonday ? 1 : 0,
      });
      const calendarEnd = endOfWeek(monthEnd, {
        weekStartsOn: weekStartsOnMonday ? 1 : 0,
      });
      return { start: calendarStart, end: calendarEnd };
    } else {
      const weekStart = startOfWeek(currentDate, {
        weekStartsOn: weekStartsOnMonday ? 1 : 0,
      });
      const weekEnd = endOfWeek(currentDate, {
        weekStartsOn: weekStartsOnMonday ? 1 : 0,
      });
      return { start: weekStart, end: weekEnd };
    }
  }, [currentDate, viewMode, weekStartsOnMonday]);

  // Fetch habit logs
  const { data: logs = [] } = useQuery<HabitLog[]>({
    queryKey: [
      'habit-logs-calendar',
      user?.id,
      format(dateRange.start, 'yyyy-MM-dd'),
      format(dateRange.end, 'yyyy-MM-dd'),
    ],
    queryFn: async () => {
      const token = await getToken();
      const backendUrl =
        process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';
      const params = new URLSearchParams({
        start_date: format(dateRange.start, 'yyyy-MM-dd'),
        end_date: format(dateRange.end, 'yyyy-MM-dd'),
      });
      const res = await fetch(`${backendUrl}/api/habit-logs?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to fetch logs');
      return res.json();
    },
    enabled: !!user?.id,
    staleTime: 30 * 1000,
  });

  // Create habit map
  const habitMap = useMemo(() => {
    const map = new Map<string, Habit>();
    habits.forEach((habit) => map.set(habit.id, habit));
    return map;
  }, [habits]);

  // Group logs by date
  const logsByDate = useMemo(() => {
    const grouped = new Map<string, HabitLog[]>();
    logs.forEach((log) => {
      const dateKey = log.date?.split('T')[0];
      if (!dateKey) return;
      const existing = grouped.get(dateKey) || [];
      const habit = habitMap.get(log.habit_id);
      existing.push({
        ...log,
        habit_name: log.habit_name || habit?.name || 'Unknown',
        icon: log.icon || habit?.icon,
        category: log.category || habit?.category,
      });
      grouped.set(dateKey, existing);
    });
    return grouped;
  }, [logs, habitMap]);

  // Calculate total duration for display
  const totalDuration = useMemo(() => {
    return logs.reduce((total, log) => total + (log.duration || 0), 0);
  }, [logs]);

  // Generate calendar days
  const calendarDays = useMemo(() => {
    return eachDayOfInterval({ start: dateRange.start, end: dateRange.end });
  }, [dateRange]);

  // First week for headers
  const firstWeek = useMemo(() => {
    return calendarDays.slice(0, 7);
  }, [calendarDays]);

  // Week days for week view
  const weekDays = useMemo(() => {
    const weekStart = startOfWeek(currentDate, {
      weekStartsOn: weekStartsOnMonday ? 1 : 0,
    });
    const weekEnd = endOfWeek(currentDate, {
      weekStartsOn: weekStartsOnMonday ? 1 : 0,
    });
    return eachDayOfInterval({ start: weekStart, end: weekEnd });
  }, [currentDate, weekStartsOnMonday]);

  // Navigation
  const navigatePrevious = useCallback(() => {
    if (viewMode === 'month') {
      setCurrentDate((prev) => subMonths(prev, 1));
    } else {
      setCurrentDate((prev) => subWeeks(prev, 1));
    }
  }, [viewMode]);

  const navigateNext = useCallback(() => {
    if (viewMode === 'month') {
      setCurrentDate((prev) => addMonths(prev, 1));
    } else {
      setCurrentDate((prev) => addWeeks(prev, 1));
    }
  }, [viewMode]);

  const navigateToToday = useCallback(() => {
    setCurrentDate(new Date());
  }, []);

  // Keyboard navigation
  useHotkeys('arrowLeft', () => navigatePrevious(), {
    enabled: !selectedDate,
  });

  useHotkeys('arrowRight', () => navigateNext(), {
    enabled: !selectedDate,
  });

  // Drag selection handlers
  const handleMouseDown = useCallback((date: Date) => {
    setIsDragging(true);
    const formatted = formatISO(date, { representation: 'date' });
    setLocalRange([formatted, null]);
    setSelectedDate(null);
    setRange(null);
  }, []);

  const handleMouseEnter = useCallback(
    (date: Date) => {
      if (isDragging && localRange[0]) {
        setLocalRange((prev) => [
          prev[0],
          formatISO(date, { representation: 'date' }),
        ]);
      }
    },
    [isDragging, localRange]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    if (localRange[0] && localRange[1]) {
      let start = new Date(localRange[0]);
      let end = new Date(localRange[1]);
      if (start > end) [start, end] = [end, start];

      const formattedStart = formatISO(start, { representation: 'date' });
      const formattedEnd = formatISO(end, { representation: 'date' });

      setRange([formattedStart, formattedEnd]);
      setSelectedDate(null);
    } else if (localRange[0]) {
      setSelectedDate(localRange[0]);
      setRange(null);
    }
    setLocalRange([null, null]);
  }, [localRange]);

  const handleEventClick = useCallback((log: HabitLog) => {
    const dateKey = log.date?.split('T')[0];
    if (dateKey) {
      setSelectedDate(dateKey);
      setRange(null);
    }
  }, []);

  const handleSettingsChange = useCallback(
    (settings: { weekStartsOnMonday?: boolean }) => {
      if (settings.weekStartsOnMonday !== undefined) {
        setWeekStartsOnMonday(settings.weekStartsOnMonday);
      }
    },
    []
  );

  // Handle day hover for the bottom panel
  const handleDayHover = useCallback((date: Date | null, data: HabitLog[]) => {
    setHoveredDate(date);
    setHoveredData(data);
  }, []);

  // Valid range for components
  const validRange: [string, string] | null =
    range && range.length === 2 ? [range[0], range[1]] : null;

  return (
    <div ref={ref} className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="px-8 pt-6">
        <CalendarHeader
          totalDuration={totalDuration}
          currentDate={currentDate}
          viewMode={viewMode}
          weekStartsOnMonday={weekStartsOnMonday}
          onViewChange={setViewMode}
          onNavigatePrevious={navigatePrevious}
          onNavigateNext={navigateNext}
          onNavigateToToday={navigateToToday}
          onSettingsChange={handleSettingsChange}
        />
      </div>

      {/* Calendar Grid */}
      <div className="px-8 overflow-auto">
        {viewMode === 'month' ? (
          <CalendarMonthView
            firstWeek={firstWeek}
            calendarDays={calendarDays}
            currentDate={currentDate}
            selectedDate={selectedDate}
            logsByDate={logsByDate}
            range={validRange}
            localRange={localRange}
            isDragging={isDragging}
            weekStartsOnMonday={weekStartsOnMonday}
            handleMouseDown={handleMouseDown}
            handleMouseEnter={handleMouseEnter}
            handleMouseUp={handleMouseUp}
            onEventClick={handleEventClick}
            onDayHover={handleDayHover}
            onWeekClick={(weekNumber, weekStart) => {
              // Select the entire week when clicking week number
              const weekEnd = endOfWeek(weekStart, { weekStartsOn: weekStartsOnMonday ? 1 : 0 });
              setRange([
                formatISO(weekStart, { representation: 'date' }),
                formatISO(weekEnd, { representation: 'date' }),
              ]);
              setSelectedDate(null);
            }}
          />
        ) : (
          <CalendarWeekView
            weekDays={weekDays}
            currentDate={currentDate}
            selectedDate={selectedDate}
            logsByDate={logsByDate}
            range={validRange}
            localRange={localRange}
            isDragging={isDragging}
            handleMouseDown={handleMouseDown}
            handleMouseEnter={handleMouseEnter}
            handleMouseUp={handleMouseUp}
            onEventClick={handleEventClick}
          />
        )}
      </div>

      {/* Hover panel - like Lumen (shows below calendar on left) */}
      {hoveredDate && !selectedDate && !validRange && (
        <div className="px-8 mt-4">
          <div className="border border-gray-300 dark:border-gray-700 bg-background p-5 w-[340px] min-h-[180px]">
            <p className="font-medium text-foreground font-mono text-lg">
              {format(hoveredDate, 'EEE, MMM d')}
            </p>
            <p className="text-sm text-[#878787] mt-1">
              {formatDistanceToNow(hoveredDate, { addSuffix: true })}
            </p>
            {hoveredData.length > 0 ? (
              <div className="mt-4 space-y-1">
                {(() => {
                  const totalDur = hoveredData.reduce((acc, log) => acc + (log.duration || 0), 0);
                  const hrs = Math.floor(totalDur / 3600);
                  const mins = Math.floor((totalDur % 3600) / 60);
                  return (
                    <>
                      {totalDur > 0 && (
                        <p className="text-sm text-[#878787]">
                          {hrs > 0 ? `${hrs}h ` : ''}{mins}m tracked
                        </p>
                      )}
                      <p className="text-sm text-[#878787]">
                        {hoveredData.length} {hoveredData.length === 1 ? 'entry' : 'entries'}
                      </p>
                    </>
                  );
                })()}
              </div>
            ) : (
              <p className="text-sm text-[#878787] mt-4 font-mono">
                Empty note
              </p>
            )}
          </div>
        </div>
      )}

      {/* Selected day panel */}
      {selectedDate && (
        <div className="px-8 mt-4">
          <div className="border border-gray-300 dark:border-gray-700 bg-background p-5 w-[340px] min-h-[180px]">
            <div className="flex items-center justify-between mb-1">
              <p className="font-medium text-foreground font-mono text-lg">
                {format(new Date(selectedDate), 'EEE, MMM d')}
              </p>
              <button
                onClick={() => setSelectedDate(null)}
                className="text-xs text-[#878787] hover:text-foreground transition-colors"
              >
                Close
              </button>
            </div>
            <p className="text-sm text-[#878787]">
              {(() => {
                const date = new Date(selectedDate);
                if (isToday(date)) return 'Today';
                if (isYesterday(date)) return 'Yesterday';
                if (isTomorrow(date)) return 'Tomorrow';
                const daysDiff = differenceInDays(new Date(), date);
                if (daysDiff > 0 && daysDiff <= 7) return `${daysDiff} days ago`;
                if (daysDiff < 0 && daysDiff >= -7) return `In ${Math.abs(daysDiff)} days`;
                return formatDistanceToNow(date, { addSuffix: true });
              })()}
            </p>

            {(() => {
              const dayLogs = logsByDate.get(selectedDate) || [];

              if (dayLogs.length === 0) {
                return (
                  <p className="text-sm text-[#878787] mt-4 font-mono">
                    Empty note
                  </p>
                );
              }

              return (
                <div className="mt-4 space-y-2 max-h-32 overflow-y-auto">
                  {dayLogs.map((log, index) => (
                    <div
                      key={log.id || index}
                      className="flex items-center justify-between text-sm"
                    >
                      <span className="font-medium">{log.habit_name}</span>
                      <span className="text-[#878787]">
                        {log.duration
                          ? `${Math.floor(log.duration / 3600)}h ${Math.floor((log.duration % 3600) / 60)}m`
                          : log.amount
                            ? `${log.amount} ${log.unit_type || ''}`
                            : 'Completed'}
                      </span>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Range selection panel */}
      {validRange && (
        <div className="px-8 mt-4">
          <div className="border border-gray-300 dark:border-gray-700 bg-background p-5 w-[340px] min-h-[180px]">
            <div className="flex items-center justify-between mb-1">
              <p className="font-medium text-foreground font-mono text-lg">
                {format(new Date(validRange[0]), 'MMM d')} - {format(new Date(validRange[1]), 'MMM d')}
              </p>
              <button
                onClick={() => setRange(null)}
                className="text-xs text-[#878787] hover:text-foreground transition-colors"
              >
                Clear
              </button>
            </div>
            <p className="text-sm text-[#878787]">
              {format(new Date(validRange[0]), 'yyyy')}
            </p>

            {(() => {
              // Calculate total for range
              let totalRangeDuration = 0;
              let totalRangeLogs = 0;

              const startDate = new Date(validRange[0]);
              const endDate = new Date(validRange[1]);
              const daysInRange = eachDayOfInterval({
                start: startDate,
                end: endDate,
              });

              daysInRange.forEach((day) => {
                const dateKey = format(day, 'yyyy-MM-dd');
                const dayLogs = logsByDate.get(dateKey) || [];
                totalRangeLogs += dayLogs.length;
                dayLogs.forEach((log) => {
                  totalRangeDuration += log.duration || 0;
                });
              });

              const hours = Math.floor(totalRangeDuration / 3600);
              const minutes = Math.floor((totalRangeDuration % 3600) / 60);

              return (
                <div className="mt-4 space-y-1">
                  <p className="text-sm text-[#878787]">
                    {hours}h {minutes}m tracked
                  </p>
                  <p className="text-sm text-[#878787]">
                    {totalRangeLogs} {totalRangeLogs === 1 ? 'entry' : 'entries'} over {daysInRange.length} days
                  </p>
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
