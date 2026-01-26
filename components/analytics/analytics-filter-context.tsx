/**
 * AnalyticsFilterContext
 * Shared state for filters across Overview and Metrics views
 * Ensures filters persist when toggling between views
 */

'use client';

import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { DateRange } from 'react-day-picker';
import { startOfDay, endOfDay, subDays } from 'date-fns';
import { ViewMode } from './view-mode-toggle';

// Default to "Last 14 days" for better comparison (last 7 vs previous 7)
const getDefaultDateRange = (): DateRange => ({
  from: startOfDay(subDays(new Date(), 13)),
  to: endOfDay(new Date())
});

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
  
  // Date range state - default to "Last 14 days"
  const [dateRange, setDateRange] = useState<DateRange | undefined>(getDefaultDateRange());
  
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
