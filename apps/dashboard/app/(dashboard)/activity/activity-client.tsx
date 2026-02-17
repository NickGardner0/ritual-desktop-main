'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth, useUser } from '@clerk/nextjs';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { format, parseISO, subDays } from 'date-fns';
import { HabitLogsDataTable } from '@/components/tables/habit-logs/data-table';
import { HabitLogsSearchFilter } from '@/components/habit-logs-search-filter';
import { HabitLogsActions } from '@/components/habit-logs-actions';
import { ActivityLoading } from './loading';

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

const defaultFilters: FilterState = {
  q: null,
  start: null,
  end: null,
  categories: null,
  habits: null,
  statuses: null,
  sources: null,
};

export function ActivityClient() {
  const { getToken } = useAuth();
  const { user } = useUser();
  const queryClient = useQueryClient();

  const [filters, setFilters] = useState<FilterState>(defaultFilters);
  const [sortColumn, setSortColumn] = useState<string | null>('date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>({
    select: true,
    date: true,
    time: true,
    habit: true,
    value: true,
    category: true,
    status: true,
    source: true,
    notes: false,
    actions: true,
  });

  // Fetch habits for filter dropdown
  const { data: habitsData } = useQuery({
    queryKey: ['habits', user?.id],
    queryFn: async () => {
      const token = await getToken();
      const backendUrl = process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';
      const res = await fetch(`${backendUrl}/api/habits`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to fetch habits');
      return res.json();
    },
    enabled: !!user?.id,
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
    
    return params.toString();
  }, [filters, sortColumn, sortDirection]);

  // Fetch habit logs with filters
  // Using keepPreviousData to prevent skeleton flash during search/filter changes
  const { data: logsData, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['habit-logs', user?.id, queryParams],
    queryFn: async () => {
      const res = await fetch(`/api/analytics/habits/logs/all?${queryParams}`);
      if (!res.ok) throw new Error('Failed to fetch logs');
      return res.json();
    },
    enabled: !!user?.id,
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
          'Authorization': `Bearer ${token}`,
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

  const habits = habitsData || [];

  // Deduplicate logs by ID (Tinybird can return duplicates)
  const logs: HabitLog[] = useMemo(() => {
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
    logs.forEach((log) => {
      srcs.add(log.integration_source || 'manual');
    });
    return Array.from(srcs);
  }, [logs]);

  // Check if any filters are active
  const hasFilters = useMemo(() => {
    return Object.entries(filters).some(([key, value]) => {
      if (key === 'q') return value !== null && value !== '';
      if (Array.isArray(value)) return value.length > 0;
      return value !== null;
    });
  }, [filters]);

  // Handle filter changes
  const handleFilterChange = useCallback((newFilters: Partial<FilterState>) => {
    setFilters(prev => ({ ...prev, ...newFilters }));
  }, []);

  // Handle sort changes
  const handleSort = useCallback((column: string) => {
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

  // Calculate totals for bottom bar
  const totals = useMemo(() => {
    if (!hasFilters || logs.length === 0) return null;

    const totalDuration = logs.reduce((sum, log) => sum + (log.duration || 0), 0);
    const totalAmount = logs.reduce((sum, log) => sum + (log.amount || 0), 0);
    const completedCount = logs.filter(log => log.status === 'completed').length;

    return {
      count: logs.length,
      totalDuration,
      totalAmount,
      completedCount,
      completionRate: logs.length > 0 ? (completedCount / logs.length * 100) : 0,
    };
  }, [logs, hasFilters]);

  // Selected logs for export bar
  const selectedCount = Object.keys(rowSelection).length;
  const selectedLogs = logs.filter(log => rowSelection[log.id]);

  if (isLoading && logs.length === 0) {
    return <ActivityLoading />;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header: Search/Filter + Actions */}
      <div className="flex justify-between items-center py-6 px-8">
        <HabitLogsSearchFilter
          filters={filters}
          onFilterChange={handleFilterChange}
          habits={habits}
          categories={categories}
          sources={sources}
        />
        <HabitLogsActions
          columnVisibility={columnVisibility}
          onColumnVisibilityChange={setColumnVisibility}
        />
      </div>

      {/* Data Table */}
      <div className="flex-1 overflow-hidden px-8">
        <HabitLogsDataTable
          logs={logs}
          rowSelection={rowSelection}
          onRowSelectionChange={setRowSelection}
          columnVisibility={columnVisibility}
          sortColumn={sortColumn}
          sortDirection={sortDirection}
          onSort={handleSort}
          hasFilters={hasFilters}
          totals={totals}
          isLoading={isLoading}
        />
      </div>
    </div>
  );
}

