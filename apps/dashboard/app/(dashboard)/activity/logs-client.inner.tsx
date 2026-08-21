'use client';

import React, { startTransition, useState, useEffect, useMemo, useCallback } from 'react';
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { apiFetchWithAuth, apiOperationWithAuth } from '@/lib/api/client';
import { useSearchParams, useRouter } from 'next/navigation';
import { HabitLogsDataTable } from '@/components/tables/habit-logs/data-table';
import { LogDetailPanel } from '@/components/tables/habit-logs/log-detail-panel';
import { HabitLogsSearchFilter } from '@/components/habit-logs-search-filter';
import { HabitLogsActions } from '@/components/habit-logs-actions';
import { resolveEntity } from '@/lib/entities/resolve';
import type {
  BuiltInFilterPresetId,
  FilterState,
  HabitLog,
  SavedFilterView,
  TableDensity,
} from '@/components/habit-logs/types';
import {
  BUILT_IN_PRESETS,
  LOGS_PAGE_SIZE,
  buildDateTimeForUpdatedDate,
  cloneFilters,
  defaultFilters,
  getFiltersForPreset,
  parseLogsSearchParams,
  readDensityFromStorage,
  readSavedViewsFromStorage,
  toLocalDateString,
} from './logs-client.helpers';
import { LogsSelectionBar } from './logs-client.selection-bar';

type LogsClientInnerProps = {
  userId: string | null;
  getToken: () => Promise<string | null>;
};

export function LogsClientInner({ userId, getToken }: LogsClientInnerProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
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
    const parsed = parseLogsSearchParams(searchParams);
    if (!parsed.hasPaletteParams) return;

    startTransition(() => {
      setFilters(parsed.filters);
      if (parsed.sortColumn) {
        setSortColumn(parsed.sortColumn);
      }
      if (parsed.sortDirection) {
        setSortDirection(parsed.sortDirection);
      }
    });
  }, [searchParams]);

  // Fetch habits for filter dropdown
  const { data: habitsData } = useQuery({
    queryKey: ['habits', userId],
    queryFn: async () => {
      return await apiOperationWithAuth(
        'get_habits_api_habits_get',
        getToken,
        {},
        userId,
      );
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
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 20000);
      const abortFromQuery = () => controller.abort();
      signal?.addEventListener('abort', abortFromQuery, { once: true });

      try {
        const payload = await apiOperationWithAuth(
          'get_logs_read_model_api_logs_read_model_get',
          getToken,
          {
            query: {
              q: filters.q || undefined,
              start_date: filters.start || undefined,
              end_date: filters.end || undefined,
              categories: filters.categories?.length ? filters.categories.join(',') : undefined,
              habits: filters.habits?.length ? filters.habits.join(',') : undefined,
              statuses: filters.statuses?.length ? filters.statuses.join(',') : undefined,
              sources: filters.sources?.length ? filters.sources.join(',') : undefined,
              sort: sortColumn || undefined,
              order: sortColumn ? sortDirection : undefined,
              limit: LOGS_PAGE_SIZE,
              offset: Number(pageParam) || 0,
            },
            signal: controller.signal,
          },
          userId,
        ) as {
          rows?: HabitLog[];
          meta?: {
            totals?: { count?: number; totalDuration?: number; totalAmount?: number };
          };
          pagination?: { hasMore?: boolean; total?: number };
          sourceCounts?: Record<string, unknown>;
        };
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

  const setLogQuery = useCallback((logId: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (logId) params.set('logId', logId);
    else params.delete('logId');
    const query = params.toString();
    router.replace(query ? `/activity?${query}` : '/activity', { scroll: false });
  }, [router, searchParams]);

  const openLogDetail = useCallback((log: HabitLog) => {
    setDetailLog(log);
    setLogQuery(log.id);
  }, [setLogQuery]);

  useEffect(() => {
    const logId = searchParams.get('logId');
    if (!logId) return;
    const loaded = logsData?.data || [];
    const found = loaded.find((item) => item.id === logId);
    if (found) {
      setDetailLog((current) => (current?.id === found.id ? current : found));
      return;
    }
    let cancelled = false;
    void resolveEntity({ type: 'habit_log', id: logId }, { userId, getToken }).then((summary) => {
      if (cancelled || searchParams.get('logId') !== logId) return;
      setDetailLog({
        id: logId,
        habit_name: summary.availability === 'ok' ? summary.title : 'Unavailable log',
        category: summary.subtitle || '',
        date: summary.subtitle || toLocalDateString(new Date()),
        status: (summary.status as HabitLog['status']) || 'completed',
      });
    });
    return () => {
      cancelled = true;
    };
  }, [getToken, logsData, searchParams, userId]);

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (logs: Array<{ id: string; habit_id: string }>) => {
      await Promise.all(
        logs.map((log) =>
          apiOperationWithAuth(
            'delete_habit_log_api_habits__habit_id__logs__log_id__delete',
            getToken,
            { pathParams: { habit_id: log.habit_id, log_id: log.id } },
            userId,
          ),
        ),
      );
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
      const payload: Record<string, string> = {};
      if (updates.status) payload.status = updates.status;
      if (updates.date) payload.date = updates.date;
      if (updates.completed_at) payload.completed_at = updates.completed_at;
      if (updates.integration_source) payload.integration_source = updates.integration_source;

      const response = await apiFetchWithAuth(
        `/api/habits/${log.habit_id}/logs/${log.id}`,
        getToken,
        {
          method: 'PUT',
          body: JSON.stringify(payload),
        },
      );

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
  const logsMeta = (logsData?.meta || {}) as {
    totals?: {
      count?: number;
      totalDuration?: number;
      totalAmount?: number;
      completedCount?: number;
      completionRate?: number;
    };
    hasMore?: boolean;
    total?: number;
    sourceCounts?: Record<string, unknown>;
  };
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
    if (!deletableSelectedLogs.length || deleteMutation.isPending) return;
    deleteMutation.mutate(
      deletableSelectedLogs.flatMap((log) => (
        log.habit_id ? [{ id: log.id, habit_id: log.habit_id }] : []
      )),
    );
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
            onRowClick={openLogDetail}
            onLoadMore={() => fetchNextPage()}
            hasMore={hasNextPage}
            isFetchingMore={isFetchingNextPage}
          />
        )}
      </div>

      <LogDetailPanel
        log={detailLog}
        open={detailLog !== null}
        onClose={() => {
          setDetailLog(null);
          setLogQuery(null);
        }}
        onQuickEdit={handleQuickEdit}
        isUpdating={detailLog ? Boolean(updatingLogIds[detailLog.id]) : false}
        availableSources={sourceOptions}
      />

      <LogsSelectionBar
        selectedCount={selectedCount}
        selectedLogs={selectedLogs}
        deletableSelectedLogs={deletableSelectedLogs}
        deletePending={deleteMutation.isPending}
        onDeselect={() => setRowSelection({})}
        onExport={exportLogsToCsv}
        onDelete={handleDeleteSelected}
      />
    </div>
  );
}
