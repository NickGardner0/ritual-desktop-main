/**
 * AnalyticsFilterContext
 * Shared state for filters across Overview and Metrics views
 * Ensures filters persist when toggling between views
 */

'use client';

import React, { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
import { endOfDay, startOfDay, subDays } from 'date-fns';
import { DateRange } from 'react-day-picker';
import { ViewMode } from './view-mode-toggle';

const DATE_RANGE_STORAGE_KEY = 'ritual:analytics-date-range:v1';

export function getLast14DaysRange(now = new Date()): DateRange {
  return {
    from: startOfDay(subDays(now, 13)),
    to: endOfDay(now),
  };
}

function readPersistedDateRange(): DateRange | undefined {
  if (typeof window === 'undefined') return getLast14DaysRange();

  try {
    const raw = window.localStorage.getItem(DATE_RANGE_STORAGE_KEY);
    if (!raw) return getLast14DaysRange();

    const parsed = JSON.parse(raw) as { allTime?: boolean; from?: string; to?: string };
    if (parsed?.allTime) return undefined;
    if (parsed?.from) {
      const from = new Date(parsed.from);
      const to = parsed.to ? new Date(parsed.to) : from;
      if (!Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime())) {
        return { from, to };
      }
    }
    return getLast14DaysRange();
  } catch {
    return getLast14DaysRange();
  }
}

function persistDateRange(range: DateRange | undefined): void {
  if (typeof window === 'undefined') return;
  try {
    if (!range?.from) {
      window.localStorage.setItem(DATE_RANGE_STORAGE_KEY, JSON.stringify({ allTime: true }));
      return;
    }
    window.localStorage.setItem(DATE_RANGE_STORAGE_KEY, JSON.stringify({
      from: range.from.toISOString(),
      to: (range.to ?? range.from).toISOString(),
    }));
  } catch {
    // Ignore quota / private-mode write failures.
  }
}

function isDesktopSpaWindow(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as Window & {
    __TAURI_INTERNALS__?: unknown;
    __RITUAL_API_ORIGIN__?: string;
  };
  return Boolean(w.__TAURI_INTERNALS__ || w.__RITUAL_API_ORIGIN__);
}

function getInitialDateRange(): DateRange | undefined {
  if (isDesktopSpaWindow()) return readPersistedDateRange();
  return getLast14DaysRange();
}

interface AnalyticsFilterState {
  // View mode (Overview | Metrics)
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  
  // Date range filter
  dateRange: DateRange | undefined;
  setDateRange: (range: DateRange | undefined) => void;
  
  // Selected habits filter
  selectedHabits: string[];
  setSelectedHabits: (habits: string[] | ((prev: string[]) => string[])) => void;
  toggleHabit: (habitId: string) => void;
  selectAllHabits: (habitIds: string[]) => void;
  clearHabitSelection: () => void;
}

const AnalyticsFilterContext = createContext<AnalyticsFilterState | null>(null);

interface AnalyticsFilterProviderProps {
  children: React.ReactNode;
  initialViewMode?: ViewMode;
}

export const AnalyticsFilterProvider: React.FC<AnalyticsFilterProviderProps> = ({
  children,
  initialViewMode = 'overview',
}) => {
  // View mode state
  const [viewMode, setViewMode] = useState<ViewMode>(initialViewMode);
  
  const [dateRange, setDateRangeState] = useState<DateRange | undefined>(getInitialDateRange);
  const setDateRange = useCallback((range: DateRange | undefined) => {
    persistDateRange(range);
    setDateRangeState(range);
  }, []);

  useEffect(() => {
    if (isDesktopSpaWindow()) return;
    setDateRangeState(readPersistedDateRange());
  }, []);
  
  // Selected habits state
  const [selectedHabits, setSelectedHabits] = useState<string[]>([]);
  
  // Toggle a single habit
  const toggleHabit = useCallback((habitId: string) => {
    setSelectedHabits(prev => 
      prev.includes(habitId)
        ? prev.filter(id => id !== habitId)
        : [...prev, habitId]
    );
  }, []);
  
  // Select all habits
  const selectAllHabits = useCallback((habitIds: string[]) => {
    setSelectedHabits(habitIds.filter(id => !!id));
  }, []);
  
  // Clear all selections
  const clearHabitSelection = useCallback(() => {
    setSelectedHabits([]);
  }, []);
  
  // Memoize context value to prevent unnecessary re-renders
  const value = useMemo(() => ({
    viewMode,
    setViewMode,
    dateRange,
    setDateRange,
    selectedHabits,
    setSelectedHabits,
    toggleHabit,
    selectAllHabits,
    clearHabitSelection,
  }), [
    viewMode,
    dateRange,
    setDateRange,
    selectedHabits,
    toggleHabit,
    selectAllHabits,
    clearHabitSelection,
  ]);
  
  return (
    <AnalyticsFilterContext.Provider value={value}>
      {children}
    </AnalyticsFilterContext.Provider>
  );
};

export const useAnalyticsFilters = (): AnalyticsFilterState => {
  const context = useContext(AnalyticsFilterContext);
  if (!context) {
    throw new Error('useAnalyticsFilters must be used within an AnalyticsFilterProvider');
  }
  return context;
};

// Optional hook for components that may be used outside the provider
export const useAnalyticsFiltersOptional = (): AnalyticsFilterState | null => {
  return useContext(AnalyticsFilterContext);
};
