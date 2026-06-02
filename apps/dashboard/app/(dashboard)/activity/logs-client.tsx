'use client';

import React, { startTransition, useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth, useUser } from '@clerk/nextjs';
import { useQuery, useInfiniteQuery, useMutation } from '@tanstack/react-query';
import { Download, Trash2 } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useSearchParams } from 'next/navigation';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { HabitLogsDataTable } from '@/components/tables/habit-logs/data-table';
import { LogDetailPanel } from '@/components/tables/habit-logs/log-detail-panel';
import { HabitLogsSearchFilter } from '@/components/habit-logs-search-filter';
import { HabitLogsActions } from '@/components/habit-logs-actions';
import { BrailleSpinner } from '@/components/ui/braille-spinner';
import type {
  BuiltInFilterPresetId,
  FilterState,
  HabitLog,
  SavedFilterView,
  TableDensity,
} from '@/components/habit-logs/types';
export type {
  BuiltInFilterPresetId,
  FilterState,
  HabitLog,
  SavedFilterView,
  TableDensity,
} from '@/components/habit-logs/types';

const defaultFilters: FilterState = {
  q: null,
  start: null,
  end: null,
  categories: null,
  habits: null,
  statuses: null,
  sources: null,
};

const BUILT_IN_PRESETS: Array<{ id: BuiltInFilterPresetId; label: string }> = [
  { id: 'all', label: 'All logs' },
  { id: 'today', label: 'Today' },
  { id: 'last7', label: 'Last 7 days' },
  { id: 'completed', label: 'Completed' },
  { id: 'manual', label: 'Manual source' },
];
const LOGS_PAGE_SIZE = 200;

function toLocalDateString(date: Date): string {
  return date.toLocaleDateString('en-CA');
}

function cloneFilters(filters: FilterState): FilterState {
  return {
    q: filters.q ?? null,
    start: filters.start ?? null,
    end: filters.end ?? null,
    categories: filters.categories ? [...filters.categories] : null,
    habits: filters.habits ? [...filters.habits] : null,
    statuses: filters.statuses ? [...filters.statuses] : null,
    sources: filters.sources ? [...filters.sources] : null,
  };
}

function parseListParam(value: string | null): string[] | null {
  if (!value) return null;
  const items = value.split(',').map((item) => item.trim()).filter(Boolean);
  return items.length > 0 ? items : null;
}

function buildDateTimeForUpdatedDate(nextDate: string, completedAt?: string): string {
  const isoTime = completedAt?.match(/T(\d{2}:\d{2}:\d{2})/)?.[1];
  const spacedTime = completedAt?.match(/ (\d{2}:\d{2}:\d{2})/)?.[1];
  const shortTime = completedAt?.match(/(\d{1,2}:\d{2})(?!:\d{2})/)?.[1];

  const time = isoTime || spacedTime || (shortTime ? `${shortTime}:00` : '12:00:00');
  return `${nextDate} ${time}`;
}

function readSavedViewsFromStorage(storageKey: string): SavedFilterView[] {
  if (typeof window === 'undefined') return [];

  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];

    const parsed = JSON.parse(raw) as SavedFilterView[];
    return parsed
      .filter((view) => view && view.id && view.name)
      .map((view) => ({
        ...view,
        filters: cloneFilters(view.filters),
      }));
  } catch {
    return [];
  }
}

function readDensityFromStorage(storageKey: string): TableDensity {
  if (typeof window === 'undefined') return 'comfortable';
  const storedDensity = localStorage.getItem(storageKey);
  return storedDensity === 'compact' || storedDensity === 'comfortable'
    ? storedDensity
    : 'comfortable';
}

function getFiltersForPreset(presetId: BuiltInFilterPresetId): FilterState {
  const now = new Date();

  switch (presetId) {
    case 'today': {
      const today = toLocalDateString(now);
      return {
        ...defaultFilters,
        start: today,
        end: today,
      };
    }
    case 'last7': {
      const start = new Date(now);
      start.setDate(start.getDate() - 7);
      return {
        ...defaultFilters,
        start: toLocalDateString(start),
        end: toLocalDateString(now),
      };
    }
    case 'completed':
      return {
        ...defaultFilters,
        statuses: ['completed'],
      };
    case 'manual':
      return {
        ...defaultFilters,
        sources: ['manual'],
      };
    case 'all':
    default:
      return cloneFilters(defaultFilters);
  }
}

type LogsClientInnerProps = {
  userId: string | null;
  getToken: () => Promise<string | null>;
};

export function LogsClient() {
  const { getToken } = useAuth();
  const { user } = useUser();

  return (
    <LogsClientInner
      key={user?.id ?? 'anonymous'}
      userId={user?.id ?? null}
      getToken={getToken}
    />
  );
}

function LogsClientInner({ userId, getToken }: LogsClientInnerProps) {
  const searchParams = useSearchParams();
  const savedViewsStorageKey = `ritual-logs-saved-views-${userId ?? 'anonymous'}`;
  const densityStorageKey = `ritual-logs-density-${userId ?? 'anonymous'}`;

  const [filters, setFilters] = useState<FilterState>(defaultFilters);
  const [sortColumn, setSortColumn] = useState<string | null>('time');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>({
    select: true,
    date: true,
    time: true,
    habit: true,
    value: true,
    category: true,
    source: true,
    notes: false,
    actions: true,
  });
  const [density, setDensity] = useState<TableDensity>(() => readDensityFromStorage(densityStorageKey));
  const [savedViews, setSavedViews] = useState<SavedFilterView[]>(() => readSavedViewsFromStorage(savedViewsStorageKey));
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [detailLog, setDetailLog] = useState<HabitLog | null>(null);
  const [localEdits, setLocalEdits] = useState<Record<string, Partial<HabitLog>>>({});
  const [updatingLogIds, setUpdatingLogIds] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const hasPaletteParams = [
      'q',
      'date',
      'start_date',
      'end_date',
      'categories',
      'habits',
      'statuses',
      'sources',
      'sort',
      'order',
    ].some((key) => searchParams.has(key));

    if (!hasPaletteParams) return;

    const exactDate = searchParams.get('date');
    const startDate = searchParams.get('start_date') || exactDate;
    const endDate = searchParams.get('end_date') || exactDate;

    const nextFilters: FilterState = {
      q: searchParams.get('q') || null,
      start: startDate || null,
      end: endDate || null,
      categories: parseListParam(searchParams.get('categories')),
      habits: parseListParam(searchParams.get('habits')),
      statuses: parseListParam(searchParams.get('statuses')),
      sources: parseListParam(searchParams.get('sources')),
    };
    const nextSortColumn = searchParams.get('sort');
    const nextSortDirection = searchParams.get('order');

    startTransition(() => {
      setFilters(nextFilters);
      if (nextSortColumn) {
        setSortColumn(nextSortColumn);
      }
      if (nextSortDirection === 'asc' || nextSortDirection === 'desc') {
        setSortDirection(nextSortDirection);
      }
    });
  }, [searchParams]);

  // Fetch habits for filter dropdown
  const { data: habitsData } = useQuery({
    queryKey: ['habits', userId],
    queryFn: async () => {
      const res = await fetch('/api/habits', {
        cache: 'no-store',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch habits');
      return res.json();
    },
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  });

  // Build base query params from filters (no offset — managed by infinite query)
  const filterParamsKey = useMemo(() => {
    const params = new URLSearchParams();
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    if (filters.q) params.set('q', filters.q);
    if (filters.start) params.set('start_date', filters.start);
    if (filters.end) params.set('end_date', filters.end);
    if (filters.categories?.length) params.set('categories', filters.categories.join(','));
    if (filters.habits?.length) params.set('habits', filters.habits.join(','));
    if (filters.statuses?.length) params.set('statuses', filters.statuses.join(','));
    if (filters.sources?.length) params.set('sources', filters.sources.join(','));
    if (sortColumn) {
      params.set('sort', sortColumn);
      params.set('order', sortDirection);
    }
    if (timezone) {
      params.set('timezone', timezone);
    }

    return params.toString();
  }, [filters, sortColumn, sortDirection]);

  // Fetch habit logs with infinite scroll
  const {
    data: infiniteData,
    isLoading,
    isError,
    error,
    isFetching,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
  } = useInfiniteQuery({
    queryKey: ['habit-logs', userId, filterParamsKey],
    queryFn: async ({ pageParam = 0, signal }) => {
      const params = new URLSearchParams(filterParamsKey);
      params.set('limit', String(LOGS_PAGE_SIZE));
      params.set('offset', String(pageParam));
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 20000);
      const abortFromQuery = () => controller.abort();
      signal?.addEventListener('abort', abortFromQuery, { once: true });

      try {
        const res = await fetch(`/api/logs/read-model?${params.toString()}`, {
          cache: 'no-store',
          signal: controller.signal,
          credentials: 'include',
        });
        if (!res.ok) {
          const message = await res.text().catch(() => '');
          throw new Error(message || 'Failed to fetch logs');
        }
        const payload = await res.json();
        return {
          data: Array.isArray(payload?.rows) ? payload.rows : [],
          meta: {
            ...(payload?.meta || {}),
            ...(payload?.pagination || {}),
            hasMore: Boolean(payload?.pagination?.hasMore),
            total: Number(payload?.pagination?.total || 0),
            sourceCounts: payload?.sourceCounts || {},
          },
          readModel: payload,
        };
      } catch (fetchError) {
        if (controller.signal.aborted && !signal?.aborted) {
          throw new Error('Logs request timed out');
        }
        throw fetchError;
      } finally {
        window.clearTimeout(timeoutId);
        signal?.removeEventListener('abort', abortFromQuery);
      }
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const meta = lastPage?.meta || {};
      if (meta.hasMore) {
        return allPages.length * LOGS_PAGE_SIZE;
      }
      return undefined;
    },
    enabled: !!userId,
    staleTime: 30 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  // Flatten infinite pages into a single data shape for compatibility
  const logsData = useMemo(() => {
    if (!infiniteData?.pages?.length) return null;
    const firstPage = infiniteData.pages[0];
    const allData = infiniteData.pages.flatMap((page) => page?.data || []);
    return {
      data: allData,
      meta: firstPage?.meta || {},
    };
  }, [infiniteData]);

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const token = await getToken();
      const backendUrl = process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';
      const res = await fetch(`${backendUrl}/api/habit-logs/bulk-delete`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw new Error('Failed to delete logs');
      return res.json();
    },
    onSuccess: () => {
      refetch();
      setRowSelection({});
    },
  });

  // Inline quick-edit mutation for status/source/date
  const quickEditMutation = useMutation({
    mutationFn: async ({
      log,
      updates,
    }: {
      log: HabitLog;
      updates: Partial<Pick<HabitLog, 'status' | 'date' | 'completed_at' | 'integration_source'>>;
    }) => {
      const token = await getToken();
      const backendUrl = process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';

      const payload: Record<string, string> = {};
      if (updates.status) payload.status = updates.status;
      if (updates.date) payload.date = updates.date;
      if (updates.completed_at) payload.completed_at = updates.completed_at;
      if (updates.integration_source) payload.integration_source = updates.integration_source;

      const response = await fetch(`${backendUrl}/api/habits/${log.habit_id}/logs/${log.id}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(error || 'Failed to update log');
      }

      try {
        return await response.json();
      } catch {
        return null;
      }
    },
    onMutate: ({ log, updates }) => {
      setUpdatingLogIds((prev) => ({
        ...prev,
        [log.id]: true,
      }));

      setLocalEdits((prev) => ({
        ...prev,
        [log.id]: {
          ...(prev[log.id] || {}),
          ...updates,
        },
      }));
    },
    onError: (_error, variables) => {
      setLocalEdits((prev) => {
        const next = { ...prev };
        delete next[variables.log.id];
        return next;
      });
    },
    onSuccess: () => {
      refetch();
    },
    onSettled: (_data, _error, variables) => {
      setUpdatingLogIds((prev) => {
        const next = { ...prev };
        delete next[variables.log.id];
        return next;
      });

      setLocalEdits((prev) => {
        const next = { ...prev };
        delete next[variables.log.id];
        return next;
      });
    },
  });

  const habits = habitsData || [];

  // Deduplicate logs by ID (Tinybird can return duplicates)
  const baseLogs: HabitLog[] = useMemo(() => {
    const rawLogs = logsData?.data || [];
    const seen = new Set<string>();
    return rawLogs.filter((log: HabitLog) => {
      if (seen.has(log.id)) {
        return false;
      }
      seen.add(log.id);
      return true;
    });
  }, [logsData]);

  const logs: HabitLog[] = useMemo(() => {
    return baseLogs.map((log) => {
      if (!localEdits[log.id]) {
        return log;
      }
      return {
        ...log,
        ...localEdits[log.id],
      };
    });
  }, [baseLogs, localEdits]);

  const scopedLogs = logs;
  const logsMeta = logsData?.meta || {};
  const logsQueryError = isError
    ? (error instanceof Error ? error.message : 'Failed to load logs')
    : null;

  // Extract unique categories from habits
  const categories = useMemo(() => {
    const cats = new Set<string>();
    habits.forEach((h: any) => {
      if (h.category) cats.add(h.category);
    });
    return Array.from(cats);
  }, [habits]);

  // Extract unique sources from logs
  const sources = useMemo(() => {
    const srcs = new Set<string>();
    scopedLogs.forEach((log) => {
      srcs.add((log as any).source || log.integration_source || 'manual');
    });
    return Array.from(srcs).sort((a, b) => a.localeCompare(b));
  }, [scopedLogs]);

  const sourceOptions = useMemo(() => {
    const unique = new Set<string>(['manual', ...sources]);
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [sources]);

  // Check if any filters are active
  const hasFilters = useMemo(() => {
    return Object.entries(filters).some(([key, value]) => {
      if (key === 'q') return value !== null && value !== '';
      if (Array.isArray(value)) return value.length > 0;
      return value !== null;
    });
  }, [filters]);

  const hasScopedFilters = hasFilters;

  useEffect(() => {
    if (!userId) return;
    localStorage.setItem(savedViewsStorageKey, JSON.stringify(savedViews));
  }, [savedViews, savedViewsStorageKey, userId]);

  useEffect(() => {
    if (!userId) return;
    localStorage.setItem(densityStorageKey, density);
  }, [density, densityStorageKey, userId]);

  // Handle filter changes
  const handleFilterChange = useCallback((newFilters: Partial<FilterState>) => {
    setActiveViewId(null);
    setFilters((prev) => ({ ...prev, ...newFilters }));
  }, []);

  // Handle sort changes
  const handleSort = useCallback((column: string) => {
    setActiveViewId(null);

    if (sortColumn === column) {
      if (sortDirection === 'asc') {
        setSortDirection('desc');
      } else if (sortDirection === 'desc') {
        setSortColumn(null);
        setSortDirection('asc');
      }
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  }, [sortColumn, sortDirection]);

  const applyBuiltInPreset = useCallback((presetId: BuiltInFilterPresetId) => {
    const nextFilters = getFiltersForPreset(presetId);
    setFilters(cloneFilters(nextFilters));
    setSortColumn('date');
    setSortDirection('desc');
    setActiveViewId(`preset:${presetId}`);
  }, []);

  const applySavedView = useCallback((viewId: string) => {
    const view = savedViews.find((candidate) => candidate.id === viewId);
    if (!view) return;

    setFilters(cloneFilters(view.filters));
    setSortColumn(view.sortColumn);
    setSortDirection(view.sortDirection);
    setActiveViewId(view.id);
  }, [savedViews]);

  const saveCurrentView = useCallback((name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;

    const snapshotFilters = cloneFilters(filters);

    setSavedViews((prev) => {
      const existing = prev.find((view) => view.name.toLowerCase() === trimmed.toLowerCase());

      if (existing) {
        setActiveViewId(existing.id);
        return prev.map((view) => {
          if (view.id !== existing.id) return view;
          return {
            ...view,
            name: trimmed,
            filters: snapshotFilters,
            sortColumn,
            sortDirection,
          };
        });
      }

      const nextView: SavedFilterView = {
        id: `view-${Date.now()}`,
        name: trimmed,
        filters: snapshotFilters,
        sortColumn,
        sortDirection,
        createdAt: new Date().toISOString(),
      };

      setActiveViewId(nextView.id);
      return [nextView, ...prev].slice(0, 15);
    });
  }, [filters, sortColumn, sortDirection]);

  const deleteSavedView = useCallback((viewId: string) => {
    setSavedViews((prev) => prev.filter((view) => view.id !== viewId));
    setActiveViewId((prev) => (prev === viewId ? null : prev));
  }, []);

  const handleQuickEdit = useCallback((
    log: HabitLog,
    updates: Partial<Pick<HabitLog, 'status' | 'date' | 'integration_source' | 'completed_at'>>,
  ) => {
    if (updatingLogIds[log.id]) return;

    const normalizedUpdates = {
      ...updates,
      ...(updates.date && !updates.completed_at
        ? { completed_at: buildDateTimeForUpdatedDate(updates.date, log.completed_at) }
        : {}),
    };

    quickEditMutation.mutate({
      log,
      updates: normalizedUpdates,
    });
  }, [quickEditMutation, updatingLogIds]);

  const quickSaveCurrentView = useCallback(() => {
    const name = window.prompt('Name this view', 'Saved View');
    if (!name) return;
    saveCurrentView(name);
  }, [saveCurrentView]);

  // Calculate totals for bottom bar
  const totals = (() => {
    if (!hasScopedFilters) return null;
    const metaTotals = logsMeta?.totals;
    if (metaTotals) {
      return {
        count: Number(metaTotals.count || 0),
        totalDuration: Number(metaTotals.totalDuration || 0),
        totalAmount: Number(metaTotals.totalAmount || 0),
        completedCount: Number(metaTotals.completedCount || 0),
        completionRate: Number(metaTotals.completionRate || 0),
      };
    }
    if (scopedLogs.length === 0) return null;

    const totalDuration = scopedLogs.reduce((sum, log) => sum + (log.duration || 0), 0);
    const totalAmount = scopedLogs.reduce((sum, log) => sum + (log.amount || 0), 0);
    const completedCount = scopedLogs.filter((log) => log.status === 'completed').length;

    return {
      count: scopedLogs.length,
      totalDuration,
      totalAmount,
      completedCount,
      completionRate: scopedLogs.length > 0 ? (completedCount / scopedLogs.length) * 100 : 0,
    };
  })();

  // Selected logs for export bar
  const scopedLogIdSet = useMemo(() => new Set(scopedLogs.map((log) => log.id)), [scopedLogs]);
  const sanitizedRowSelection = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(rowSelection).filter(([id, selected]) => selected && scopedLogIdSet.has(id)),
      ),
    [rowSelection, scopedLogIdSet],
  );
  const selectedCount = Object.keys(sanitizedRowSelection).length;
  const selectedLogs = scopedLogs.filter((log) => sanitizedRowSelection[log.id]);
  const deletableSelectedLogs = selectedLogs.filter((log) => log.editable !== false && log.habit_id);

  const exportLogsToCsv = useCallback((logsToExport: HabitLog[]) => {
    if (!logsToExport.length) return;

    const headers = [
      'Date',
      'Time',
      'Habit',
      'Category',
      'Status',
      'Value',
      'Unit',
      'Source',
      'Notes',
    ];

    const toCsvCell = (value: string | number | null | undefined) => {
      const text = value === null || value === undefined ? '' : String(value);
      const escaped = text.replace(/"/g, '""');
      return `"${escaped}"`;
    };

    const rows = logsToExport.map((log) => {
      const value = log.duration && log.duration > 0
        ? (log.duration / 3600).toFixed(2)
        : (log.amount ?? '');

      return [
        log.date,
        log.completed_at || '',
        log.habit_name,
        log.category,
        log.status,
        value,
        log.unit_type || '',
        log.integration_source || 'manual',
        log.notes || '',
      ].map(toCsvCell).join(',');
    });

    const csv = [headers.map(toCsvCell).join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const dateStamp = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `ritual-logs-${dateStamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, []);

  const handleDeleteSelected = useCallback(() => {
    const ids = deletableSelectedLogs.map((log) => log.id);
    if (!ids.length || deleteMutation.isPending) return;
    deleteMutation.mutate(ids);
  }, [deletableSelectedLogs, deleteMutation]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-wrap items-start justify-between gap-4 px-6 py-6">
        <HabitLogsSearchFilter
          filters={filters}
          onFilterChange={handleFilterChange}
          habits={habits}
          categories={categories}
          sources={sources}
          builtInPresets={BUILT_IN_PRESETS}
          savedViews={savedViews}
          activeViewId={activeViewId}
          onApplyPreset={applyBuiltInPreset}
          onApplySavedView={applySavedView}
          onSaveCurrentView={saveCurrentView}
          onDeleteSavedView={deleteSavedView}
        />
        <div className="flex items-center gap-3">
          <div className="hidden md:flex items-center gap-2">
            <HabitLogsActions
              columnVisibility={columnVisibility}
              onColumnVisibilityChange={setColumnVisibility}
              onExportFiltered={() => exportLogsToCsv(scopedLogs)}
              exportDisabled={!scopedLogs.length}
              density={density}
              onDensityChange={setDensity}
              onQuickSaveView={quickSaveCurrentView}
            />
          </div>
        </div>
      </div>

      {totals && (
        <div className="flex flex-wrap items-center gap-2 px-6 pb-4">
          <div className="rounded-full border border-black/10 bg-white px-3 py-1.5 text-xs font-medium text-neutral-600">
            {totals.count} filtered logs
          </div>
          <div className="rounded-full border border-black/10 bg-white px-3 py-1.5 text-xs font-medium text-neutral-600">
            {totals.completedCount} completed ({totals.completionRate.toFixed(0)}%)
          </div>
          <div className="rounded-full border border-black/10 bg-white px-3 py-1.5 text-xs font-medium text-neutral-600">
            {(totals.totalDuration / 3600).toFixed(1)}h total duration
          </div>
          <div className="rounded-full border border-black/10 bg-white px-3 py-1.5 text-xs font-medium text-neutral-600">
            {totals.totalAmount.toFixed(1)} total amount
          </div>
        </div>
      )}

      {logsQueryError ? (
        <div className="px-6 pb-4">
          <div className="flex items-center justify-between gap-3 border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <span>{logsQueryError}</span>
            <button
              type="button"
              onClick={() => void refetch()}
              className="shrink-0 border border-red-300 bg-white px-3 py-1 text-xs font-medium text-red-800 hover:bg-red-100"
            >
              Retry
            </button>
          </div>
        </div>
      ) : null}

      <div className="flex-1 overflow-hidden px-6">
        {logsQueryError && scopedLogs.length === 0 ? (
          <div className="flex h-full items-center justify-center px-4">
            <div className="max-w-md border border-red-200 bg-red-50 px-6 py-5 text-center">
              <div className="mb-2 text-base font-medium text-red-900">Couldn&apos;t load your logs</div>
              <div className="mb-4 text-sm text-red-800">{logsQueryError}</div>
              <button
                type="button"
                onClick={() => void refetch()}
                className="border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-900 hover:bg-red-100"
              >
                Retry
              </button>
            </div>
          </div>
        ) : (
          <HabitLogsDataTable
            logs={scopedLogs}
            rowSelection={sanitizedRowSelection}
            onRowSelectionChange={setRowSelection}
            columnVisibility={columnVisibility}
            sortColumn={sortColumn}
            sortDirection={sortDirection}
            onSort={handleSort}
            hasFilters={hasScopedFilters}
            totals={totals}
            isLoading={isLoading || (isFetching && !isFetchingNextPage)}
            availableSources={sources}
            onQuickEdit={handleQuickEdit}
            updatingLogIds={updatingLogIds}
            density={density}
            onRowClick={setDetailLog}
            onLoadMore={() => fetchNextPage()}
            hasMore={hasNextPage}
            isFetchingMore={isFetchingNextPage}
          />
        )}
      </div>

      <LogDetailPanel
        log={detailLog}
        open={detailLog !== null}
        onClose={() => setDetailLog(null)}
        onQuickEdit={handleQuickEdit}
        isUpdating={detailLog ? Boolean(updatingLogIds[detailLog.id]) : false}
        availableSources={sourceOptions}
      />

      <AnimatePresence>
        {selectedCount > 0 && (
          <motion.div
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50"
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            <div className="border border-black/10 bg-white shadow-[0_8px_30px_-12px_rgba(0,0,0,0.2)] rounded-lg h-11 px-4 flex items-center gap-3">
              <span className="text-[13px] font-medium text-gray-900 tabular-nums">
                {selectedCount} selected
              </span>

              <div className="w-px h-5 bg-gray-200" />

              <button
                type="button"
                onClick={() => setRowSelection({})}
                className="h-7 px-2.5 rounded-md text-[13px] text-gray-600 hover:bg-gray-100 transition-colors"
              >
                Deselect
              </button>

              <button
                type="button"
                onClick={() => exportLogsToCsv(selectedLogs)}
                className="h-7 px-2.5 rounded-md text-[13px] text-gray-600 hover:bg-gray-100 transition-colors inline-flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                Export
              </button>

              <div className="w-px h-5 bg-gray-200" />

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button
                    type="button"
                    className="h-7 px-2.5 rounded-md text-[13px] text-red-600 hover:bg-red-50 transition-colors inline-flex items-center gap-1.5"
                    disabled={deleteMutation.isPending || deletableSelectedLogs.length === 0}
                  >
                    {deleteMutation.isPending ? (
                      <BrailleSpinner className="text-sm text-red-600" />
                    ) : (
                      <Trash2 className="w-3.5 h-3.5" />
                    )}
                    Delete
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent className="rounded-none">
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete selected logs?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently delete {deletableSelectedLogs.length} editable log{deletableSelectedLogs.length === 1 ? '' : 's'}.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel className="rounded-none">Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="rounded-none"
                      onClick={handleDeleteSelected}
                    >
                      Confirm delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
