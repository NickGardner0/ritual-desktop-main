/**
 * OverviewView - Dashboard/Index content extracted for unified Analytics page
 * 
 * Displays habits in a clean list format with totals and stats.
 * Designed to work with shared filter context or standalone.
 */

'use client';

import React, { useState, useEffect, useRef, useCallback, lazy, Suspense, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { Plus, X, LayoutDashboard, Download } from 'lucide-react';
import { DateRange } from 'react-day-picker';
import { isWithinInterval, parseISO, format } from 'date-fns';
import { DateRangePicker } from "@/components/date-range-picker";
import { Spinner } from "@/components/ui/kibo-ui/spinner";
import { useHabits } from '@/contexts/HabitsContext';
import { useUser, useAuth } from '@clerk/nextjs';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { analyticsApi, type HabitStats } from '@/lib/services/analytics-api';
import { HistoryScrubber } from '@/components/history-scrubber';
import { Button } from "@/components/ui/button";
import type { Habit } from '@/contexts/HabitsContext';
import { useAnalyticsFiltersOptional } from './analytics-filter-context';

// Lazy load heavy components that are only shown when user clicks
const HabitSelectionModal = lazy(() => import("@/components/habit-selection-modal").then(m => ({ default: m.HabitSelectionModal })));
const DataImportModal = lazy(() => import("@/components/data-import-modal").then(m => ({ default: m.DataImportModal })));

// Lazy load the icon component - full lucide library loads client-side only AFTER page renders
const DynamicIcon = dynamic(() => import('@/components/ui/dynamic-icon'), {
  ssr: false,
  loading: () => <LayoutDashboard className="w-4 h-4 text-black" />,
});

// Wrapper for habit icons
const HabitIcon = ({ iconName }: { iconName: string }) => {
  return <DynamicIcon name={iconName} className="w-4 h-4 text-black" />;
};

// Habit icons mapping
const getHabitIcon = (name: string, category: string) => {
  const iconMap: { [key: string]: string } = {
    'deep work': '🧠',
    'lightning deep work': '⚡',
    'meditation': '🧘',
    'exercise': '💪',
    'reading': '📚',
    'journaling': '📝',
    'sleep': '😴',
    'water': '💧',
    'learning': '🎓',
    'coding': '💻',
    'writing': '✍️',
    'music': '🎵',
    'research': '🔍',
    'skill practice': '🎯',
    'cold showers': '🚿',
    'standup check-in': '📞'
  };
  const key = name.toLowerCase().replace(/\s+/g, ' ');
  return iconMap[key] || '📈';
};

// Sortable habit item component for drag and drop
interface SortableHabitItemProps {
  habit: Habit;
  getHabitMetricDisplay: (habit: Habit, hoveredValue?: number) => string;
  scrubberHoveredDate: string | null;
  scrubberHoveredValues: Record<string, number> | null;
  activeTooltip: string | null;
  setActiveTooltip: (id: string | null) => void;
  getHabitMetricStats: (habit: Habit) => {
    sumFormatted: string;
    avgFormatted: string;
    minFormatted: string;
    maxFormatted: string;
    stdDevFormatted: string;
  };
  confirmDelete: (habitId: string | undefined) => void;
  deletingHabit: string | null;
}

function SortableHabitItem({
  habit,
  getHabitMetricDisplay,
  scrubberHoveredDate,
  scrubberHoveredValues,
  activeTooltip,
  setActiveTooltip,
  getHabitMetricStats,
  confirmDelete,
  deletingHabit,
}: SortableHabitItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: habit.id || '' });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`w-full max-w-2xl flex justify-between items-center gap-12 h-8 px-1 group hover:bg-[#F7F7F7] bg-white cursor-grab active:cursor-grabbing ${
        isDragging ? 'shadow-lg bg-[#F3F3F3] cursor-grabbing opacity-90' : ''
      }`}
    >
      <div className="flex items-center min-w-0 gap-1.5">
        <span className="flex items-center justify-center w-5 h-5 flex-shrink-0">
          {habit.icon ? (
            /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u.test(habit.icon) ? (
              <span className="text-base leading-none">{habit.icon}</span>
            ) : (
              <HabitIcon iconName={habit.icon} />
            )
          ) : (
            <span className="text-base leading-none">{getHabitIcon(habit.name, habit.category)}</span>
          )}
        </span>
        <span className="text-[17px] font-normal text-gray-900 truncate">{habit.name}</span>
      </div>
      <div
        className="flex items-center space-x-2 cursor-default relative tooltip-container flex-shrink-0"
        onClick={(e) => {
          e.stopPropagation();
          setActiveTooltip(activeTooltip === habit.id ? null : habit.id || '');
        }}
      >
        <span className="text-[17px] font-normal text-gray-900 select-none tabular-nums">
          {getHabitMetricDisplay(
            habit, 
            scrubberHoveredDate && scrubberHoveredValues 
              ? scrubberHoveredValues[habit.id || ''] 
              : undefined
          )}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); confirmDelete(habit.id); }}
          disabled={deletingHabit === habit.id}
          className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-gray-600 transition-all disabled:opacity-50"
          title="Delete habit"
        >
          {deletingHabit === habit.id ? (
            <div className="w-3 h-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin"></div>
          ) : (
            <X className="w-3 h-3" />
          )}
        </button>
        {activeTooltip === habit.id && (
          <div className="absolute top-full right-0 mt-2 p-4 bg-white border border-gray-300 shadow-lg z-[999] min-w-[240px]">
            {(() => {
              const s = getHabitMetricStats(habit);
              return (
                <div className="space-y-1.5 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-900">Sum</span>
                    <span className="text-gray-600 hover:text-black transition-colors cursor-default tabular-nums text-right whitespace-nowrap pl-4">{s.sumFormatted}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-900">Average</span>
                    <span className="text-gray-600 hover:text-black transition-colors cursor-default tabular-nums text-right whitespace-nowrap pl-4">{s.avgFormatted}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-900">Min</span>
                    <span className="text-gray-600 hover:text-black transition-colors cursor-default tabular-nums text-right whitespace-nowrap pl-4">{s.minFormatted}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-900">Max</span>
                    <span className="text-gray-600 hover:text-black transition-colors cursor-default tabular-nums text-right whitespace-nowrap pl-4">{s.maxFormatted}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-900">Std Dev</span>
                    <span className="text-gray-600 hover:text-black transition-colors cursor-default tabular-nums text-right whitespace-nowrap pl-4">{s.stdDevFormatted}</span>
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}

interface OverviewViewProps {
  // Optional: Allow passing in external filter state for standalone use
  externalDateRange?: DateRange | undefined;
  onDateRangeChange?: (range: DateRange | undefined) => void;
  // Hide controls when used inside unified page (controls are in parent)
  hideControls?: boolean;
}

export function OverviewView({ 
  externalDateRange, 
  onDateRangeChange,
  hideControls = false 
}: OverviewViewProps) {
  const { user, isLoaded: userLoaded, isSignedIn } = useUser();
  const { isLoaded, getToken } = useAuth();
  const {
    habits,
    habitLogs,
    isLoading,
    error,
    fetchHabits,
    fetchHabitLogs,
    deleteHabit
  } = useHabits();

  // Try to use shared filter context, fall back to local state
  const filterContext = useAnalyticsFiltersOptional();
  
  // Local state for when not using context
  const [localDateRange, setLocalDateRange] = useState<DateRange | undefined>(undefined);
  
  // Use context, external props, or local state
  const dateRange = filterContext?.dateRange ?? externalDateRange ?? localDateRange;
  const setDateRange = useCallback((range: DateRange | undefined) => {
    if (filterContext) {
      filterContext.setDateRange(range);
    } else if (onDateRangeChange) {
      onDateRangeChange(range);
    } else {
      setLocalDateRange(range);
    }
  }, [filterContext, onDateRangeChange]);

  // Local UI state
  const [showSelectionModal, setShowSelectionModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [habitToDelete, setHabitToDelete] = useState<string | null>(null);
  const [deletingHabit, setDeletingHabit] = useState<string | null>(null);
  const [activeTooltip, setActiveTooltip] = useState<string | null>(null);
  const [optimisticLogs, setOptimisticLogs] = useState<any[]>([]);
  const [orderedHabits, setOrderedHabits] = useState<Habit[]>([]);

  // Cached stats from Python analytics API
  const [cachedStats, setCachedStats] = useState<Record<string, HabitStats>>({});
  const [statsLoading, setStatsLoading] = useState(false);

  // History scrubber state
  const [scrubberHoveredDate, setScrubberHoveredDate] = useState<string | null>(null);
  const [scrubberHoveredValues, setScrubberHoveredValues] = useState<Record<string, number> | null>(null);
  const [scrubberSelectedDate, setScrubberSelectedDate] = useState<string | null>(null);

  const handleScrubberHover = useCallback((date: string | null, values: Record<string, number> | null) => {
    setScrubberHoveredDate(date);
    setScrubberHoveredValues(values);
  }, []);

  const handleScrubberSelect = useCallback((date: string | null) => {
    setScrubberSelectedDate(date);
    if (date) {
      const selectedDateObj = parseISO(date);
      setDateRange({ from: selectedDateObj, to: selectedDateObj });
    } else {
      setDateRange(undefined);
    }
  }, [setDateRange]);

  const displayLogs = useMemo(() => {
    return [...habitLogs, ...optimisticLogs];
  }, [habitLogs, optimisticLogs]);

  // Sync "Computer Use" habit on mount
  useEffect(() => {
    const syncComputerUseHabit = async () => {
      try {
        const response = await fetch('/api/watcher/sync-to-habit', { method: 'POST' })
        if (response.ok) {
          const result = await response.json()
          if (result.success && result.synced) {
            console.log(`✅ Auto-synced computer time: ${result.amount} ${result.unit}`)
            fetchHabits()
          }
        }
      } catch (e) {
        console.debug('Computer use sync failed:', e)
      }
    }
    
    if (userLoaded && isSignedIn) {
      syncComputerUseHabit()
    }
  }, [userLoaded, isSignedIn, fetchHabits])
  
  // Fetch stats from Python analytics API
  useEffect(() => {
    const fetchStats = async () => {
      if (!habits.length) return;

      try {
        setStatsLoading(true);
        const token = await getToken();
        if (!token) return;

        const params: { startDate?: string; endDate?: string; daysBack?: number } = {};
        if (dateRange?.from) {
          params.startDate = dateRange.from.toISOString().split('T')[0];
          if (dateRange.to) {
            params.endDate = dateRange.to.toISOString().split('T')[0];
          } else {
            params.endDate = params.startDate;
          }
        } else {
          params.daysBack = 36500;
        }

        const result = await analyticsApi.getHabitStats(token, params);

        if (result.success && result.habits) {
          const statsMap: Record<string, HabitStats> = {};
          result.habits.forEach(stat => {
            statsMap[stat.id] = stat;
          });
          setCachedStats(statsMap);
        }
      } catch (error) {
        console.error('❌ Failed to fetch stats from Python API:', error);
      } finally {
        setStatsLoading(false);
      }
    };

    fetchStats();
  }, [habits, habitLogs.length, dateRange, getToken]);

  // Initialize ordered habits
  useEffect(() => {
    if (habits.length > 0) {
      const savedOrder = localStorage.getItem(`habit-order-${user?.id}`);
      if (savedOrder) {
        try {
          const orderArray: string[] = JSON.parse(savedOrder);
          const sorted = [...habits].sort((a, b) => {
            const aIndex = orderArray.indexOf(a.id || '');
            const bIndex = orderArray.indexOf(b.id || '');
            if (aIndex === -1) return 1;
            if (bIndex === -1) return -1;
            return aIndex - bIndex;
          });
          setOrderedHabits(sorted);
        } catch (e) {
          setOrderedHabits(habits);
        }
      } else {
        setOrderedHabits(habits);
      }
    }
  }, [habits, user?.id]);

  // Configure sensors for drag and drop
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Require 8px movement before starting drag
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Handle drag end
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = orderedHabits.findIndex((h) => h.id === active.id);
      const newIndex = orderedHabits.findIndex((h) => h.id === over.id);

      const newOrder = arrayMove(orderedHabits, oldIndex, newIndex);
      setOrderedHabits(newOrder);
      
      const orderIds = newOrder.map(h => h.id || '');
      localStorage.setItem(`habit-order-${user?.id}`, JSON.stringify(orderIds));
    }
  };

  // Close tooltip when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (activeTooltip) {
        const target = event.target as Element;
        if (!target.closest('.tooltip-container')) {
          setActiveTooltip(null);
        }
      }
    };

    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && activeTooltip) {
        setActiveTooltip(null);
      }
    };

    if (activeTooltip) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscapeKey);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscapeKey);
    };
  }, [activeTooltip]);

  // Load habit logs on mount
  const hasLoadedLogs = useRef(false);
  useEffect(() => {
    if (user && !isLoading && habitLogs.length === 0 && !hasLoadedLogs.current) {
      hasLoadedLogs.current = true;
      fetchHabitLogs();
    }
  }, [user, isLoading, fetchHabitLogs]);

  // Force fetch logs when habits are loaded
  useEffect(() => {
    if (habits.length > 0 && habitLogs.length === 0 && user) {
      fetchHabitLogs();
    }
  }, [habits.length, habitLogs.length, user, fetchHabitLogs]);

  // Get display text for habit metrics
  const getHabitMetricDisplay = useCallback((habit: Habit, previewValue?: number | null): string => {
    const unitType = habit.unit_type || 'sessions';
    
    if (previewValue !== undefined && previewValue !== null) {
      if (unitType.toLowerCase().includes('hour')) {
        const hours = Math.round((previewValue / 60) * 100) / 100;
        return `${hours} Hours`;
      } else if (unitType.toLowerCase().includes('minute')) {
        return `${Math.round(previewValue)} Minutes`;
      }
      
      const unitLower = unitType.toLowerCase();
      let formattedAmount: string;
      
      if (['bpm', 'steps', 'count', 'pages', 'reps', 'sets', 'sessions'].includes(unitLower)) {
        formattedAmount = Math.round(previewValue).toString();
      } else if (['miles', 'km', 'kilometers'].includes(unitLower)) {
        formattedAmount = previewValue.toFixed(1);
      } else {
        formattedAmount = Number.isInteger(previewValue) 
          ? previewValue.toString() 
          : (Math.round(previewValue * 100) / 100).toString();
      }
      
      return `${formattedAmount} ${unitType}`;
    }

    let filteredLogs = displayLogs.filter(log => {
      const matchesHabit = log.habit_id === habit.id;
      const isCompleted = log.status === 'completed' || (log.status as any) === 'success' || !log.status;
      return matchesHabit && isCompleted;
    });

    if (dateRange?.from) {
      filteredLogs = filteredLogs.filter(log => {
        const logDate = parseISO(log.date);
        let isInRange = false;

        if (dateRange.to) {
          isInRange = isWithinInterval(logDate, { start: dateRange.from!, end: dateRange.to });
        } else {
          const filterDateStr = dateRange.from!.toLocaleDateString('en-CA');
          const logDateStr = typeof log.date === 'string' ? log.date.split('T')[0] : '';
          isInRange = logDateStr === filterDateStr;
        }

        return isInRange;
      });
    }

    if (filteredLogs.length === 0) {
      return `0 ${unitType}`;
    }

    if (unitType.toLowerCase().includes('hour') || unitType.toLowerCase().includes('minute')) {
      const totalDurationSeconds = filteredLogs.reduce((sum, log) => {
        if (log.duration && log.duration > 0) {
          return sum + log.duration;
        } else if (log.amount && log.amount > 0) {
          if (unitType.toLowerCase().includes('hour')) {
            return sum + (log.amount * 3600);
          } else if (unitType.toLowerCase().includes('minute')) {
            return sum + (log.amount * 60);
          } else {
            return sum + log.amount;
          }
        }
        return sum;
      }, 0);

      if (unitType.toLowerCase().includes('hour')) {
        const totalHours = Math.round((totalDurationSeconds / 3600) * 100) / 100;
        return `${totalHours} Hours`;
      } else {
        const totalMinutes = Math.round(totalDurationSeconds / 60);
        return `${totalMinutes} Minutes`;
      }
    }

    const totalAmount = filteredLogs.reduce((sum, log) => sum + (log.amount || 1), 0);
    const unitLower = unitType.toLowerCase();
    let formattedAmount: string;
    
    if (['bpm', 'steps', 'count', 'pages', 'reps', 'sets', 'sessions'].includes(unitLower)) {
      formattedAmount = Math.round(totalAmount).toString();
    } else if (['miles', 'km', 'kilometers'].includes(unitLower)) {
      formattedAmount = totalAmount.toFixed(1);
    } else if (['hours', 'minutes'].includes(unitLower)) {
      formattedAmount = (Math.round(totalAmount * 100) / 100).toString();
    } else {
      formattedAmount = Number.isInteger(totalAmount) 
        ? totalAmount.toString() 
        : (Math.round(totalAmount * 100) / 100).toString();
    }
    
    return `${formattedAmount} ${unitType}`;
  }, [displayLogs, dateRange]);

  // Detailed stats for tooltip
  const getHabitMetricStats = useCallback((habit: Habit) => {
    const formatNum = (n: number) => {
      const rounded = Math.round(n * 100) / 100;
      return rounded.toLocaleString(undefined, { maximumFractionDigits: 2 });
    };

    const stats = cachedStats[habit.id || ''];

    if (stats) {
      const unitLabel = stats.unit || habit.unit_type || 'sessions';
      return {
        unitLabel,
        sumFormatted: `${formatNum(stats.total)} ${unitLabel}`,
        avgFormatted: `${formatNum(stats.average)} ${unitLabel}`,
        minFormatted: `${formatNum(stats.min)} ${unitLabel}`,
        maxFormatted: `${formatNum(stats.max)} ${unitLabel}`,
        stdDevFormatted: `${formatNum(stats.std_dev || Math.sqrt(stats.variance || 0))} ${unitLabel}`,
        daysWithData: stats.days_with_data,
      };
    }

    const unitLabel = habit.unit_type || 'sessions';
    if (statsLoading) {
      return {
        unitLabel,
        sumFormatted: `Loading...`,
        avgFormatted: `Loading...`,
        minFormatted: `Loading...`,
        maxFormatted: `Loading...`,
        stdDevFormatted: `Loading...`,
      };
    }

    return {
      unitLabel,
      sumFormatted: `0 ${unitLabel}`,
      avgFormatted: `0 ${unitLabel}`,
      minFormatted: `0 ${unitLabel}`,
      maxFormatted: `0 ${unitLabel}`,
      stdDevFormatted: `0 ${unitLabel}`,
    };
  }, [cachedStats, statsLoading]);

  const handleHabitCreated = useCallback(async (newHabit: Habit) => {
    try {
      await fetchHabits();
    } catch (error) {
      console.error('❌ Error refreshing habits list:', error);
    }
  }, [fetchHabits]);

  const confirmDelete = (habitId: string | undefined) => {
    if (!habitId) return;
    setHabitToDelete(habitId);
  };

  const cancelDelete = () => {
    setHabitToDelete(null);
  };

  const handleDeleteHabit = async (habitId: string | null) => {
    if (!habitId) {
      setHabitToDelete(null);
      return;
    }
    setDeletingHabit(habitId);
    try {
      await deleteHabit(habitId);
      setHabitToDelete(null);
    } catch (error) {
      console.error('❌ Failed to delete habit:', error);
    } finally {
      setDeletingHabit(null);
    }
  };

  // Show spinner while loading
  if (isLoading || !isLoaded || !user) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Spinner className="w-8 h-8" />
      </div>
    );
  }

  return (
    <div className="space-y-0">
      {/* Header with controls - only show if not hidden */}
      {!hideControls && (
        <div className="relative flex items-center justify-end h-14">
          {/* History Scrubber - centered */}
          {habits.length > 0 && (
            <div className="absolute left-1/2 -translate-x-1/2 w-[500px]">
              <HistoryScrubber
                habitLogs={displayLogs}
                habits={orderedHabits}
                daysToShow={90}
                onHoverDate={handleScrubberHover}
                onSelectDate={handleScrubberSelect}
                selectedDate={scrubberSelectedDate}
              />
            </div>
          )}
          
          <div className="flex items-center space-x-1 relative z-10">
            {/* Add Habit button */}
            <div className="relative group">
              <button
                onClick={() => setShowSelectionModal(true)}
                className="h-9 px-3 py-2 border border-gray-300 bg-white text-black hover:bg-[#F3F3F3] focus:bg-[#F3F3F3] transition-colors rounded-none flex items-center justify-center"
                aria-label="Add Habit"
              >
                <Plus className="w-4 h-4" />
              </button>
              <div className="absolute top-[calc(100%+4px)] left-1/2 -translate-x-1/2 px-2 py-1 bg-black text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-50">
                Add
              </div>
            </div>

            {/* Import button */}
            <div className="relative group">
              <button
                onClick={() => setShowImportModal(true)}
                className="h-9 px-3 py-2 border border-gray-300 bg-white text-black hover:bg-[#F3F3F3] focus:bg-[#F3F3F3] transition-colors rounded-none flex items-center justify-center"
                aria-label="Import Data"
              >
                <Download className="w-4 h-4" />
              </button>
              <div className="absolute top-[calc(100%+4px)] left-1/2 -translate-x-1/2 px-2 py-1 bg-black text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap z-50">
                Import
              </div>
            </div>

            {/* Date Range Picker */}
            <DateRangePicker
              className="w-auto"
              onDateRangeChange={setDateRange}
              initialDateRange={dateRange}
            />
          </div>
        </div>
      )}

      {/* Habits List */}
      <div className="pt-6">
        <div className="max-w-[500px] mx-auto w-full">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={orderedHabits.map(h => h.id || '')}
              strategy={verticalListSortingStrategy}
            >
              {orderedHabits.map((habit) => (
                <SortableHabitItem
                  key={habit.id}
                  habit={habit}
                  getHabitMetricDisplay={getHabitMetricDisplay}
                  scrubberHoveredDate={scrubberHoveredDate}
                  scrubberHoveredValues={scrubberHoveredValues}
                  activeTooltip={activeTooltip}
                  setActiveTooltip={setActiveTooltip}
                  getHabitMetricStats={getHabitMetricStats}
                  confirmDelete={confirmDelete}
                  deletingHabit={deletingHabit}
                />
              ))}
            </SortableContext>
          </DndContext>
        </div>
      </div>

      {/* Empty state */}
      {habits.length === 0 && !isLoading && (
        <div className="flex flex-col items-center justify-center min-h-[40vh] mt-8">
          <div className="text-xl mb-2 text-center" style={{ fontWeight: 500 }}>
            Connect your devices
          </div>
          <div className="text-sm font-normal mb-2 text-center max-w-xl leading-tight" style={{ fontWeight: 400, color: '#9C9C9D' }}>
            Connect your wearable devices to unlock personal insights.<br />Start tracking anything you want to get started.
          </div>
          <button
            onClick={() => setShowSelectionModal(true)}
            className="mt-2 px-3 py-2 bg-black text-white rounded-none text-sm font-normal hover:bg-gray-900 transition-colors shadow"
            style={{ fontWeight: 400 }}
          >
            Start Tracking
          </button>
        </div>
      )}

      {/* Modals */}
      {showSelectionModal && (
        <Suspense fallback={null}>
          <HabitSelectionModal
            isOpen={showSelectionModal}
            onClose={() => setShowSelectionModal(false)}
            onHabitCreated={handleHabitCreated}
          />
        </Suspense>
      )}

      {showImportModal && (
        <Suspense fallback={null}>
          <DataImportModal
            isOpen={showImportModal}
            onClose={() => setShowImportModal(false)}
            onImportComplete={() => {
              fetchHabits();
              fetchHabitLogs();
            }}
          />
        </Suspense>
      )}

      {/* Delete Confirmation Modal */}
      {habitToDelete && (
        <div className="fixed inset-0 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-none max-w-md w-full mx-4 shadow-lg border border-gray-300">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Delete Habit</h3>
            <p className="text-gray-600 mb-6">
              Are you sure you want to delete this habit? This action cannot be undone.
            </p>
            <div className="flex justify-end space-x-3">
              <Button
                variant="outline"
                onClick={cancelDelete}
                className="rounded-none px-3 py-1.5 text-sm hover:bg-[#F3F3F3] focus:bg-[#F3F3F3]"
              >
                Cancel
              </Button>
              <Button
                onClick={() => handleDeleteHabit(habitToDelete)}
                disabled={deletingHabit === habitToDelete}
                className="rounded-none bg-black hover:bg-gray-800 text-white px-3 py-1.5 text-sm"
              >
                {deletingHabit === habitToDelete ? (
                  <Spinner className="w-4 h-4" />
                ) : (
                  'Delete'
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
