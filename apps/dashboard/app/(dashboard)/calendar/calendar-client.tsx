'use client';

import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useAuth, useUser } from '@clerk/nextjs';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
  parseISO,
} from 'date-fns';
import { useHotkeys } from 'react-hotkeys-hook';
import { useHeartRateRange } from '@/hooks/useHeartRateRange';

import { CalendarHeader } from './calendar-header';
import { CalendarMonthView } from './calendar-month-view';
import { CalendarWeekView } from './calendar-week-view';
import type {
  WeekScheduledItem,
  WeekSelectionPayload,
  WeekScheduledItemUpdate,
} from './calendar-week-view';
import type { HabitLog } from './tracker-events';
import {
  LEGACY_SCHEDULED_BLOCK_KEYS,
  LEGACY_SCHEDULED_BLOCK_KEY_PATTERN,
  LEGACY_SCHEDULED_BLOCK_MIGRATION_VERSION,
  aggregateTooltipMetrics,
  extractLegacyArray,
  formatDurationDisplay,
  formatMinutesDisplay,
  formatMinutesInput,
  formatTooltipMetricName,
  formatTooltipMetricValue,
  mapScheduledBlockFromApi,
  normalizeLegacyBlock,
  parseMinutes,
  signatureFromApi,
  signatureFromPayload,
  type ProjectTimeSessionsResponse,
  type ScheduledBlockApi,
  type ScheduledBlockPayload,
} from './calendar-client.helpers';

type ViewMode = 'week' | 'month';

type Habit = {
  id: string;
  name: string;
  icon?: string;
  category?: string;
  unit_type?: string;
  integration_source?: string;
  metric_type?: string;
};

type TaskComposerState = {
  id: string | null;
  dayKey: string;
  startMinutes: number;
  endMinutes: number;
  title: string;
  notes: string;
};

export function CalendarClient() {
  const ref = useRef<HTMLDivElement>(null);
  const selectedDayPanelRef = useRef<HTMLDivElement>(null);
  const { getToken } = useAuth();
  const { user } = useUser();
  const queryClient = useQueryClient();

  // State
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [range, setRange] = useState<[string, string] | null>(null);
  const weekStartsOnMonday = false;

  // Drag selection state
  const [isDragging, setIsDragging] = useState(false);
  const [localRange, setLocalRange] = useState<[string | null, string | null]>([
    null,
    null,
  ]);

  // Hover state for the bottom panel (like Lumen)
  const [hoveredDate, setHoveredDate] = useState<Date | null>(null);
  const [hoveredData, setHoveredData] = useState<HabitLog[]>([]);

  // AI day summary state
  const [aiSummary, setAiSummary] = useState<string>('');
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);
  const aiAbortRef = useRef<AbortController | null>(null);
  const [taskComposer, setTaskComposer] = useState<TaskComposerState | null>(null);
  const [isSavingTaskComposer, setIsSavingTaskComposer] = useState(false);
  const [taskComposerError, setTaskComposerError] = useState<string | null>(null);

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

  useEffect(() => {
    if (!user?.id) return;
    if (typeof window === 'undefined') return;

    const migrationMarkerKey = `calendar-scheduled-blocks-migrated:${LEGACY_SCHEDULED_BLOCK_MIGRATION_VERSION}:${user.id}`;

    if (window.localStorage.getItem(migrationMarkerKey)) {
      return;
    }

    let isCancelled = false;

    const migrateLegacyScheduledBlocks = async () => {
      const legacyCandidates = new Set<string>(LEGACY_SCHEDULED_BLOCK_KEYS);
      for (let i = 0; i < window.localStorage.length; i += 1) {
        const key = window.localStorage.key(i);
        if (!key) continue;
        if (legacyCandidates.has(key) || LEGACY_SCHEDULED_BLOCK_KEY_PATTERN.test(key)) {
          legacyCandidates.add(key);
        }
      }

      const parsedBlocks: ScheduledBlockPayload[] = [];
      const consumedKeys: string[] = [];

      for (const key of legacyCandidates) {
        const rawValue = window.localStorage.getItem(key);
        if (!rawValue) continue;

        try {
          const parsedJson = JSON.parse(rawValue) as unknown;
          const legacyItems = extractLegacyArray(parsedJson);
          if (legacyItems.length === 0) continue;

          let foundAny = false;
          for (const legacyItem of legacyItems) {
            const normalized = normalizeLegacyBlock(legacyItem);
            if (!normalized) continue;
            parsedBlocks.push(normalized);
            foundAny = true;
          }

          if (foundAny) {
            consumedKeys.push(key);
          }
        } catch {
          // Ignore malformed legacy values and continue.
        }
      }

      if (parsedBlocks.length === 0) {
        window.localStorage.setItem(
          migrationMarkerKey,
          JSON.stringify({
            migratedAt: new Date().toISOString(),
            created: 0,
            skipped: 0,
            reason: 'no_legacy_blocks',
          })
        );
        return;
      }

      const token = await getToken();
      if (!token) return;

      const backendUrl = process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';

      const existingRes = await fetch(`${backendUrl}/api/calendar/scheduled-blocks`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!existingRes.ok) {
        throw new Error('Failed to fetch existing scheduled blocks before migration');
      }

      const existingBlocks = (await existingRes.json()) as ScheduledBlockApi[];
      const existingSignatures = new Set(existingBlocks.map(signatureFromApi));

      const dedupedLegacyBlocks = new Map<string, ScheduledBlockPayload>();
      for (const block of parsedBlocks) {
        const signature = signatureFromPayload(block);
        if (!dedupedLegacyBlocks.has(signature)) {
          dedupedLegacyBlocks.set(signature, block);
        }
      }

      let created = 0;
      let skipped = 0;
      let hasCreateFailure = false;

      for (const [signature, block] of dedupedLegacyBlocks) {
        if (existingSignatures.has(signature)) {
          skipped += 1;
          continue;
        }

        const createRes = await fetch(`${backendUrl}/api/calendar/scheduled-blocks`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(block),
        });

        if (createRes.ok) {
          created += 1;
          existingSignatures.add(signature);
        } else {
          skipped += 1;
          hasCreateFailure = true;
        }
      }

      if (hasCreateFailure) {
        throw new Error('Some legacy scheduled blocks failed to migrate');
      }

      for (const key of consumedKeys) {
        window.localStorage.removeItem(key);
      }

      window.localStorage.setItem(
        migrationMarkerKey,
        JSON.stringify({
          migratedAt: new Date().toISOString(),
          created,
          skipped,
          sourceKeys: consumedKeys,
        })
      );

      if (!isCancelled) {
        await queryClient.invalidateQueries({
          queryKey: ['calendar-scheduled-blocks', user.id],
        });
      }
    };

    migrateLegacyScheduledBlocks().catch((error) => {
      console.warn('Scheduled block migration skipped:', error);
    });

    return () => {
      isCancelled = true;
    };
  }, [getToken, queryClient, user?.id]);

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
  const { data: logs = [], isPending: logsPending } = useQuery<HabitLog[]>({
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

  const heartRateRangeQuery = useHeartRateRange(
    {
      start: dateRange.start.toISOString(),
      end: dateRange.end.toISOString(),
      resolution: '1m',
    },
    !!user?.id,
  );

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
        unit_type: log.unit_type || habit?.unit_type,
        metric_type: log.metric_type || habit?.metric_type,
        integration_source: log.integration_source || habit?.integration_source,
        icon: log.icon || habit?.icon,
        category: log.category || habit?.category,
      });
      grouped.set(dateKey, existing);
    });
    return grouped;
  }, [logs, habitMap]);

  // Generate calendar days
  const calendarDays = useMemo(() => {
    return eachDayOfInterval({ start: dateRange.start, end: dateRange.end });
  }, [dateRange]);

  const heartRateSummariesByDay = useMemo(() => {
    const grouped = new Map<string, {
      totalWeightedBpm: number;
      minBpm: number;
      maxBpm: number;
      sampleCount: number;
    }>();

    for (const point of heartRateRangeQuery.data?.points ?? []) {
      if (!('bucket_start' in point) || !point.bucket_start || point.sample_count == null || point.bpm_avg == null) {
        continue;
      }

      const dayKey = format(new Date(point.bucket_start), 'yyyy-MM-dd');
      const existing = grouped.get(dayKey) ?? {
        totalWeightedBpm: 0,
        minBpm: Number.POSITIVE_INFINITY,
        maxBpm: Number.NEGATIVE_INFINITY,
        sampleCount: 0,
      };

      existing.totalWeightedBpm += point.bpm_avg * point.sample_count;
      existing.sampleCount += point.sample_count;
      existing.minBpm = Math.min(existing.minBpm, point.bpm_min ?? point.bpm_avg);
      existing.maxBpm = Math.max(existing.maxBpm, point.bpm_max ?? point.bpm_avg);
      grouped.set(dayKey, existing);
    }

    return new Map(
      Array.from(grouped.entries()).map(([dayKey, value]) => [
        dayKey,
        {
          averageBpm: value.sampleCount > 0 ? value.totalWeightedBpm / value.sampleCount : 0,
          minBpm: Number.isFinite(value.minBpm) ? value.minBpm : 0,
          maxBpm: Number.isFinite(value.maxBpm) ? value.maxBpm : 0,
          sampleCount: value.sampleCount,
        },
      ]),
    );
  }, [heartRateRangeQuery.data]);

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

  const scheduledBlockRange = useMemo(() => {
    return {
      start: format(dateRange.start, 'yyyy-MM-dd'),
      end: format(dateRange.end, 'yyyy-MM-dd'),
    };
  }, [dateRange.end, dateRange.start]);

  const { data: scheduledBlocks = [] } = useQuery<WeekScheduledItem[]>({
    queryKey: [
      'calendar-scheduled-blocks',
      user?.id,
      scheduledBlockRange.start,
      scheduledBlockRange.end,
    ],
    queryFn: async () => {
      const token = await getToken();
      const backendUrl =
        process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';
      const params = new URLSearchParams({
        start_date: scheduledBlockRange.start,
        end_date: scheduledBlockRange.end,
      });
      const res = await fetch(`${backendUrl}/api/calendar/scheduled-blocks?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to fetch scheduled blocks');
      const data = (await res.json()) as ScheduledBlockApi[];
      return data.map(mapScheduledBlockFromApi);
    },
    enabled: !!user?.id,
    staleTime: 30 * 1000,
  });

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

  // AI day summary: fetch when selectedDate changes
  useEffect(() => {
    // Abort any previous stream
    aiAbortRef.current?.abort();
    setAiSummary('');
    setAiSummaryLoading(false);

    if (!selectedDate || logsPending) return;

    const controller = new AbortController();
    aiAbortRef.current = controller;

    const dayLogs = logsByDate.get(selectedDate) || [];
    const dayMetrics = aggregateTooltipMetrics(dayLogs);

    // Build simple metrics array for the API
    const metricsPayload = dayMetrics.map((m) => ({
      name: formatTooltipMetricName(m),
      value: formatTooltipMetricValue(m),
    }));

    setAiSummaryLoading(true);

    (async () => {
      try {
        const token = await getToken();
        const res = await fetch('/api/calendar/summary', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            date: selectedDate,
            habitMetrics: metricsPayload,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          console.error('AI summary fetch failed:', res.status, res.statusText);
          setAiSummary('');
          setAiSummaryLoading(false);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let full = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          full += decoder.decode(value, { stream: true });
          setAiSummary(full);
        }

        setAiSummaryLoading(false);
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          console.error('AI summary error:', err);
        }
        setAiSummaryLoading(false);
      }
    })();

    return () => controller.abort();
  }, [getToken, logsByDate, logsPending, selectedDate]);

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

  // Handle day hover for the bottom panel
  const handleDayHover = useCallback((date: Date | null, data: HabitLog[]) => {
    setHoveredDate(date);
    setHoveredData(data);
  }, []);

  const openTaskComposer = useCallback((selection: WeekSelectionPayload) => {
    setTaskComposerError(null);
    setTaskComposer({
      id: null,
      dayKey: selection.dayKey,
      startMinutes: selection.startMinutes,
      endMinutes: selection.endMinutes,
      title: '',
      notes: '',
    });
  }, []);

  const handleScheduledItemClick = useCallback((item: WeekScheduledItem) => {
    setTaskComposerError(null);
    setTaskComposer({
      id: item.id,
      dayKey: item.day,
      startMinutes: item.startMinutes,
      endMinutes: item.endMinutes,
      title: item.title,
      notes: item.notes ?? '',
    });
  }, []);

  const scheduledBlocksByDay = useMemo(() => {
    const grouped = new Map<string, WeekScheduledItem[]>();
    for (const item of scheduledBlocks) {
      const existing = grouped.get(item.day) ?? [];
      existing.push(item);
      grouped.set(item.day, existing);
    }
    for (const [day, items] of grouped.entries()) {
      items.sort((a, b) => a.startMinutes - b.startMinutes);
      grouped.set(day, items);
    }
    return grouped;
  }, [scheduledBlocks]);

  const openMonthDayBlockEditor = useCallback(
    (day: Date) => {
      const dayKey = format(day, 'yyyy-MM-dd');
      const dayBlocks = scheduledBlocksByDay.get(dayKey) ?? [];

      let startMinutes = 9 * 60;
      let endMinutes = 10 * 60;

      if (dayBlocks.length > 0) {
        const latestEnd = dayBlocks.reduce(
          (latest, block) => Math.max(latest, block.endMinutes),
          0
        );
        const roundedStart = Math.ceil(latestEnd / 15) * 15;
        startMinutes = Math.max(0, Math.min(roundedStart, (24 * 60) - 30));
        endMinutes = Math.min(startMinutes + 60, 24 * 60);
        if (endMinutes <= startMinutes) {
          startMinutes = Math.max(0, (24 * 60) - 60);
          endMinutes = 24 * 60;
        }
      }

      setTaskComposerError(null);
      setTaskComposer({
        id: null,
        dayKey,
        startMinutes,
        endMinutes,
        title: '',
        notes: '',
      });
    },
    [scheduledBlocksByDay]
  );

  const handleScheduledItemUpdate = useCallback(
    async (item: WeekScheduledItem, update: WeekScheduledItemUpdate) => {
      const hasChanged =
        item.day !== update.day ||
        item.startMinutes !== update.startMinutes ||
        item.endMinutes !== update.endMinutes;

      if (!hasChanged) return;

      queryClient.setQueriesData<WeekScheduledItem[]>(
        { queryKey: ['calendar-scheduled-blocks', user?.id] },
        (previous) => {
          if (!previous) return previous;
          return previous.map((block) =>
            block.id === item.id
              ? {
                  ...block,
                  day: update.day,
                  startMinutes: update.startMinutes,
                  endMinutes: update.endMinutes,
                }
              : block
          );
        }
      );

      try {
        const token = await getToken();
        if (!token) throw new Error('Authentication token missing');

        const backendUrl =
          process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';
        const response = await fetch(
          `${backendUrl}/api/calendar/scheduled-blocks/${item.id}`,
          {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              day: update.day,
              start_minutes: update.startMinutes,
              end_minutes: update.endMinutes,
            }),
          }
        );

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const detail = typeof errorData?.detail === 'string'
            ? errorData.detail
            : 'Failed to update block';
          throw new Error(detail);
        }

        setTaskComposer((prev) => {
          if (!prev || prev.id !== item.id) return prev;
          return {
            ...prev,
            dayKey: update.day,
            startMinutes: update.startMinutes,
            endMinutes: update.endMinutes,
          };
        });

        await queryClient.invalidateQueries({
          queryKey: ['calendar-scheduled-blocks', user?.id],
        });
      } catch (error) {
        setTaskComposerError(error instanceof Error ? error.message : 'Failed to update block');
        await queryClient.invalidateQueries({
          queryKey: ['calendar-scheduled-blocks', user?.id],
        });
      }
    },
    [getToken, queryClient, user?.id]
  );

  const closeTaskComposer = useCallback(() => {
    setTaskComposerError(null);
    setTaskComposer(null);
  }, []);

  const saveTaskComposer = useCallback(async () => {
    if (!taskComposer) return;

    const normalizedTitle = taskComposer.title.trim() || 'Untitled block';
    const payload = {
      title: normalizedTitle,
      notes: taskComposer.notes.trim() || null,
      day: taskComposer.dayKey,
      start_minutes: Math.max(0, Math.min(taskComposer.startMinutes, 24 * 60)),
      end_minutes: Math.max(taskComposer.startMinutes + 30, Math.min(taskComposer.endMinutes, 24 * 60)),
    };

    setIsSavingTaskComposer(true);
    setTaskComposerError(null);

    try {
      const token = await getToken();
      if (!token) throw new Error('Authentication token missing');

      const backendUrl =
        process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';
      const isEditing = Boolean(taskComposer.id);
      const endpoint = isEditing
        ? `/api/calendar/scheduled-blocks/${taskComposer.id}`
        : '/api/calendar/scheduled-blocks';

      const response = await fetch(`${backendUrl}${endpoint}`, {
        method: isEditing ? 'PUT' : 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const detail = typeof errorData?.detail === 'string'
          ? errorData.detail
          : 'Failed to save block';
        throw new Error(detail);
      }

      await queryClient.invalidateQueries({
        queryKey: ['calendar-scheduled-blocks', user?.id],
      });
      setTaskComposer(null);
    } catch (error) {
      setTaskComposerError(error instanceof Error ? error.message : 'Failed to save block');
    } finally {
      setIsSavingTaskComposer(false);
    }
  }, [getToken, queryClient, taskComposer, user?.id]);

  const deleteTaskComposer = useCallback(async () => {
    if (!taskComposer?.id) return;

    setIsSavingTaskComposer(true);
    setTaskComposerError(null);

    try {
      const token = await getToken();
      if (!token) throw new Error('Authentication token missing');

      const backendUrl =
        process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';
      const response = await fetch(
        `${backendUrl}/api/calendar/scheduled-blocks/${taskComposer.id}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const detail = typeof errorData?.detail === 'string'
          ? errorData.detail
          : 'Failed to delete block';
        throw new Error(detail);
      }

      await queryClient.invalidateQueries({
        queryKey: ['calendar-scheduled-blocks', user?.id],
      });
      setTaskComposer(null);
    } catch (error) {
      setTaskComposerError(error instanceof Error ? error.message : 'Failed to delete block');
    } finally {
      setIsSavingTaskComposer(false);
    }
  }, [getToken, queryClient, taskComposer, user?.id]);

  // Valid range for components
  const validRange: [string, string] | null =
    range && range.length === 2 ? [range[0], range[1]] : null;

  const taskComposerModal = taskComposer ? (
    <div className="absolute inset-0 z-40 flex items-center justify-center px-4 py-6">
      <button
        type="button"
        aria-label="Close block editor"
        onClick={closeTaskComposer}
        className="absolute inset-0 rounded-sm"
      />

      <div className="relative w-full max-w-[500px] rounded-sm border border-gray-300 bg-white shadow-[0_12px_28px_rgba(15,23,42,0.14)] selection:bg-[rgba(17,24,39,0.16)] selection:text-[#111827]">
        <div className="border-b border-gray-200 px-3 py-2.5">
          <p className="text-sm font-medium text-gray-900">
            {taskComposer.id ? 'Edit block' : 'New block'}
          </p>
          <p className="mt-0.5 text-xs text-gray-500">
            {format(new Date(taskComposer.dayKey), 'EEE, MMM d')} · {formatMinutesDisplay(taskComposer.startMinutes)} - {formatMinutesDisplay(taskComposer.endMinutes)}
          </p>
        </div>

        <div className="space-y-2.5 px-3 py-2.5">
          <div className="space-y-0.5">
            <label className="text-xs uppercase tracking-[0.04em] text-gray-500">
              Title
            </label>
            <input
              value={taskComposer.title}
              onChange={(event) => {
                const value = event.target.value;
                setTaskComposer((prev) => (prev ? { ...prev, title: value } : prev));
              }}
              placeholder="What do you want to do?"
              className="h-8 w-full border border-gray-300 px-2.5 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-gray-500 selection:bg-[rgba(17,24,39,0.16)] selection:text-[#111827]"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-0.5">
              <label className="text-xs uppercase tracking-[0.04em] text-gray-500">
                Start
              </label>
              <input
                type="time"
                step={900}
                value={formatMinutesInput(taskComposer.startMinutes)}
                onChange={(event) => {
                  const nextMinutes = parseMinutes(event.target.value);
                  if (nextMinutes === null) return;

                  setTaskComposer((prev) => {
                    if (!prev) return prev;
                    const nextEnd = Math.max(prev.endMinutes, nextMinutes + 30);
                    return {
                      ...prev,
                      startMinutes: nextMinutes,
                      endMinutes: Math.min(nextEnd, 24 * 60),
                    };
                  });
                }}
                className="minimal-time-input h-8 w-full border border-gray-300 px-2 text-sm text-gray-900 outline-none focus:border-gray-500 selection:bg-[rgba(17,24,39,0.16)] selection:text-[#111827]"
              />
            </div>
            <div className="space-y-0.5">
              <label className="text-xs uppercase tracking-[0.04em] text-gray-500">
                End
              </label>
              <input
                type="time"
                step={900}
                value={formatMinutesInput(taskComposer.endMinutes)}
                onChange={(event) => {
                  const nextMinutes = parseMinutes(event.target.value);
                  if (nextMinutes === null) return;

                  setTaskComposer((prev) => {
                    if (!prev) return prev;
                    return {
                      ...prev,
                      endMinutes: Math.max(nextMinutes, prev.startMinutes + 30),
                    };
                  });
                }}
                className="minimal-time-input h-8 w-full border border-gray-300 px-2 text-sm text-gray-900 outline-none focus:border-gray-500 selection:bg-[rgba(17,24,39,0.16)] selection:text-[#111827]"
              />
            </div>
          </div>

          <div className="space-y-0.5">
            <label className="text-xs uppercase tracking-[0.04em] text-gray-500">
              Notes
            </label>
            <textarea
              value={taskComposer.notes}
              onChange={(event) => {
                const value = event.target.value;
                setTaskComposer((prev) => (prev ? { ...prev, notes: value } : prev));
              }}
              rows={2}
              placeholder="Optional details..."
              className="w-full resize-none border border-gray-300 px-2.5 py-2 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-gray-500 selection:bg-[rgba(17,24,39,0.16)] selection:text-[#111827]"
            />
          </div>

          {taskComposerError && (
            <p className="text-xs text-red-600">{taskComposerError}</p>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-gray-200 px-3 py-2.5">
          {taskComposer.id ? (
            <button
              type="button"
              onClick={deleteTaskComposer}
              disabled={isSavingTaskComposer}
              className="h-8 rounded-sm border border-gray-300 px-3 text-sm text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Delete
            </button>
          ) : (
            <span />
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={closeTaskComposer}
              disabled={isSavingTaskComposer}
              className="h-8 rounded-sm border border-gray-300 px-3 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={saveTaskComposer}
              disabled={isSavingTaskComposer}
              className="h-8 border border-black bg-black px-3 text-sm text-white rounded-sm disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSavingTaskComposer
                ? 'Saving...'
                : taskComposer.id
                  ? 'Update block'
                  : 'Save block'}
            </button>
          </div>
        </div>
      </div>
    </div>
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
              onScheduledItemClick={handleScheduledItemClick}
              onDayBlockEditorOpen={openMonthDayBlockEditor}
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

          {/* Hover panel - like Lumen (shows below calendar on left) */}
          {hoveredDate && !selectedDate && !validRange && (
            <div className="mt-4">
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
            <div ref={selectedDayPanelRef} className="mt-4 flex items-start gap-3">
              {/* Metrics tooltip — left side */}
              <div
                className="border border-gray-300 dark:border-gray-700 bg-background p-5 w-[340px] shrink-0"
              >
                <div className="flex items-center justify-between mb-1">
                  <p className="font-medium text-foreground font-mono text-lg">
                    {format(parseISO(selectedDate), 'EEE, MMM d')}
                  </p>
                  <button
                    onClick={() => setSelectedDate(null)}
                    aria-label="Close tooltip"
                    className="rounded-sm text-lg leading-none text-[#878787] transition-colors hover:text-foreground"
                  >
                    ×
                  </button>
                </div>
                <p className="text-sm text-[#878787]">
                  {(() => {
                    const date = parseISO(selectedDate);
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
                  const dayMetrics = aggregateTooltipMetrics(dayLogs);

                  if (dayMetrics.length === 0) {
                    return (
                      <p className="text-sm text-[#878787] mt-4 font-mono">
                        Empty note
                      </p>
                    );
                  }

                  return (
                    <div className="mt-4 space-y-2 max-h-64 overflow-y-auto">
                      {dayMetrics.map((metric) => (
                        <div
                          key={metric.key}
                          className="flex items-center justify-between text-sm transition-colors duration-150 hover:text-[#27251E] cursor-default group"
                        >
                          <span className="font-medium">{formatTooltipMetricName(metric)}</span>
                          <span className="text-[#878787] group-hover:text-[#27251E] transition-colors duration-150">
                            {formatTooltipMetricValue(metric)}
                          </span>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>

              {/* Daily Summary panel — right side, fills remaining space */}
              <div className="relative border border-gray-300 dark:border-gray-700 bg-white p-5 flex-1 max-h-[320px] overflow-y-auto">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[11px] font-medium uppercase tracking-[0.05em] text-[rgba(39,37,30,0.35)]">
                    Daily Summary
                  </p>
                  <button
                    onClick={() => setSelectedDate(null)}
                    aria-label="Close summary"
                    className="rounded-sm text-lg leading-none text-[#878787] transition-colors hover:text-foreground"
                  >
                    ×
                  </button>
                </div>
                {selectedProjectSessions.length > 0 && (
                  <div className="mb-4 space-y-2 border-b border-[rgba(39,37,30,0.10)] pb-4">
                    <p className="text-[11px] font-medium uppercase tracking-[0.05em] text-[rgba(39,37,30,0.35)]">
                      Workstreams
                    </p>
                    {selectedProjectSessions.slice(0, 6).map((session) => {
                      const started = session.start_ts ? new Date(session.start_ts) : null;
                      const ended = session.end_ts ? new Date(session.end_ts) : null;
                      const timeRange = started && ended && !Number.isNaN(started.getTime()) && !Number.isNaN(ended.getTime())
                        ? `${started.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} - ${ended.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
                        : 'Unknown time';
                      const apps = Array.isArray(session.apps)
                        ? session.apps.slice(0, 2).map((item) => item.name).filter(Boolean).join(', ')
                        : '';
                      return (
                        <div key={session.session_uid} className="text-[12px] leading-5">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="font-medium text-[#27251E]">
                                {session.project_name || 'Unclassified'} / {session.task_name || 'General'}
                              </p>
                              <p className="text-[#878787]">{timeRange}{apps ? ` · ${apps}` : ''}</p>
                            </div>
                            <span className="shrink-0 text-[#878787]">
                              {formatDurationDisplay(Math.round(Number(session.active_ms || 0) / 1000))}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                {aiSummaryLoading ? (
                  <p className="text-[13px] text-[rgba(39,37,30,0.35)] animate-pulse">
                    {aiSummary || 'Thinking...'}
                  </p>
                ) : aiSummary ? (
                  <div className="text-[13px] leading-[1.6] tracking-[-0.1px] text-[#27251E] space-y-2">
                    {aiSummary.split('\n').filter(Boolean).map((line, i) => {
                      // Parse inline markdown: **bold**, *italic*, `code`
                      const parseInline = (text: string) => {
                        const tokens = text.split(/(\*\*.*?\*\*|\*.*?\*|`[^`]+`)/g);
                        return tokens.map((tok, j) => {
                          if (tok.startsWith('**') && tok.endsWith('**')) {
                            return <strong key={j} className="font-semibold text-[#27251E]">{tok.slice(2, -2)}</strong>;
                          }
                          if (tok.startsWith('*') && tok.endsWith('*') && !tok.startsWith('**')) {
                            return <em key={j} className="text-[11px] not-italic text-[#878787] tracking-wide block -mt-1 mb-0.5">{tok.slice(1, -1)}</em>;
                          }
                          if (tok.startsWith('`') && tok.endsWith('`')) {
                            return <code key={j} className="px-1 py-0.5 rounded bg-[#f0ede8] text-[#535353] font-mono text-[12px]">{tok.slice(1, -1)}</code>;
                          }
                          return <span key={j}>{tok}</span>;
                        });
                      };
                      return <p key={i}>{parseInline(line)}</p>;
                    })}
                  </div>
                ) : null}
              </div>
            </div>
          )}

          {/* Range selection panel */}
          {validRange && (
            <div className="mt-4">
              <div className="border border-gray-300 dark:border-gray-700 bg-background p-5 w-[340px] min-h-[180px]">
                <div className="flex items-center justify-between mb-1">
                  <p className="font-medium text-foreground font-mono text-lg">
                    {format(new Date(validRange[0]), 'MMM d')} - {format(new Date(validRange[1]), 'MMM d')}
                  </p>
                  <button
                    onClick={() => setRange(null)}
                    className="rounded-sm text-xs text-[#878787] transition-colors hover:text-foreground"
                  >
                    Clear
                  </button>
                </div>
                <p className="text-sm text-[#878787]">
                  {format(new Date(validRange[0]), 'yyyy')}
                </p>

                {(() => {
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
      ) : (
        <div className="min-h-0 flex-1 px-6 pb-6">
          <div className="relative h-full">
            <CalendarWeekView
              weekDays={weekDays}
              currentDate={currentDate}
              scheduledItems={scheduledBlocks}
              onCreateSelection={openTaskComposer}
              onItemClick={handleScheduledItemClick}
              onItemUpdate={handleScheduledItemUpdate}
            />
            {taskComposerModal}
          </div>
        </div>
      )}
    </div>
  );
}
