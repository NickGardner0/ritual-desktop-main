'use client';

import React, { startTransition, useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth, useUser } from '@clerk/nextjs';
import { useQuery, useMutation, keepPreviousData } from '@tanstack/react-query';
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
import { HabitLogsSearchFilter } from '@/components/habit-logs-search-filter';
import { HabitLogsActions } from '@/components/habit-logs-actions';
import { BrailleSpinner } from '@/components/ui/braille-spinner';

export type HabitLog = {
  id: string;
  habit_id: string;
  habit_name: string;
  category: string;
  icon?: string;
  date: string;
  completed_at?: string;
  duration?: number;
  amount?: number;
  unit_type?: string;
  status: 'completed' | 'skipped' | 'missed';
  notes?: string;
  integration_source?: string;
  metadata?: Record<string, any>;
};

export type FilterState = {
  q: string | null;
  start: string | null;
  end: string | null;
  categories: string[] | null;
  habits: string[] | null;
  statuses: string[] | null;
  sources: string[] | null;
};

export type TableDensity = 'comfortable' | 'compact';

export type SavedFilterView = {
  id: string;
  name: string;
  filters: FilterState;
  sortColumn: string | null;
  sortDirection: 'asc' | 'desc';
  createdAt: string;
};

export type BuiltInFilterPresetId = 'all' | 'today' | 'last7' | 'completed' | 'manual';

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
  const [sortColumn, setSortColumn] = useState<string | null>('date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>({
    select: true,
    date: true,
    time: false,
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
  const [currentPage, setCurrentPage] = useState(0);
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
      const token = await getToken();
      const backendUrl = process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';
      const res = await fetch(`${backendUrl}/api/habits`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to fetch habits');
      return res.json();
    },
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  });

  // Build query params from filters
  const queryParams = useMemo(() => {
    const params = new URLSearchParams();

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
    params.set('limit', String(LOGS_PAGE_SIZE));
    params.set('offset', String(currentPage * LOGS_PAGE_SIZE));

    return params.toString();
  }, [currentPage, filters, sortColumn, sortDirection]);

  // Fetch habit logs with filters
  const { data: logsData, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['habit-logs', userId, queryParams],
    queryFn: async () => {
      const res = await fetch(`/api/analytics/habits/logs/all?${queryParams}`);
      if (!res.ok) throw new Error('Failed to fetch logs');
      return res.json();
    },
    enabled: !!userId,
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  });

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
  const totalFilteredLogs = Number(logsMeta.totalFiltered || scopedLogs.length || 0);
  const pageLimit = Number(logsMeta.limit || LOGS_PAGE_SIZE);
  const hasMoreLogs = Boolean(logsMeta.hasMore);
  const totalPages = Math.max(1, Math.ceil(totalFilteredLogs / Math.max(pageLimit, 1)));

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
      srcs.add(log.integration_source || 'manual');
    });
    return Array.from(srcs).sort((a, b) => a.localeCompare(b));
  }, [scopedLogs]);

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
    setCurrentPage(0);
    setFilters((prev) => ({ ...prev, ...newFilters }));
  }, []);

  // Handle sort changes
  const handleSort = useCallback((column: string) => {
    setActiveViewId(null);
    setCurrentPage(0);

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
    setCurrentPage(0);
    setFilters(cloneFilters(nextFilters));
    setSortColumn('date');
    setSortDirection('desc');
    setActiveViewId(`preset:${presetId}`);
  }, []);

  const applySavedView = useCallback((viewId: string) => {
    const view = savedViews.find((candidate) => candidate.id === viewId);
    if (!view) return;

    setCurrentPage(0);
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
  const totals = useMemo(() => {
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
  }, [hasScopedFilters, logsMeta?.totals, scopedLogs]);

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
    const ids = Object.keys(sanitizedRowSelection);
    if (!ids.length || deleteMutation.isPending) return;
    deleteMutation.mutate(ids);
  }, [sanitizedRowSelection, deleteMutation]);

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

      <div className="flex-1 overflow-hidden px-6">
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
          isLoading={isLoading || isFetching}
          availableSources={sources}
          onQuickEdit={handleQuickEdit}
          updatingLogIds={updatingLogIds}
          density={density}
        />
      </div>

      {totalFilteredLogs > pageLimit && (
        <div className="flex items-center justify-between px-6 py-4 text-sm text-neutral-600">
          <div>
            Showing {currentPage * pageLimit + 1}-{Math.min((currentPage * pageLimit) + scopedLogs.length, totalFilteredLogs)} of {totalFilteredLogs}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCurrentPage((page) => Math.max(0, page - 1))}
              disabled={currentPage === 0 || isFetching}
              className="h-8 rounded-sm border border-black/10 px-3 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
            >
              Previous
            </button>
            <div className="min-w-[88px] text-center">
              Page {currentPage + 1} of {totalPages}
            </div>
            <button
              type="button"
              onClick={() => setCurrentPage((page) => (hasMoreLogs ? page + 1 : page))}
              disabled={!hasMoreLogs || isFetching}
              className="h-8 rounded-sm border border-black/10 px-3 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}

      <AnimatePresence>
        {selectedCount > 0 && (
          <motion.div
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50"
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            <div className="border border-gray-300 bg-white shadow-lg h-12 px-3 flex items-center gap-2">
              <span className="text-sm text-gray-900 min-w-[98px]">
                {selectedCount} selected
              </span>

              <button
                type="button"
                onClick={() => setRowSelection({})}
                className="h-8 px-2 border border-gray-300 text-sm text-gray-700 hover:bg-[#F5F5F5]"
              >
                Deselect
              </button>

              <button
                type="button"
                onClick={() => exportLogsToCsv(selectedLogs)}
                className="h-8 px-2 border border-gray-300 text-sm text-gray-700 hover:bg-[#F5F5F5] inline-flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                Export
              </button>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button
                    type="button"
                    className="h-8 px-2 border border-red-200 text-sm text-red-700 hover:bg-red-50 inline-flex items-center gap-1.5"
                    disabled={deleteMutation.isPending}
                  >
                    {deleteMutation.isPending ? (
                      <BrailleSpinner className="text-sm text-red-700" />
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
                      This will permanently delete {selectedCount} selected log{selectedCount === 1 ? '' : 's'}.
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
