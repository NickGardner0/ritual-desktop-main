'use client';

import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useAuth, useUser } from '@clerk/nextjs';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  format,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  formatISO,
} from 'date-fns';
import { useHotkeys } from 'react-hotkeys-hook';
import { useRouter, useSearchParams } from 'next/navigation';
import { useHeartRateRange } from '@/hooks/useHeartRateRange';
import { dashboardQueryKeys } from '@/lib/dashboard/query-keys';
import { resolveEntity } from '@/lib/entities/resolve';

import { CalendarHeader } from './calendar-header';
import { CalendarMonthView } from './calendar-month-view';
import { CalendarWeekView } from './calendar-week-view';
import type {
  WeekScheduledItem,
  WeekSelectionPayload,
} from './calendar-week-view';
import type { HabitLog } from './tracker-events';
import {
  calendarVisibleRange,
  groupHeartRateSummariesByDay,
  groupLogsByDate,
  groupScheduledBlocksByDay,
  mapScheduledBlockFromApi,
  parseCalendarBlockSubtitle,
  shiftCalendarDate,
  weekDaysForDate,
  type CalendarHabitRef,
  type CalendarViewMode,
  type ProjectTimeSessionsResponse,
  type ScheduledBlockApi,
} from './calendar-client.helpers';
import { TaskComposerModal } from './task-composer-modal';
import { CalendarDayPanels } from './calendar-day-panels';
import { useLegacyScheduledBlockMigration } from './use-legacy-scheduled-block-migration';
import { useCalendarTaskComposer } from './use-calendar-task-composer';
import { useCalendarAiSummary } from './use-calendar-ai-summary';

type ViewMode = CalendarViewMode;

export function CalendarClient() {
  const ref = useRef<HTMLDivElement>(null);
  const selectedDayPanelRef = useRef<HTMLDivElement>(null);
  const openedBlockIdRef = useRef<string | null>(null);
  const { getToken } = useAuth();
  const { user } = useUser();
  const queryClient = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedBlockId = searchParams.get('block');
  const selectedDateParam = searchParams.get('date');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [range, setRange] = useState<[string, string] | null>(null);
  const weekStartsOnMonday = false;

  useEffect(() => {
    if (!selectedDateParam || !/^\d{4}-\d{2}-\d{2}$/.test(selectedDateParam)) return;
    const next = new Date(`${selectedDateParam}T12:00:00`);
    if (Number.isNaN(next.getTime())) return;
    setCurrentDate(next);
    setSelectedDate(selectedDateParam);
  }, [selectedDateParam]);

  const [isDragging, setIsDragging] = useState(false);
  const [localRange, setLocalRange] = useState<[string | null, string | null]>([null, null]);
  const [hoveredDate, setHoveredDate] = useState<Date | null>(null);
  const [hoveredData, setHoveredData] = useState<HabitLog[]>([]);

  const projectTimeSessionsQuery = useQuery({
    queryKey: ['calendar-project-time-sessions', selectedDate],
    queryFn: async () => {
      if (!selectedDate) return { success: true, data: [] } as ProjectTimeSessionsResponse;
      const params = new URLSearchParams({
        start_date: selectedDate,
        end_date: selectedDate,
        limit: '16',
      });
      const response = await fetch(`/api/watcher/project-time/sessions?${params}`, {
        cache: 'no-store',
      });
      if (!response.ok) return { success: false, data: [] } as ProjectTimeSessionsResponse;
      return response.json() as Promise<ProjectTimeSessionsResponse>;
    },
    enabled: Boolean(selectedDate),
    staleTime: 60_000,
  });
  const selectedProjectSessions = projectTimeSessionsQuery.data?.data || [];

  useEffect(() => {
    if (viewMode !== 'month' || !selectedDate || typeof document === 'undefined') return;

    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (selectedDayPanelRef.current?.contains(target)) return;
      setSelectedDate(null);
    };

    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [viewMode, selectedDate]);

  const { data: habits = [] } = useQuery<CalendarHabitRef[]>({
    queryKey: ['habits', user?.id],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch('/api/habits', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to fetch habits');
      return res.json();
    },
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
  });

  const dateRange = useMemo(
    () => calendarVisibleRange(currentDate, viewMode, weekStartsOnMonday),
    [currentDate, viewMode, weekStartsOnMonday],
  );

  const calendarReadModelRange = useMemo(() => {
    const start = format(dateRange.start, 'yyyy-MM-dd');
    const end = format(dateRange.end, 'yyyy-MM-dd');
    return { start, end, key: `${start}:${end}` };
  }, [dateRange.end, dateRange.start]);

  const calendarReadModelQuery = useQuery({
    queryKey: dashboardQueryKeys.calendarReadModel.detail(
      user?.id ?? 'anonymous',
      calendarReadModelRange.key,
    ),
    queryFn: async () => {
      const params = new URLSearchParams({
        start_date: calendarReadModelRange.start,
        end_date: calendarReadModelRange.end,
      });
      const res = await fetch(`/api/calendar/read-model?${params}`, {
        credentials: 'include',
        cache: 'no-store',
      });
      if (!res.ok) throw new Error('Failed to fetch calendar read model');
      return res.json();
    },
    enabled: !!user?.id,
    staleTime: 30 * 1000,
  });
  const logs = useMemo<HabitLog[]>(() => {
    const rows = calendarReadModelQuery.data?.habitLogs;
    return Array.isArray(rows) ? rows : [];
  }, [calendarReadModelQuery.data]);
  const logsPending = calendarReadModelQuery.isPending;

  const heartRateRangeQuery = useHeartRateRange(
    {
      start: dateRange.start.toISOString(),
      end: dateRange.end.toISOString(),
      resolution: '1m',
    },
    !!user?.id,
  );

  const habitMap = useMemo(() => {
    const map = new Map<string, CalendarHabitRef>();
    habits.forEach((habit) => map.set(habit.id, habit));
    return map;
  }, [habits]);

  const logsByDate = useMemo(
    () => groupLogsByDate(logs, habitMap),
    [logs, habitMap],
  );

  const { aiSummary, aiSummaryLoading } = useCalendarAiSummary(
    selectedDate,
    logsPending,
    logsByDate,
  );

  const calendarDays = useMemo(() => {
    return eachDayOfInterval({ start: dateRange.start, end: dateRange.end });
  }, [dateRange]);

  const heartRateSummariesByDay = useMemo(
    () => groupHeartRateSummariesByDay(heartRateRangeQuery.data?.points ?? []),
    [heartRateRangeQuery.data],
  );

  const firstWeek = useMemo(() => {
    return calendarDays.slice(0, 7);
  }, [calendarDays]);

  const weekDays = useMemo(
    () => weekDaysForDate(currentDate, weekStartsOnMonday),
    [currentDate, weekStartsOnMonday],
  );

  const scheduledBlocks = useMemo<WeekScheduledItem[]>(() => {
    const rows = calendarReadModelQuery.data?.scheduledBlocks;
    return Array.isArray(rows)
      ? (rows as ScheduledBlockApi[]).map(mapScheduledBlockFromApi)
      : [];
  }, [calendarReadModelQuery.data]);

  const navigatePrevious = useCallback(() => {
    setCurrentDate((prev) => shiftCalendarDate(prev, viewMode, -1));
  }, [viewMode]);

  const navigateNext = useCallback(() => {
    setCurrentDate((prev) => shiftCalendarDate(prev, viewMode, 1));
  }, [viewMode]);

  const navigateToToday = useCallback(() => {
    setCurrentDate(new Date());
  }, []);


  useHotkeys('arrowLeft', () => navigatePrevious(), {
    enabled: !selectedDate,
  });

  useHotkeys('arrowRight', () => navigateNext(), {
    enabled: !selectedDate,
  });

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

  const handleDayHover = useCallback((date: Date | null, data: HabitLog[]) => {
    setHoveredDate(date);
    setHoveredData(data);
  }, []);


  const scheduledBlocksByDay = useMemo(
    () => groupScheduledBlocksByDay(scheduledBlocks),
    [scheduledBlocks],
  );

  useLegacyScheduledBlockMigration();

  const {
    taskComposer,
    setTaskComposer,
    isSavingTaskComposer,
    taskComposerError,
    setTaskComposerError,
    openTaskComposer,
    handleScheduledItemClick,
    openMonthDayBlockEditor,
    handleScheduledItemUpdate,
    closeTaskComposer,
    saveTaskComposer,
    deleteTaskComposer,
  } = useCalendarTaskComposer(scheduledBlocksByDay);

  const replaceBlockParam = useCallback((blockId: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (blockId) params.set('block', blockId);
    else params.delete('block');
    const query = params.toString();
    const next = query ? `/calendar?${query}` : '/calendar';
    const current = searchParams.toString() ? `/calendar?${searchParams.toString()}` : '/calendar';
    if (next === current) return;
    router.replace(next, { scroll: false });
  }, [router, searchParams]);

  const onScheduledItemClick = useCallback((item: WeekScheduledItem) => {
    replaceBlockParam(item.id);
    handleScheduledItemClick(item);
  }, [handleScheduledItemClick, replaceBlockParam]);

  const onCreateSelection = useCallback((selection: WeekSelectionPayload) => {
    replaceBlockParam(null);
    openTaskComposer(selection);
  }, [openTaskComposer, replaceBlockParam]);

  const onDayBlockEditorOpen = useCallback((day: Date) => {
    replaceBlockParam(null);
    openMonthDayBlockEditor(day);
  }, [openMonthDayBlockEditor, replaceBlockParam]);

  const closeComposer = useCallback(() => {
    replaceBlockParam(null);
    closeTaskComposer();
  }, [closeTaskComposer, replaceBlockParam]);

  const saveComposer = useCallback(async () => {
    const saved = await saveTaskComposer();
    if (saved) replaceBlockParam(null);
  }, [replaceBlockParam, saveTaskComposer]);

  const deleteComposer = useCallback(async () => {
    const deleted = await deleteTaskComposer();
    if (deleted) replaceBlockParam(null);
  }, [deleteTaskComposer, replaceBlockParam]);

  useEffect(() => {
    if (!selectedBlockId) {
      openedBlockIdRef.current = null;
      return;
    }
    if (taskComposer?.id === selectedBlockId) {
      openedBlockIdRef.current = selectedBlockId;
      return;
    }

    const existing = scheduledBlocks.find((item) => item.id === selectedBlockId);
    if (existing) {
      openedBlockIdRef.current = selectedBlockId;
      setViewMode('week');
      setCurrentDate(new Date(`${existing.day}T12:00:00`));
      handleScheduledItemClick(existing);
      return;
    }

    if (calendarReadModelQuery.isPending) return;
    if (openedBlockIdRef.current === selectedBlockId) return;

    let cancelled = false;
    openedBlockIdRef.current = selectedBlockId;
    void resolveEntity(
      { type: 'calendar_block', id: selectedBlockId },
      { userId: user?.id, getToken },
    ).then((summary) => {
      if (cancelled) {
        openedBlockIdRef.current = null;
        return;
      }
      if (summary.availability !== 'ok') return;
      const parsed = parseCalendarBlockSubtitle(summary.subtitle);
      const dayKey = parsed?.dayKey;
      if (dayKey) {
        setViewMode('week');
        setCurrentDate(new Date(`${dayKey}T12:00:00`));
      }
      handleScheduledItemClick({
        id: selectedBlockId,
        title: summary.title,
        notes: '',
        day: dayKey || format(new Date(), 'yyyy-MM-dd'),
        startMinutes: parsed?.startMinutes ?? 9 * 60,
        endMinutes: parsed?.endMinutes ?? 10 * 60,
      });
    });

    return () => {
      cancelled = true;
    };
  }, [
    calendarReadModelQuery.isPending,
    getToken,
    handleScheduledItemClick,
    scheduledBlocks,
    selectedBlockId,
    taskComposer?.id,
    user?.id,
  ]);



  const validRange: [string, string] | null =
    range && range.length === 2 ? [range[0], range[1]] : null;


  const taskComposerModal = taskComposer ? (
    <TaskComposerModal
      taskComposer={taskComposer}
      taskComposerError={taskComposerError}
      isSavingTaskComposer={isSavingTaskComposer}
      setTaskComposer={setTaskComposer}
      setTaskComposerError={setTaskComposerError}
      closeTaskComposer={closeComposer}
      saveTaskComposer={saveComposer}
      deleteTaskComposer={deleteComposer}
    />
  ) : null;

  return (
    <div
      ref={ref}
      className={
        viewMode === 'month'
          ? 'flex min-h-full flex-col bg-background'
          : 'flex h-full min-h-0 flex-col bg-background'
      }
    >
      {/* Header */}
      <div className="shrink-0 px-6">
        <CalendarHeader
          currentDate={currentDate}
          viewMode={viewMode}
          weekStartsOnMonday={weekStartsOnMonday}
          onViewChange={setViewMode}
          onNavigatePrevious={navigatePrevious}
          onNavigateNext={navigateNext}
          onNavigateToToday={navigateToToday}
        />
      </div>

      {viewMode === 'month' ? (
        <div className="px-6 pb-16">
          <div className="relative">
            <CalendarMonthView
              firstWeek={firstWeek}
              calendarDays={calendarDays}
              currentDate={currentDate}
              selectedDate={selectedDate}
              logsByDate={logsByDate}
              scheduledItems={scheduledBlocks}
              range={validRange}
              localRange={localRange}
              isDragging={isDragging}
              weekStartsOnMonday={weekStartsOnMonday}
              handleMouseDown={handleMouseDown}
              handleMouseEnter={handleMouseEnter}
              handleMouseUp={handleMouseUp}
              onEventClick={handleEventClick}
              onScheduledItemClick={onScheduledItemClick}
              onDayBlockEditorOpen={onDayBlockEditorOpen}
              onDayHover={handleDayHover}
              heartRateSummariesByDay={heartRateSummariesByDay}
              onWeekClick={(_weekNumber, weekStart) => {
                const weekEnd = endOfWeek(weekStart, { weekStartsOn: weekStartsOnMonday ? 1 : 0 });
                setRange([
                  formatISO(weekStart, { representation: 'date' }),
                  formatISO(weekEnd, { representation: 'date' }),
                ]);
                setSelectedDate(null);
              }}
            />
            {taskComposerModal}
          </div>

          <CalendarDayPanels
            hoveredDate={hoveredDate}
            hoveredData={hoveredData}
            selectedDate={selectedDate}
            setSelectedDate={setSelectedDate}
            selectedDayPanelRef={selectedDayPanelRef}
            logsByDate={logsByDate}
            selectedProjectSessions={selectedProjectSessions}
            aiSummary={aiSummary}
            aiSummaryLoading={aiSummaryLoading}
            validRange={validRange}
            setRange={setRange}
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1 px-6 pb-6">
          <div className="relative h-full">
            <CalendarWeekView
              weekDays={weekDays}
              currentDate={currentDate}
              scheduledItems={scheduledBlocks}
              onCreateSelection={onCreateSelection}
              onItemClick={onScheduledItemClick}
              onItemUpdate={handleScheduledItemUpdate}
            />
            {taskComposerModal}
          </div>
        </div>
      )}
    </div>
  );
}
