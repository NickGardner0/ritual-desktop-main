/**
 * OverviewView - Dashboard/Index content extracted for unified Analytics page
 * 
 * Displays habits in a clean list format with totals and stats.
 * Designed to work with shared filter context or standalone.
 */

'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { Plus, Download, CloudSun, CloudRain, Cloud, Sun, Wind, Droplets, Eye, Gauge, Umbrella } from 'lucide-react';
import type { DateRange } from 'react-day-picker';
import { isWithinInterval, parseISO, format, startOfDay, endOfDay } from 'date-fns';
import { Spinner } from "@/components/ui/kibo-ui/spinner";
import { useHabits } from '@/contexts/HabitsContext';
import { useUser, useAuth } from '@clerk/nextjs';
import { analyticsApi, type HabitStats } from '@/lib/services/analytics-api';
import { HistoryScrubber } from '@/components/history-scrubber';
import { Button } from "@/components/ui/button";
import type { Habit } from '@/contexts/HabitsContext';
import { useAnalyticsFiltersOptional } from './analytics-filter-context';

const DateRangePicker = dynamic(
  () => import("@/components/date-range-picker").then(m => ({ default: m.DateRangePicker })),
  { ssr: false }
);

const HabitSelectionModal = dynamic(
  () => import("@/components/habit-selection-modal").then(m => ({ default: m.HabitSelectionModal })),
  { ssr: false }
);

const DataImportModal = dynamic(
  () => import("@/components/data-import-modal").then(m => ({ default: m.DataImportModal })),
  { ssr: false }
);

const SortableHabitList = dynamic(
  () => import('./sortable-habit-list').then(m => ({ default: m.SortableHabitList })),
  { ssr: false }
);

const PYTHON_API_BASE = process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';

interface WeatherCurrentPayload {
  observed_at: string;
  tz: string;
  location_label: string;
  condition_code: string;
  temperature_c: number;
  feels_like_c: number;
  humidity: number;
  wind_speed_mps: number;
  precip_probability: number;
  pressure_hpa?: number | null;
  visibility_m?: number | null;
}

interface WeatherTodayPayload {
  date_local: string;
  high_c: number;
  low_c: number;
  sunrise?: string | null;
  sunset?: string | null;
}

interface WeatherTrendPoint {
  observed_at: string;
  temperature_c: number;
}

function conditionIcon(conditionCode: string | null | undefined) {
  const code = (conditionCode || '').toLowerCase();
  if (code.includes('rain') || code.includes('drizzle') || code.includes('shower')) {
    return CloudRain;
  }
  if (code.includes('thunder') || code.includes('storm')) {
    return Umbrella;
  }
  if (code.includes('clear') || code.includes('sunny')) {
    return Sun;
  }
  if (code.includes('cloud') || code.includes('overcast')) {
    return Cloud;
  }
  return CloudSun;
}

function formatWeatherUpdatedAt(observedAt: string | null | undefined): string {
  if (!observedAt) return 'Unknown';
  const date = new Date(observedAt);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  const diffMs = Date.now() - date.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return date.toLocaleString();
}

function buildSparklinePath(
  points: number[],
  width: number,
  height: number,
  padding = 2
): string {
  if (!points.length) return '';
  if (points.length === 1) {
    const y = height / 2;
    return `M ${padding} ${y} L ${width - padding} ${y}`;
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;

  return points
    .map((value, idx) => {
      const x = padding + (idx / (points.length - 1)) * innerWidth;
      const y = padding + (1 - (value - min) / range) * innerHeight;
      return `${idx === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
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
  const [weatherEnabled, setWeatherEnabled] = useState(false);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherCurrent, setWeatherCurrent] = useState<WeatherCurrentPayload | null>(null);
  const [weatherToday, setWeatherToday] = useState<WeatherTodayPayload | null>(null);
  const [weatherTrend, setWeatherTrend] = useState<WeatherTrendPoint[]>([]);

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

  const weatherTrendValues = useMemo(
    () => weatherTrend.map(point => point.temperature_c),
    [weatherTrend]
  );
  const weatherSparklinePath = useMemo(
    () => buildSparklinePath(weatherTrendValues, 220, 46, 2),
    [weatherTrendValues]
  );

  // Fetch weather context for dashboard card (only when integration is enabled).
  useEffect(() => {
    let cancelled = false;

    const fetchWeather = async () => {
      try {
        const token = await getToken();
        if (!token) return;

        const statusResponse = await fetch(`${PYTHON_API_BASE}/api/integrations/weather/status`, {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        });

        if (!statusResponse.ok) {
          if (!cancelled) {
            setWeatherEnabled(false);
            setWeatherCurrent(null);
            setWeatherToday(null);
            setWeatherTrend([]);
          }
          return;
        }

        const statusPayload = await statusResponse.json();
        const enabled = !!statusPayload?.enabled;
        if (!enabled) {
          if (!cancelled) {
            setWeatherEnabled(false);
            setWeatherLoading(false);
            setWeatherCurrent(null);
            setWeatherToday(null);
            setWeatherTrend([]);
          }
          return;
        }

        if (!cancelled) {
          setWeatherEnabled(true);
          setWeatherLoading(true);
        }

        const currentResponse = await fetch(`${PYTHON_API_BASE}/api/weather/current`, {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        });

        if (!currentResponse.ok) {
          if (!cancelled) {
            setWeatherCurrent(null);
            setWeatherToday(null);
          }
          return;
        }

        const currentPayload = await currentResponse.json();
        if (!cancelled) {
          setWeatherCurrent(currentPayload?.current || null);
          setWeatherToday(currentPayload?.today || null);
        }

        // Fetch recent trend points (last 24h) for a compact sparkline.
        const endIso = new Date().toISOString();
        const startIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const rangeUrl = `${PYTHON_API_BASE}/api/weather/range?start=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}`;
        const rangeResponse = await fetch(rangeUrl, {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        });
        if (rangeResponse.ok) {
          const rangePayload = await rangeResponse.json();
          const observations = (rangePayload?.observations || []) as Array<{ observed_at?: string; temperature_c?: number }>;
          const normalized = observations
            .filter(item => typeof item?.temperature_c === 'number' && typeof item?.observed_at === 'string')
            .map(item => ({
              observed_at: item.observed_at as string,
              temperature_c: item.temperature_c as number,
            }))
            .sort((a, b) => new Date(a.observed_at).getTime() - new Date(b.observed_at).getTime())
            .slice(-36); // cap points to keep sparkline compact
          if (!cancelled) {
            setWeatherTrend(normalized);
          }
        } else if (!cancelled) {
          setWeatherTrend([]);
        }
      } catch (error) {
        console.debug('Weather context load failed:', error);
      } finally {
        if (!cancelled) {
          setWeatherLoading(false);
        }
      }
    };

    if (userLoaded && isSignedIn && user) {
      fetchWeather();
      const timer = setInterval(fetchWeather, 5 * 60 * 1000);
      return () => {
        cancelled = true;
        clearInterval(timer);
      };
    }

    return () => {
      cancelled = true;
    };
  }, [userLoaded, isSignedIn, user, getToken]);

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
          params.startDate = format(dateRange.from, 'yyyy-MM-dd');
          if (dateRange.to) {
            params.endDate = format(dateRange.to, 'yyyy-MM-dd');
          } else {
            params.endDate = params.startDate;
          }
        } else {
          // Cap "All time" to 3 years — 36500 days (~100 years) was causing very slow loads
          params.daysBack = 1095;
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

  const handleReorder = useCallback((reorderedHabits: Habit[]) => {
    setOrderedHabits(reorderedHabits);
    const orderIds = reorderedHabits.map(h => h.id || '');
    localStorage.setItem(`habit-order-${user?.id}`, JSON.stringify(orderIds));
  }, [user?.id]);

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
          isInRange = isWithinInterval(logDate, {
            start: startOfDay(dateRange.from!),
            end: endOfDay(dateRange.to),
          });
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

      {weatherEnabled && (
        <div className="pt-4">
          <div className="max-w-[500px] mx-auto w-full border border-gray-200 bg-white p-3">
            {weatherLoading && !weatherCurrent ? (
              <div className="space-y-2 animate-pulse">
                <div className="h-4 w-40 bg-gray-200" />
                <div className="h-8 w-24 bg-gray-200" />
                <div className="h-3 w-3/4 bg-gray-200" />
              </div>
            ) : weatherCurrent ? (
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    {React.createElement(conditionIcon(weatherCurrent.condition_code), {
                      className: 'w-5 h-5 text-gray-700',
                    })}
                    <div>
                      <div className="text-xs text-gray-500 uppercase tracking-wide">Current Weather</div>
                      <div className="text-sm text-gray-700">{weatherCurrent.location_label || 'Near you'}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl leading-none">{Math.round(weatherCurrent.temperature_c)}°C</div>
                    <div className="text-xs text-gray-500">Feels {Math.round(weatherCurrent.feels_like_c)}°C</div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs text-gray-700">
                  <div className="flex items-center gap-1.5"><Umbrella className="w-3.5 h-3.5 text-gray-500" /> {Math.round((weatherCurrent.precip_probability || 0) * 100)}% precip</div>
                  <div className="flex items-center gap-1.5"><Wind className="w-3.5 h-3.5 text-gray-500" /> {weatherCurrent.wind_speed_mps.toFixed(1)} m/s wind</div>
                  <div className="flex items-center gap-1.5"><Droplets className="w-3.5 h-3.5 text-gray-500" /> {Math.round((weatherCurrent.humidity || 0) * 100)}% humidity</div>
                  {typeof weatherCurrent.visibility_m === 'number' ? (
                    <div className="flex items-center gap-1.5"><Eye className="w-3.5 h-3.5 text-gray-500" /> {(weatherCurrent.visibility_m / 1000).toFixed(1)} km visibility</div>
                  ) : (
                    <div className="flex items-center gap-1.5"><Gauge className="w-3.5 h-3.5 text-gray-500" /> {weatherCurrent.pressure_hpa ? `${Math.round(weatherCurrent.pressure_hpa)} hPa` : 'Pressure n/a'}</div>
                  )}
                </div>

                {weatherTrend.length > 1 && (
                  <div className="pt-2 border-t border-gray-100">
                    <div className="flex items-center justify-between text-[11px] text-gray-500 mb-1">
                      <span>24h temperature trend</span>
                      <span>
                        {Math.round(Math.min(...weatherTrendValues))}°C to {Math.round(Math.max(...weatherTrendValues))}°C
                      </span>
                    </div>
                    <svg
                      viewBox="0 0 220 46"
                      width="100%"
                      height="46"
                      className="block"
                      preserveAspectRatio="none"
                      aria-label="24 hour temperature trend"
                    >
                      <path
                        d={weatherSparklinePath}
                        fill="none"
                        stroke="#1f2937"
                        strokeWidth="1.75"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                )}

                {weatherToday && (
                  <div className="pt-2 border-t border-gray-100 text-xs text-gray-700 flex items-center justify-between">
                    <div>Today: H {Math.round(weatherToday.high_c)}°C / L {Math.round(weatherToday.low_c)}°C</div>
                    <div className="text-gray-500">Updated {formatWeatherUpdatedAt(weatherCurrent.observed_at)}</div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-sm text-gray-500">Fetching weather…</div>
            )}
          </div>
        </div>
      )}

      {/* Habits List */}
      <div className="pt-6">
        <div className="max-w-[500px] mx-auto w-full">
          <SortableHabitList
            habits={orderedHabits}
            onReorder={handleReorder}
            getHabitMetricDisplay={getHabitMetricDisplay}
            scrubberHoveredDate={scrubberHoveredDate}
            scrubberHoveredValues={scrubberHoveredValues}
            activeTooltip={activeTooltip}
            setActiveTooltip={setActiveTooltip}
            getHabitMetricStats={getHabitMetricStats}
            confirmDelete={confirmDelete}
            deletingHabit={deletingHabit}
          />
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
        <HabitSelectionModal
          isOpen={showSelectionModal}
          onClose={() => setShowSelectionModal(false)}
          onHabitCreated={handleHabitCreated}
        />
      )}

      {showImportModal && (
        <DataImportModal
          isOpen={showImportModal}
          onClose={() => setShowImportModal(false)}
          onImportComplete={() => {
            fetchHabits();
            fetchHabitLogs();
          }}
        />
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
