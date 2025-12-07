/**
 * Analytics Client Component
 * 
 * Handles ALL client-side interactions:
 * - Date range selection
 * - Habit filtering
 * - Chart interactions
 * - Expanded views
 * 
 * Receives initial data from Server Component
 */

'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useAuth, useUser } from '@clerk/nextjs';
import { useQuery } from '@tanstack/react-query';
import {
  TrendingUp,
  TrendingDown,
  X,
  ChevronDown
} from 'lucide-react';
import { DateRangePicker } from '@/components/date-range-picker';
import { DateRange } from 'react-day-picker';
import { format, parseISO, startOfDay, differenceInDays, subDays, isWithinInterval, sub } from 'date-fns';
import { HabitTickerGrid, AnalyticsViewToggle } from '@/components/analytics/habit-ticker-view';
import { analyticsApi, type HabitStats } from '@/lib/services/analytics-api';

// Import Recharts components directly (lazy loading causes type issues in production)
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip
} from 'recharts';

// Type definitions
type HabitData = {
  habit_id: string;
  habit_name: string;
  category: string;
  icon?: string;
  unit_type?: string;
  [key: string]: any;
};

type ChartDataPoint = {
  value: number;
  [key: string]: any;
};

// Tinybird-inspired color palette
const COLORS = {
  success: '#10B981',
  danger: '#DC2626',
  primary: '#14B8A6',
  gray: {
    50: '#F9FAFB',
    100: '#F3F4F6',
    200: '#E5E7EB',
    300: '#D1D5DB',
    400: '#9CA3AF',
    500: '#6B7280',
    600: '#4B5563',
    700: '#374151',
    800: '#1F2937',
    900: '#111827'
  }
};

// Summary cards removed - now using Perplexity-style habit ticker cards

interface HabitMetricCardProps {
  habitName: string;
  currentValue: number;
  unit: string;
  change?: number;
  absoluteChange?: number;
  chartData: any[];
  isPositive: boolean;
  onClick?: () => void;
  onRemove?: () => void;
}

const HabitMetricCard: React.FC<HabitMetricCardProps> = ({
  habitName,
  currentValue,
  unit,
  change,
  absoluteChange,
  chartData,
  isPositive,
  onClick,
  onRemove
}) => {
  // Match spark card colors
  const tealGreen = '#0D9488';
  const warmRed = '#B91C1C';
  const isNeutral = change === undefined || Math.abs(change) < 0.5;
  const chartColor = isNeutral ? '#6B7280' : (isPositive ? tealGreen : warmRed);
  const bgColor = isNeutral 
    ? 'rgba(107, 114, 128, 0.08)' 
    : (isPositive ? 'rgba(13, 148, 136, 0.08)' : 'rgba(185, 28, 28, 0.08)');

  return (
    <div
      className="group relative bg-[#FAFAF9] border border-gray-300 p-4 hover:bg-[#F5F5F4] transition-colors duration-150 cursor-pointer"
      onClick={onClick}
    >
      {/* Close Button - Top right corner, appears on hover */}
      {onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
          aria-label="Remove habit"
        >
          <X className="w-3 h-3 text-gray-400 hover:text-gray-600" />
        </button>
      )}

      {/* Header Row: Name + Badge + Change */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0 pr-3">
          <h3 className="font-medium text-[15px] text-gray-900 truncate leading-tight">
            {habitName}
          </h3>
          <p className="text-[11px] text-gray-500 uppercase tracking-wider mt-0.5">
            {unit}
          </p>
        </div>
        
        {/* Right side: Badge + Absolute Change */}
        <div className="flex flex-col items-end flex-shrink-0">
          {/* % Badge */}
          <div 
            className="flex items-center gap-1 px-2 py-0.5"
            style={{ backgroundColor: bgColor }}
          >
            {!isNeutral && (
              isPositive 
                ? <span className="text-[11px]" style={{ color: chartColor }}>↗</span>
                : <span className="text-[11px]" style={{ color: chartColor }}>↘</span>
            )}
            <span 
              className="text-[11px] font-medium tabular-nums"
              style={{ color: chartColor }}
            >
              {Math.abs(change || 0).toFixed(2)}%
            </span>
          </div>
          {/* Absolute change */}
          {absoluteChange !== undefined && (
            <span 
              className="text-[11px] font-medium tabular-nums mt-1"
              style={{ color: chartColor }}
            >
              {absoluteChange >= 0 ? '+' : ''}{absoluteChange.toFixed(1)}
            </span>
          )}
        </div>
      </div>

      {/* Value */}
      <div className="mb-2">
        <p className="text-xl font-medium text-gray-900 tabular-nums">
          {currentValue.toFixed(currentValue < 10 ? 2 : 0)}
        </p>
      </div>

      <div className="h-[110px] -mx-2">
        {chartData.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-xs text-gray-400">No data for selected period</p>
          </div>
        ) : (
          <Suspense fallback={
            <div className="flex items-center justify-center h-full">
              <div className="w-4 h-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin"></div>
            </div>
          }>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 5, right: 5, left: -15, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gray[200]} vertical={false} />
                <XAxis
                  dataKey="shortDate"
                  stroke={COLORS.gray[400]}
                  tick={{ fill: COLORS.gray[500], fontSize: 10 }}
                  axisLine={{ stroke: COLORS.gray[300] }}
                  tickLine={{ stroke: COLORS.gray[300] }}
                  interval="preserveStartEnd"
                  minTickGap={30}
                />
                <YAxis
                  stroke={COLORS.gray[400]}
                  tick={{ fill: COLORS.gray[500], fontSize: 10 }}
                  axisLine={{ stroke: COLORS.gray[300] }}
                  tickLine={{ stroke: COLORS.gray[300] }}
                  width={35}
                  tickFormatter={(value) => value.toFixed(0)}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      return (
                        <div 
                          className="text-gray-900 px-3 py-2 text-xs shadow-lg border border-gray-300/60"
                          style={{
                            background: 'rgba(255, 255, 255, 0.72)',
                            backdropFilter: 'blur(12px) saturate(180%)',
                            WebkitBackdropFilter: 'blur(12px) saturate(180%)',
                          }}
                        >
                          <p className="font-medium mb-1">{data.date}</p>
                          <p>{data.value.toFixed(1)} {unit}</p>
                          {data.time && <p className="text-gray-500 mt-0.5">{data.time}</p>}
                        </div>
                      );
                    }
                    return null;
                  }}
                  cursor={{ fill: 'rgba(0, 0, 0, 0.05)' }}
                />
                <Bar
                  dataKey="value"
                  fill="#4A4A4C"
                  radius={[0, 0, 0, 0]}
                  isAnimationActive={false}
                  maxBarSize={40}
                />
              </BarChart>
            </ResponsiveContainer>
          </Suspense>
        )}
      </div>
    </div>
  );
};

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    
    // Format time helper - converts UTC timestamp to local time
    const formatTimeString = (timeStr: string) => {
      try {
        if (!timeStr) return '';
        
        // Handle different timestamp formats from Tinybird/backend
        // Tinybird returns: "2025-12-06 17:02:00" (UTC, no timezone indicator)
        // ISO format: "2025-12-06T17:02:00Z" or "2025-12-06T17:02:00.000Z"
        
        let date: Date;
        
        if (timeStr.includes('T')) {
          // ISO format - parseISO handles this correctly
          date = parseISO(timeStr);
        } else if (timeStr.includes(' ')) {
          // Tinybird format: "2025-12-06 17:02:00" - treat as UTC
          // Append 'Z' to force UTC interpretation
          date = new Date(timeStr.replace(' ', 'T') + 'Z');
        } else {
          // Just a time string like "17:02:00"
          return timeStr;
        }
        
        if (!isNaN(date.getTime())) {
          // Format in user's local timezone
          return format(date, 'h:mm a');
        }
        return timeStr;
      } catch {
        return timeStr;
      }
    };
    
    return (
      <div 
        className="p-2.5 min-w-[180px] border border-gray-300/60 shadow-lg"
        style={{
          background: 'rgba(255, 255, 255, 0.72)',
          backdropFilter: 'blur(12px) saturate(180%)',
          WebkitBackdropFilter: 'blur(12px) saturate(180%)',
        }}
      >
        <p className="text-xs font-medium text-gray-900 mb-1.5">{label}</p>
        <div className="space-y-1 text-xs">
          {/* Value */}
          <div className="flex items-center justify-between gap-3">
            <span className="text-gray-700 font-medium">{payload[0].name}</span>
            <span className="text-gray-900 font-medium tabular-nums">
              {typeof payload[0].value === 'number' ? payload[0].value.toFixed(1) : payload[0].value}
            </span>
          </div>
          
          {/* Sleep Start/End Times */}
          {data.sleepOnset && data.sleepEnd && (
            <>
              <div className="flex items-center justify-between gap-3">
                <span className="text-gray-600">Sleep Start</span>
                <span className="text-gray-800 tabular-nums font-medium">
                  {format(parseISO(data.sleepOnset), 'h:mm a')}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-gray-600">Sleep End</span>
                <span className="text-gray-800 tabular-nums font-medium">
                  {format(parseISO(data.sleepEnd), 'h:mm a')}
                </span>
              </div>
            </>
          )}
          
          {/* General Time (for non-sleep habits) */}
          {data.time && !data.sleepOnset && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-gray-600">Time</span>
              <span className="text-gray-800 tabular-nums font-medium">
                {formatTimeString(data.time)}
              </span>
            </div>
          )}
        </div>
      </div>
    );
  }
  return null;
};

// ================================
// MAIN CLIENT COMPONENT
// ================================

/**
 * Fetch analytics data with React Query (using Tinybird for performance!)
 */
function useAnalyticsSummary() {
  const { user } = useUser();
  const { getToken } = useAuth();

  return useQuery({
    queryKey: ['analytics-summary', user?.id],
    queryFn: async () => {
      const token = await getToken();
      const backendUrl = process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';

      // Fetch habits, overall summary, and per-habit summary in parallel (all Tinybird-powered!)
      const [habitsRes, summaryRes, habitsSummaryRes] = await Promise.all([
        fetch(`${backendUrl}/api/habits`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch('/api/analytics/summary'), // ✅ Tinybird-powered overall metrics
        fetch('/api/analytics/habits/summary') // ✅ Tinybird-powered per-habit metrics with % changes!
      ]);

      if (!habitsRes.ok || !summaryRes.ok) {
        throw new Error('Failed to fetch analytics data');
      }

      const habits = await habitsRes.json();
      const summaryData = await summaryRes.json();
      const habitsSummaryData = habitsSummaryRes.ok ? await habitsSummaryRes.json() : { data: [] };

      console.log('✅ [Analytics Query] Tinybird responses:', {
        habitsCount: habits.length,
        summaryData: summaryData.data,
        habitsSummaryCount: habitsSummaryData.data?.length || 0,
        timestamp: new Date().toLocaleTimeString()
      });

      // Create a map of habit_id -> Tinybird-calculated metrics for quick lookup
      const tinybirdHabitMetrics: Record<string, any> = {};
      (habitsSummaryData.data || []).forEach((h: any) => {
        tinybirdHabitMetrics[h.habit_id] = h;
      });

      // Transform habits to match expected format (id → habit_id, name → habit_name)
      // IMPORTANT: Spread original fields FIRST, then override with correct field names
      // This prevents any undefined habit_id/habit_name from the API from overwriting our values
      const transformedHabits = habits.map((h: any) => ({
        ...h,  // Spread original fields FIRST
        habit_id: h.id,  // Then override with correct mapping
        habit_name: h.name,
        category: h.category,
        icon: h.icon,
        unit_type: h.unit_type,
      }));
      
      // Debug: verify all habits have valid habit_id
      const habitsWithoutId = transformedHabits.filter((h: any) => !h.habit_id);
      if (habitsWithoutId.length > 0) {
        console.warn('⚠️ Some habits missing habit_id:', habitsWithoutId.length, 'of', transformedHabits.length);
      }

      // Use Tinybird summary metrics (pre-computed!)
      const summary = summaryData.data || {};
      
      return {
        habits: transformedHabits,
        tinybirdHabitMetrics, // Per-habit metrics with Tinybird-calculated % changes!
        summaryMetrics: {
          activeDays30: summary.active_days_30d || 0,
          avgEntriesPerDay30: summary.avg_entries_per_day_30d || 0,
          currentStreakDays: summary.current_streak_days || 0,
          mostConsistentHabit: summary.most_consistent_habit_name 
            ? {
                name: summary.most_consistent_habit_name,
                days: Math.round((summary.most_consistent_habit_pct || 0) * 30 / 100),
                pct: summary.most_consistent_habit_pct || 0
              }
            : null
        }
      };
    },
    staleTime: 60 * 1000, // Cache for 60 seconds (Tinybird is fast, we can cache!)
    gcTime: 1000 * 60 * 5, // Keep in cache for 5 minutes for back/forward navigation
    enabled: !!user?.id,
    refetchOnWindowFocus: false, // Don't refetch on window focus (prevents excessive requests)
    refetchOnMount: true, // Refetch when Analytics page mounts (if stale)
  });
}

export function AnalyticsClient() {
  const { getToken } = useAuth();
  const { data, isLoading, refetch } = useAnalyticsSummary();

  const [loading, setLoading] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [mounted, setMounted] = useState(false);
  // Auto-select all habits by default for immediate visualization
  const [selectedHabits, setSelectedHabits] = useState<string[]>([]);
  const [habitDropdownOpen, setHabitDropdownOpen] = useState(false);
  const [analyticsData, setAnalyticsData] = useState<any>({});
  const [expandedHabit, setExpandedHabit] = useState<string | null>(null);
  const [expandedLogs, setExpandedLogs] = useState<any[]>([]);
  const [loadingExpandedLogs, setLoadingExpandedLogs] = useState(false);
  
  // Python API stats for expanded modal (single source of truth)
  const [expandedStats, setExpandedStats] = useState<HabitStats | null>(null);
  const [loadingExpandedStats, setLoadingExpandedStats] = useState(false);
  
  // Python API stats for ALL habits (single source of truth for cards)
  const [allHabitStats, setAllHabitStats] = useState<Record<string, HabitStats>>({});
  const [loadingAllStats, setLoadingAllStats] = useState(false);
  const [comparisonPeriod, setComparisonPeriod] = useState<'week' | 'month'>('week');
  // Always initialize to default value to prevent hydration mismatch
  const [viewMode, setViewMode] = useState<'chart' | 'ticker'>('chart');

  const availableHabits = data?.habits || [];
  const summaryMetrics = data?.summaryMetrics;
  const defaultTinybirdMetrics = data?.tinybirdHabitMetrics || {}; // Default 7-day comparison from initial load
  
  // State for custom date range period comparison (updates when user changes date range)
  const [customPeriodMetrics, setCustomPeriodMetrics] = useState<Record<string, any>>({});
  const [loadingPeriodMetrics, setLoadingPeriodMetrics] = useState(false);
  
  // State for "progress since start" metrics (Tinybird-calculated first 7 days vs last 7 days)
  const [progressMetrics, setProgressMetrics] = useState<Record<string, any>>({});
  const [loadingProgressMetrics, setLoadingProgressMetrics] = useState(false);
  
  // Use custom period metrics when date range is selected, otherwise use default 7-day comparison
  const tinybirdHabitMetrics = dateRange?.from && dateRange?.to 
    ? customPeriodMetrics 
    : defaultTinybirdMetrics;
  
  // Fetch "progress since start" from Tinybird (first 7 days vs last 7 days) - for All Time view
  useEffect(() => {
    const fetchProgressMetrics = async () => {
      setLoadingProgressMetrics(true);
      try {
        const res = await fetch('/api/analytics/habits/progress');
        
        if (res.ok) {
          const data = await res.json();
          
          if (data.success && data.data) {
            console.log('✅ Progress since start loaded from Tinybird:', {
              habitsCount: Object.keys(data.data).length,
              sample: Object.values(data.data)[0]
            });
            setProgressMetrics(data.data);
          }
        }
      } catch (error) {
        console.error('❌ Failed to fetch progress metrics:', error);
      } finally {
        setLoadingProgressMetrics(false);
      }
    };
    
    fetchProgressMetrics();
  }, []); // Fetch once on mount

  // Fetch period comparison from Tinybird when date range changes
  useEffect(() => {
    if (!dateRange?.from || !dateRange?.to) {
      // Reset to default metrics when no date range selected
      setCustomPeriodMetrics({});
      return;
    }
    
    const fetchPeriodComparison = async () => {
      setLoadingPeriodMetrics(true);
      try {
        const startDate = format(dateRange.from!, 'yyyy-MM-dd');
        const endDate = format(dateRange.to!, 'yyyy-MM-dd');
        
        console.log('📊 Fetching Tinybird period comparison:', { startDate, endDate });
        
        const res = await fetch(`/api/analytics/habits/summary?start_date=${startDate}&end_date=${endDate}`);
        
        if (res.ok) {
          const data = await res.json();
          
          // Create lookup map by habit_id
          const metricsMap: Record<string, any> = {};
          (data.data || []).forEach((h: any) => {
            metricsMap[h.habit_id] = h;
          });
          
          console.log('✅ Tinybird period comparison loaded:', {
            habitsCount: Object.keys(metricsMap).length,
            period: `${startDate} to ${endDate}`,
            sample: Object.values(metricsMap)[0]
          });
          
          setCustomPeriodMetrics(metricsMap);
        }
      } catch (error) {
        console.error('❌ Failed to fetch period comparison:', error);
      } finally {
        setLoadingPeriodMetrics(false);
      }
    };
    
    fetchPeriodComparison();
  }, [dateRange?.from?.toISOString(), dateRange?.to?.toISOString()]);

  // Fetch individual logs when habit is expanded (from Tinybird!)
  useEffect(() => {
    if (!expandedHabit) {
      setExpandedLogs([]);
      setExpandedStats(null);
      return;
    }

    const fetchExpandedLogs = async () => {
      setLoadingExpandedLogs(true);
      try {
        const now = new Date();
        const to = dateRange?.to || now;
        const from = dateRange?.from || subDays(now, 30);

        const startDate = format(from, 'yyyy-MM-dd');
        const endDate = format(to, 'yyyy-MM-dd');

        const response = await fetch(
          `/api/analytics/habits/logs?habit_id=${expandedHabit}&start_date=${startDate}&end_date=${endDate}`
        );
        
        const result = await response.json();
        
        if (result.success) {
          console.log('✅ Detailed logs fetched from Tinybird:', {
            habitId: expandedHabit,
            logsCount: result.data.length,
            dateRange: `${startDate} to ${endDate}`
          });
          setExpandedLogs(result.data);
        } else {
          console.error('❌ Failed to fetch detailed logs:', result.error);
          setExpandedLogs([]);
        }
      } catch (error) {
        console.error('❌ Error fetching expanded logs:', error);
        setExpandedLogs([]);
      } finally {
        setLoadingExpandedLogs(false);
      }
    };

    fetchExpandedLogs();
  }, [expandedHabit, dateRange]);

  // Fetch stats for ALL habits from Python API (single source of truth)
  useEffect(() => {
    const fetchAllStats = async () => {
      if (!selectedHabits.length) return;
      
      setLoadingAllStats(true);
      try {
        const token = await getToken();
        if (!token) return;

        const now = new Date();
        const to = dateRange?.to || now;
        const from = dateRange?.from || subDays(now, 30);

        const result = await analyticsApi.getHabitStats(token, {
          startDate: format(from, 'yyyy-MM-dd'),
          endDate: format(to, 'yyyy-MM-dd'),
        });

        if (result.success && result.habits) {
          const statsMap: Record<string, HabitStats> = {};
          result.habits.forEach(stat => {
            statsMap[stat.id] = stat;
          });
          setAllHabitStats(statsMap);
          console.log('📊 All habit stats fetched from Python API:', Object.keys(statsMap).length, 'habits');
        }
      } catch (error) {
        console.error('❌ Error fetching all stats from Python API:', error);
      } finally {
        setLoadingAllStats(false);
      }
    };

    fetchAllStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedHabits.join(','), dateRange?.from?.toISOString(), dateRange?.to?.toISOString()]);

  // Fetch stats from Python API when habit is expanded (single source of truth)
  useEffect(() => {
    if (!expandedHabit) {
      setExpandedStats(null);
      return;
    }

    const fetchExpandedStats = async () => {
      setLoadingExpandedStats(true);
      try {
        const token = await getToken();
        if (!token) return;

        const now = new Date();
        const to = dateRange?.to || now;
        const from = dateRange?.from || subDays(now, 30);

        const result = await analyticsApi.getHabitStats(token, {
          habitId: expandedHabit,
          startDate: format(from, 'yyyy-MM-dd'),
          endDate: format(to, 'yyyy-MM-dd'),
        });

        if (result.success && result.habits && result.habits.length > 0) {
          setExpandedStats(result.habits[0]);
          console.log('📊 Expanded stats fetched from Python API:', result.habits[0]);
        } else {
          setExpandedStats(null);
        }
      } catch (error) {
        console.error('❌ Error fetching stats from Python API:', error);
        setExpandedStats(null);
      } finally {
        setLoadingExpandedStats(false);
      }
    };

    fetchExpandedStats();
  }, [expandedHabit, dateRange, getToken]);

  // Load from localStorage after mount (client-side only)
  useEffect(() => {
    setMounted(true);
    // Default to ticker/spark view for better overview
    const savedViewMode = localStorage.getItem('analytics-view-mode');
    if (savedViewMode) {
      setViewMode(savedViewMode as 'chart' | 'ticker');
    } else {
      setViewMode('ticker'); // Default to spark view
    }
  }, []);

  // Auto-select all habits when data loads (if not already selected)
  useEffect(() => {
    // Only run when we have habits and nothing is selected yet
    if (availableHabits.length > 0 && selectedHabits.length === 0) {
      const allHabitIds = availableHabits.map((h: HabitData) => h.habit_id).filter((id: string) => !!id);
      if (allHabitIds.length > 0) {
        console.log('📊 Auto-selecting all habits:', allHabitIds.length);
        setSelectedHabits(allHabitIds);
      }
    }
  }, [availableHabits, selectedHabits.length]);

  // Force refetch on mount to ensure fresh data
  useEffect(() => {
    refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  // Note: Not persisting selectedHabits anymore since we auto-select all

  // Persist viewMode to localStorage
  useEffect(() => {
    if (mounted) {
      localStorage.setItem('analytics-view-mode', viewMode);
    }
  }, [viewMode, mounted]);

  // Fetch analytics data when habits are selected OR available
  useEffect(() => {
    // Use same fallback logic as display: validSelectedHabits or availableHabits
    const validSelected = selectedHabits.filter((id: string) => !!id);
    const habitsToFetch = validSelected.length > 0 
      ? validSelected 
      : availableHabits.map((h: HabitData) => h.habit_id).filter((id: string) => !!id);
    
    if (habitsToFetch.length === 0) {
      setLoading(false);
      return;
    }

    const fetchAnalytics = async () => {
      // Only show loading skeleton if we have no existing data
      // This prevents charts from disappearing during refetches
      const hasExistingData = Object.keys(analyticsData).length > 0;
      if (!hasExistingData) {
        setLoading(true);
      }
      try {
        // Determine timeframes
        const now = new Date();
        const to = dateRange?.to || now;
        const from = dateRange?.from || subDays(now, 30);

        // Calculate duration to fetch enough data for comparison (current period + previous period)
        const durationDays = differenceInDays(to, from) + 1;
        // We need data going back: (now - from) + durationDays
        // This covers the gap from now to 'to', plus 'from' to 'to', plus 'prevFrom' to 'from'
        const daysFromNow = differenceInDays(now, from);
        const totalDaysBack = daysFromNow + durationDays;

        // Ensure we fetch at least a reasonable amount
        const daysBack = Math.max(30, totalDaysBack);

        const logsRes = await fetch(
          `/api/analytics/habits/trends?period=day&days_back=${daysBack}`
        );
        const response = await logsRes.json();
        const allLogs = response.data || [];

        const dataByHabit: Record<string, any[]> = {};
        habitsToFetch.forEach((habitId: string) => {
          dataByHabit[habitId] = [];
        });

        allLogs.forEach((log: any) => {
          if (habitsToFetch.includes(log.habit_id)) {
            dataByHabit[log.habit_id].push(log);
          }
        });

        setAnalyticsData(dataByHabit);
      } catch (error) {
        console.error('❌ Error fetching analytics:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchAnalytics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedHabits.join(','), availableHabits.length, dateRange?.from?.toISOString(), dateRange?.to?.toISOString()]);

  const toggleHabit = (habitId: string) => {
    setSelectedHabits(prev =>
      prev.includes(habitId)
        ? prev.filter(id => id !== habitId)
        : [...prev, habitId]
    );
  };

  const getHabitCardData = (habitId: string) => {
    const logs = analyticsData[habitId] || [];
    const habit = availableHabits.find((h: HabitData) => h.habit_id === habitId);
    if (!habit) return null;

    // Determine date ranges for comparison
    const now = new Date();
    // Default to last 30 days if no range selected
    const currentTo = dateRange?.to ? startOfDay(dateRange.to) : startOfDay(now);
    const currentFrom = dateRange?.from ? startOfDay(dateRange.from) : startOfDay(subDays(now, 30));

    const durationDays = differenceInDays(currentTo, currentFrom) + 1;

    const prevTo = subDays(currentFrom, 1);
    const prevFrom = subDays(currentFrom, durationDays);

    // Filter logs for current and previous periods
    const currentLogs = logs.filter((log: any) => {
      const d = parseISO(log.date);
      return isWithinInterval(d, { start: currentFrom, end: currentTo });
    });

    const prevLogs = logs.filter((log: any) => {
      const d = parseISO(log.date);
      return isWithinInterval(d, { start: prevFrom, end: prevTo });
    });

    // Process Current Period Data for Chart
    const chartData = currentLogs.map((log: any) => {
      const date = log.date ? parseISO(log.date) : new Date();
      const unitLabel = (habit.unit_type || (habit as any).unit || '').toString();
      const totalDuration = Number(log.total_duration || 0);
      const totalAmount = Number(log.total_amount || 0);
      const completedCount = Number(log.completed_count || 0);

      let value = 0;
      if (unitLabel === 'Hours') {
        if (totalDuration > 0) {
          if (totalDuration <= 1440) {
            value = totalDuration / 60; // minutes → hours
          } else {
            value = totalDuration / 3600; // seconds → hours
          }
        } else if (totalAmount > 0) {
          value = totalAmount;
        } else {
          value = completedCount;
        }
      } else if (unitLabel === 'Minutes') {
        value = totalDuration > 0 ? (totalDuration / 60) : (totalAmount > 0 ? totalAmount : completedCount);
      } else {
        value = totalAmount > 0 ? totalAmount : (totalDuration > 0 ? totalDuration : completedCount);
      }

      return {
        date: format(date, 'MMM dd'),
        shortDate: format(date, 'M/d'),
        value: value,
        time: null,
        notes: null,
        rawDate: date // Keep raw date for sorting if needed
      };
    }).sort((a: any, b: any) => a.rawDate.getTime() - b.rawDate.getTime()); // Ensure chronological order

    // Calculate Averages - per DAY with logs (not per entry or per period)
    const calculateAvg = (periodLogs: any[]) => {
      if (periodLogs.length === 0) return 0;

      // Count unique days with logs in this period
      const uniqueDays = new Set(periodLogs.map((log: any) => log.date || log.period)).size;
      if (uniqueDays === 0) return 0;

      const total = periodLogs.reduce((sum: number, log: any) => {
        const unitLabel = (habit.unit_type || (habit as any).unit || '').toString();
        const totalDuration = Number(log.total_duration || 0);
        const totalAmount = Number(log.total_amount || 0);
        const completedCount = Number(log.completed_count || 0);

        let val = 0;
        if (unitLabel === 'Hours') {
          if (totalDuration > 0) val = totalDuration <= 1440 ? totalDuration / 60 : totalDuration / 3600;
          else if (totalAmount > 0) val = totalAmount;
          else val = completedCount;
        } else if (unitLabel === 'Minutes') {
          val = totalDuration > 0 ? (totalDuration / 60) : (totalAmount > 0 ? totalAmount : completedCount);
        } else {
          val = totalAmount > 0 ? totalAmount : (totalDuration > 0 ? totalDuration : completedCount);
        }
        return sum + val;
      }, 0);

      // Average per day WITH logs (not per entry or per full period)
      return total / uniqueDays;
    };

    // Use Python API stats (single source of truth) if available
    const pythonStats = allHabitStats[habitId];
    
    // Get Tinybird-calculated metrics (includes proper % change calculations!)
    const tbMetrics = tinybirdHabitMetrics[habitId];
    
    // Fall back to local calculation only if Tinybird/Python stats not available
    const localCurrentAvg = calculateAvg(currentLogs);
    const localPreviousAvg = calculateAvg(prevLogs);
    
    // Prefer Python API stats for accuracy
    const currentAvg = pythonStats?.average ?? tbMetrics?.avg_amount ?? localCurrentAvg;
    const totalValue = pythonStats?.total ?? tbMetrics?.total_amount ?? chartData.reduce((sum: number, d: { value: number }) => sum + d.value, 0);
    const daysWithData = pythonStats?.days_with_data ?? tbMetrics?.days_with_data ?? chartData.length;
    
    // Calculate percentage change based on view mode
    const isAllTimeView = !dateRange?.from && !dateRange?.to;
    
    let change = 0;
    let absoluteChange = 0;
    
    // Get Tinybird "progress since start" metrics (first 7 days vs last 7 days)
    const progressData = progressMetrics[habitId];
    
    if (isAllTimeView && progressData) {
      // ALL TIME VIEW: Use Tinybird's "progress since start" calculation!
      // Compares first 7 days of tracking to last 7 days of tracking
      // This shows: "How much have I improved since I started tracking this habit?"
      
      // Determine if this habit uses amount or duration
      // Use amount if there's any amount data, otherwise use duration
      const hasAmountData = (progressData.first_period_avg_amount ?? 0) > 0 || (progressData.last_period_avg_amount ?? 0) > 0;
      
      if (hasAmountData) {
        change = progressData.amount_progress_pct ?? 0;
        absoluteChange = progressData.amount_absolute_change ?? 0;
      } else {
        // Use duration for habits like Sleep, Coding, Morning Workout
        change = progressData.duration_progress_pct ?? 0;
        absoluteChange = progressData.duration_absolute_change ?? 0;
      }
      
      console.log(`📈 Progress for ${habit.habit_name}:`, {
        usesAmount: hasAmountData,
        firstPeriod: hasAmountData ? progressData.first_period_avg_amount : progressData.first_period_avg_duration,
        lastPeriod: hasAmountData ? progressData.last_period_avg_amount : progressData.last_period_avg_duration,
        change: change,
        totalDaysTracked: progressData.total_days_tracked
      });
    } else if (isAllTimeView && tbMetrics) {
      // Fallback: Compare recent performance to overall average
      const recentAvg = tbMetrics.last_7_days_avg ?? 0;
      const overallAvg = tbMetrics.avg_amount ?? 0;
      
      if (overallAvg > 0) {
        change = ((recentAvg - overallAvg) / overallAvg) * 100;
        absoluteChange = recentAvg - overallAvg;
      } else if (recentAvg > 0) {
        change = 100;
      }
    } else {
      // SPECIFIC DATE RANGE: Use Tinybird's week-over-week calculation
      const tinybirdChange = tbMetrics?.weekly_amount_change_pct ?? 0;
      change = tbMetrics ? tinybirdChange : (localPreviousAvg > 0 ? ((localCurrentAvg - localPreviousAvg) / localPreviousAvg * 100) : 0);
      
      const last7Avg = tbMetrics?.last_7_days_avg ?? localCurrentAvg;
      const prev7Avg = tbMetrics?.prev_7_days_avg ?? localPreviousAvg;
      absoluteChange = last7Avg - prev7Avg;
    }

    // Get current value - use appropriate Tinybird metric based on view mode
    // For "All time" view with progress data: show last period average (current performance)
    // Otherwise: show overall average from Tinybird
    let currentValue = 0;
    
    if (isAllTimeView && progressData) {
      // Use last period average from progress data (most recent 7 days performance)
      // Use amount or duration depending on which one has data
      const hasAmountData = (progressData.first_period_avg_amount ?? 0) > 0 || (progressData.last_period_avg_amount ?? 0) > 0;
      currentValue = hasAmountData 
        ? (progressData.last_period_avg_amount ?? 0)
        : (progressData.last_period_avg_duration ?? 0);
    } else {
      // Use Tinybird's overall average
      const tinybirdAvg = tbMetrics?.avg_amount ?? tbMetrics?.last_7_days_avg;
      currentValue = (tinybirdAvg ?? pythonStats?.average ?? localCurrentAvg) || 0;
    }

    return {
      habitName: habit.habit_name,
      currentValue,
      unit: habit.unit_type || (habit as any).unit || 'count',
      change,
      absoluteChange,
      chartData,
      isPositive: change >= 0,
      // Include stats from various sources
      total: totalValue,
      average: currentAvg,
      daysWithData,
      pythonStats,
      tinybirdMetrics: tbMetrics,
      loadingStats: loadingAllStats,
    };
  };

  const getExpandedData = (habitId: string) => {
    const habit = availableHabits.find((h: HabitData) => h.habit_id === habitId);
    if (!habit) return null;

    // Use individual logs from Tinybird (expandedLogs state)
    const logs = expandedLogs || [];
    
    // Deduplicate logs by ID (handle Tinybird duplicates)
    const uniqueLogs = logs.reduce((acc: any[], log: any) => {
      // Check if this log ID already exists
      const existingIndex = acc.findIndex((l: any) => l.id === log.id);
      if (existingIndex >= 0) {
        // If duplicate found, prefer the one with metadata
        if (log.metadata && log.metadata !== '{}' && (!acc[existingIndex].metadata || acc[existingIndex].metadata === '{}')) {
          acc[existingIndex] = log; // Replace with the one that has metadata
        }
        // Otherwise keep the existing one (first occurrence)
      } else {
        // Not a duplicate, add it
        acc.push(log);
      }
      return acc;
    }, []);
    
    // Group logs by date for chart display
    const logsByDate = uniqueLogs.reduce((acc: any, log: any) => {
      if (!acc[log.date]) {
        acc[log.date] = [];
      }
      acc[log.date].push(log);
      return acc;
    }, {});

    // Create chart data (aggregated by date)
    const chartData = Object.keys(logsByDate)
      .map(dateStr => {
        const date = parseISO(dateStr);
        const dayLogs = logsByDate[dateStr];
        const unitLabel = (habit.unit_type || (habit as any).unit || '').toString();

        // Sum up all logs for this date
        let totalValue = 0;
        dayLogs.forEach((log: any) => {
          const duration = Number(log.duration || 0);
          const amount = Number(log.amount || 0);

          if (unitLabel === 'Hours') {
            if (duration > 0) {
              // Duration is stored in seconds
              totalValue += duration / 3600;
            } else if (amount > 0) {
              totalValue += amount;
            }
          } else if (unitLabel === 'Minutes') {
            if (duration > 0) {
              totalValue += duration / 60;
            } else if (amount > 0) {
              totalValue += amount;
            }
          } else {
            totalValue += amount > 0 ? amount : (duration > 0 ? 1 : 0);
          }
        });

        // Parse metadata for sleep start/end times (for Whoop sleep logs)
        // Prioritize logs with non-empty metadata (in case of duplicates)
        let sleepOnset = null;
        let sleepEnd = null;
        const logWithMetadata = dayLogs.find((log: any) => 
          log.metadata && log.metadata !== '{}' && log.metadata !== '{}'
        ) || dayLogs[0];
        
        if (logWithMetadata?.metadata) {
          try {
            const metadata = typeof logWithMetadata.metadata === 'string' 
              ? JSON.parse(logWithMetadata.metadata) 
              : logWithMetadata.metadata;
            sleepOnset = metadata.sleep_onset || null;
            sleepEnd = metadata.sleep_end || null;
          } catch (e) {
            // Ignore parsing errors
          }
        }

        return {
          date: format(date, 'MMM dd'),
          shortDate: format(date, 'M/d'),
          value: totalValue,
          time: dayLogs[0]?.timestamp || null,
          notes: dayLogs.map((l: any) => l.notes).filter((n: any) => n && n !== 'none').join('; ') || null,
          sleepOnset,
          sleepEnd,
          rawDate: date,
          logCount: dayLogs.length
        };
      })
      .sort((a, b) => a.rawDate.getTime() - b.rawDate.getTime());

    // Use Python API stats (single source of truth) if available
    // Otherwise fall back to local calculation
    const totalValue = expandedStats?.total ?? chartData.reduce((sum, d) => sum + d.value, 0);
    const avgValue = expandedStats?.average ?? (chartData.length > 0 ? totalValue / chartData.length : 0);
    const daysWithData = expandedStats?.days_with_data ?? chartData.length;

    // Calculate change (compare first half vs second half of period)
    const midpoint = Math.floor(chartData.length / 2);
    const firstHalf = chartData.slice(0, midpoint);
    const secondHalf = chartData.slice(midpoint);
    
    const firstHalfAvg = firstHalf.length > 0 ? firstHalf.reduce((sum, d) => sum + d.value, 0) / firstHalf.length : 0;
    const secondHalfAvg = secondHalf.length > 0 ? secondHalf.reduce((sum, d) => sum + d.value, 0) / secondHalf.length : 0;
    
    const change = firstHalfAvg > 0 ? ((secondHalfAvg - firstHalfAvg) / firstHalfAvg * 100) : 0;

    // Calculate min, max, and variance
    const values = chartData.map(d => d.value);
    const minValue = values.length > 0 ? Math.min(...values) : 0;
    const maxValue = values.length > 0 ? Math.max(...values) : 0;
    
    // Calculate variance: avg of squared differences from mean
    const variance = values.length > 0 
      ? values.reduce((sum, val) => sum + Math.pow(val - avgValue, 2), 0) / values.length 
      : 0;

    return {
      habit,
      chartData,
      totalValue,
      avgValue,
      minValue,
      maxValue,
      variance,
      daysWithData,
      change,
      isPositive: change >= 0,
      individualLogs: uniqueLogs, // ✅ Include deduplicated individual logs for detailed display
      // Include Python API stats for display
      pythonStats: expandedStats,
      loadingStats: loadingExpandedStats,
    };
  };

  // Export to CSV function

  // Show loading skeleton while habits are loading
  // Check for actual data content, not just isLoading (which can be false with stale cache)
  const hasValidHabitData = availableHabits.length > 0 && availableHabits[0]?.habit_id;
  
  if (!hasValidHabitData) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-end mb-6">
          <div className="h-10 w-64 rounded animate-shimmer bg-[length:200%_100%] bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="border border-gray-200 p-4 h-40 animate-shimmer bg-[length:200%_100%] bg-gradient-to-r from-gray-100 via-gray-50 to-gray-100" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Top Bar: View Toggle (left), Date Range Picker (right) */}
      <div className="flex items-center justify-between mb-6">
        {/* Left Side: View Toggle */}
        <div className="flex items-center gap-3">
          <AnalyticsViewToggle
            currentView={viewMode}
            onViewChange={setViewMode}
            darkMode={false}
          />
          
          {/* Habit Filter Dropdown - Optional filtering */}
          <div className="relative">
            <button
              id="habit-dropdown-button"
              onClick={() => setHabitDropdownOpen(!habitDropdownOpen)}
              className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 text-sm text-gray-600 hover:bg-[#F3F3F3] transition-colors"
            >
              <span>
                {selectedHabits.length === availableHabits.length
                  ? 'All habits'
                  : `${selectedHabits.length} of ${availableHabits.length}`
                }
              </span>
              <ChevronDown className={`w-4 h-4 transition-transform ${habitDropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {habitDropdownOpen && (
              <>
                <div
                  className="fixed inset-0"
                  style={{ zIndex: 999 }}
                  onClick={() => setHabitDropdownOpen(false)}
                />
                <div
                  className="fixed bg-white border border-gray-300 shadow-xl max-h-[400px] overflow-y-auto"
                  style={{
                    zIndex: 1000,
                    top: typeof window !== 'undefined'
                      ? (document.getElementById('habit-dropdown-button')?.getBoundingClientRect().bottom || 0) + 4 + window.scrollY
                      : 0,
                    left: typeof window !== 'undefined'
                      ? document.getElementById('habit-dropdown-button')?.getBoundingClientRect().left || 0
                      : 0,
                    width: '220px'
                  }}
                >
                  <div className="p-1">
                    {/* Select All / Deselect All */}
                    <button
                      onClick={() => {
                        if (selectedHabits.length === availableHabits.length) {
                          setSelectedHabits([]);
                        } else {
                          setSelectedHabits(availableHabits.map((h: HabitData) => h.habit_id));
                        }
                      }}
                      className="w-full text-left px-3 py-2 text-sm text-gray-600 hover:bg-[#F3F3F3] border-b border-gray-200"
                    >
                      {selectedHabits.length === availableHabits.length ? 'Deselect all' : 'Select all'}
                    </button>
                    {availableHabits.map((habit: HabitData) => (
                      <label
                        key={habit.habit_id}
                        className="flex items-center gap-2.5 px-3 py-2 hover:bg-[#F3F3F3] cursor-pointer transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={selectedHabits.includes(habit.habit_id)}
                          onChange={() => toggleHabit(habit.habit_id)}
                          className="analytics-checkbox"
                        />
                        <span className="text-sm text-gray-900">{habit.habit_name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Date Range Picker - Top Right */}
        <DateRangePicker
          className="w-auto"
          onDateRangeChange={setDateRange}
          initialDateRange={dateRange}
        />
      </div>

      {/* Habit Metrics Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="h-64 border border-gray-300 animate-shimmer bg-[length:200%_100%] bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200"></div>
          ))}
        </div>
      ) : availableHabits.length === 0 ? (
        <div className="bg-white border border-gray-300 p-12 text-center">
          <div className="max-w-md mx-auto">
            <p className="text-lg font-medium text-gray-900 mb-2">No habits found</p>
            <p className="text-sm text-gray-600 mb-4">
              Start tracking habits to see analytics here.
            </p>
          </div>
        </div>
      ) : selectedHabits.length > 0 || availableHabits.length > 0 ? (
        <>
          {/* Render based on view mode */}
          {(() => {
            // Use selectedHabits if it has valid IDs, otherwise fallback to availableHabits
            // This handles the case where selectedHabits has items but they're all undefined
            const validSelectedHabits = selectedHabits.filter((id: string): id is string => !!id);
            const habitsToShow = validSelectedHabits.length > 0 
              ? validSelectedHabits 
              : availableHabits.map((h: HabitData) => h.habit_id).filter((id: string): id is string => !!id);
            
            if (viewMode === 'chart') {
              return (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {habitsToShow.map((habitId: string) => {
                    const cardData = getHabitCardData(habitId);
                    if (!cardData) return null;

                    return (
                      <HabitMetricCard
                        key={habitId}
                        {...cardData}
                        onClick={() => setExpandedHabit(expandedHabit === habitId ? null : habitId)}
                        onRemove={() => {
                          setSelectedHabits(prev => prev.filter((id: string) => id !== habitId));
                          if (expandedHabit === habitId) {
                            setExpandedHabit(null);
                          }
                        }}
                      />
                    );
                  })}
                </div>
              );
            } else {
              // Build habit data, using available habits directly as fallback
              const tickerHabits = habitsToShow.map((habitId: string) => {
                const cardData = getHabitCardData(habitId);
                const habit = availableHabits.find((h: HabitData) => h.habit_id === habitId);
                
                // If we have the habit but no card data yet (loading), show it anyway with defaults
                if (habit && !cardData) {
                  return {
                    habit_id: habitId,
                    habit_name: habit.habit_name || 'Unknown',
                    category: habit.category || '',
                    unit: habit.unit_type || 'count',
                    last_7_days_avg: 0,
                    prev_7_days_avg: 0,
                    weekly_amount_change_pct: 0,
                    chartData: [],
                  };
                }
                
                if (!cardData || !habit) return null;

                return {
                  habit_id: habitId,
                  habit_name: cardData.habitName || habit.habit_name || 'Unknown',
                  category: habit.category || '',
                  unit: cardData.unit || habit.unit_type || 'count',
                  last_7_days_avg: cardData.currentValue || 0,
                  prev_7_days_avg: cardData.change !== 0 
                    ? cardData.currentValue - (cardData.change / 100 * cardData.currentValue) 
                    : cardData.currentValue,
                  weekly_amount_change_pct: cardData.change || 0,
                  chartData: (cardData.chartData || []).map((d: ChartDataPoint) => ({ value: d.value || 0 })),
                };
              }).filter((item: { habit_id: string; habit_name: string; category: string; unit: string; last_7_days_avg: number; prev_7_days_avg: number; weekly_amount_change_pct: number; chartData: { value: number }[] } | null): item is NonNullable<typeof item> => item !== null);

              // Debug: log what we're passing (can remove later)
              if (tickerHabits.length === 0) {
                console.log(`📊 Ticker: habitsToShow=${habitsToShow.length}, tickerHabits=0, selectedValid=${validSelectedHabits.length}`);
              }

              return (
                <HabitTickerGrid
                  habits={tickerHabits}
                  onHabitClick={(habitId) => setExpandedHabit(expandedHabit === habitId ? null : habitId)}
                  onHabitRemove={(habitId) => {
                    setSelectedHabits(prev => prev.filter(id => id !== habitId));
                    if (expandedHabit === habitId) {
                      setExpandedHabit(null);
                    }
                  }}
                  darkMode={false}
                />
              );
            }
          })()}

          {/* Expanded View - Now with Individual Log Details from Tinybird! */}
          {expandedHabit && (
            <div className="mt-4 bg-[#FAFAF9] border border-gray-300 p-4">
              {loadingExpandedLogs ? (
                <div className="flex items-center justify-center h-[300px]">
                  <div className="text-center">
                    <div className="w-8 h-8 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin mx-auto mb-2"></div>
                    <p className="text-sm text-gray-500">Loading detailed logs from Tinybird...</p>
                  </div>
                </div>
              ) : (() => {
                const expandedData = getExpandedData(expandedHabit);
                if (!expandedData) return null;

                const { habit, chartData, totalValue, avgValue, minValue, maxValue, variance } = expandedData;

                return (
                  <>
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h3 className="text-lg font-medium text-gray-900">{habit.habit_name}</h3>
                        <p className="text-xs text-gray-500 mt-0.5">
                          Detailed metrics · Powered by Tinybird
                        </p>
                      </div>
                      <button
                        onClick={() => setExpandedHabit(null)}
                        className="p-1.5 hover:bg-[#F3F3F3] transition-colors"
                      >
                        <X className="w-4 h-4 text-gray-600" />
                      </button>
                    </div>

                    <div className="grid grid-cols-5 gap-2 mb-3">
                      <div className="border border-gray-300 px-2.5 py-2">
                        <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-0.5">Total</p>
                        <p className="text-base font-medium text-gray-900 tabular-nums">{totalValue.toFixed(1)}</p>
                      </div>
                      <div className="border border-gray-300 px-2.5 py-2">
                        <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-0.5">Average</p>
                        <p className="text-base font-medium text-gray-900 tabular-nums">{avgValue.toFixed(1)}</p>
                      </div>
                      <div className="border border-gray-300 px-2.5 py-2">
                        <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-0.5">Minimum</p>
                        <p className="text-base font-medium text-gray-900 tabular-nums">{minValue.toFixed(1)}</p>
                      </div>
                      <div className="border border-gray-300 px-2.5 py-2">
                        <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-0.5">Maximum</p>
                        <p className="text-base font-medium text-gray-900 tabular-nums">{maxValue.toFixed(1)}</p>
                      </div>
                      <div className="border border-gray-300 px-2.5 py-2">
                        <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-0.5">Variance</p>
                        <p className="text-base font-medium text-gray-900 tabular-nums">{variance.toFixed(2)}</p>
                      </div>
                    </div>

                    <Suspense fallback={
                      <div className="flex items-center justify-center h-[250px]">
                        <div className="w-6 h-6 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin"></div>
                      </div>
                    }>
                      <ResponsiveContainer width="100%" height={250}>
                        {viewMode === 'chart' ? (
                          <BarChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gray[200]} vertical={false} />
                            <XAxis
                              dataKey="shortDate"
                              stroke={COLORS.gray[400]}
                              tick={{ fill: COLORS.gray[600], fontSize: 12 }}
                              axisLine={{ stroke: COLORS.gray[300] }}
                              label={{ value: 'Date', position: 'insideBottom', offset: -5, style: { fill: COLORS.gray[600], fontSize: 12 } }}
                            />
                            <YAxis
                              stroke={COLORS.gray[400]}
                              tick={{ fill: COLORS.gray[600], fontSize: 12 }}
                              axisLine={{ stroke: COLORS.gray[300] }}
                              label={{ value: habit.unit_type || (habit as any).unit || 'Value', angle: -90, position: 'insideLeft', style: { fill: COLORS.gray[600], fontSize: 12 } }}
                            />
                            <Tooltip content={<CustomTooltip />} />
                            <Bar
                              dataKey="value"
                              fill="#4A4A4C"
                              radius={[0, 0, 0, 0]}
                              isAnimationActive={false}
                              name={habit.unit_type || (habit as any).unit || 'Value'}
                            />
                          </BarChart>
                        ) : (
                          <AreaChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                            <defs>
                              <linearGradient id={`gradient-expanded-${expandedHabit}`} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#4A4A4C" stopOpacity={0.25} />
                                <stop offset="100%" stopColor="#4A4A4C" stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gray[200]} vertical={false} />
                            <XAxis
                              dataKey="shortDate"
                              stroke={COLORS.gray[400]}
                              tick={{ fill: COLORS.gray[600], fontSize: 12 }}
                              axisLine={{ stroke: COLORS.gray[300] }}
                              label={{ value: 'Date', position: 'insideBottom', offset: -5, style: { fill: COLORS.gray[600], fontSize: 12 } }}
                            />
                            <YAxis
                              stroke={COLORS.gray[400]}
                              tick={{ fill: COLORS.gray[600], fontSize: 12 }}
                              axisLine={{ stroke: COLORS.gray[300] }}
                              label={{ value: habit.unit_type || (habit as any).unit || 'Value', angle: -90, position: 'insideLeft', style: { fill: COLORS.gray[600], fontSize: 12 } }}
                            />
                            <Tooltip content={<CustomTooltip />} />
                            <Area
                              type="monotone"
                              dataKey="value"
                              stroke="#4A4A4C"
                              strokeWidth={2}
                              fill={`url(#gradient-expanded-${expandedHabit})`}
                              name={habit.unit_type || (habit as any).unit || 'Value'}
                            />
                          </AreaChart>
                        )}
                      </ResponsiveContainer>
                    </Suspense>
                  </>
                );
              })()}
            </div>
          )}
        </>
      ) : null}
    </>
  );
}



