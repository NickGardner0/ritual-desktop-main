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
import { format, parseISO, startOfDay } from 'date-fns';
import { HabitTickerGrid, AnalyticsViewToggle } from '@/components/analytics/habit-ticker-view';

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

interface MetricSummaryCardProps {
  label: string;
  value: string | number;
  subtitle: string;
  trend?: {
    value: number;
    isPositive: boolean;
  };
}

const MetricSummaryCard: React.FC<MetricSummaryCardProps> = ({ 
  label, 
  value, 
  subtitle, 
  trend
}) => {
  return (
    <div className="bg-white border border-gray-300 p-4 hover:bg-[#F3F3F3] transition-colors">
      <div className="flex items-start justify-between mb-1.5">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      </div>
      <div className="mb-1">
        <p className="text-2xl font-bold text-gray-900">{value}</p>
      </div>
      <div className="flex items-center gap-2">
        <p className="text-xs text-gray-500">{subtitle}</p>
        {trend && (
          <span className={`text-xs font-medium ${trend.isPositive ? 'text-green-600' : 'text-red-600'}`}>
            {trend.isPositive ? '↑' : '↓'} {Math.abs(trend.value)}%
          </span>
        )}
      </div>
    </div>
  );
};

interface HabitMetricCardProps {
  habitName: string;
  currentValue: number;
  unit: string;
  change?: number;
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
  chartData,
  isPositive,
  onClick,
  onRemove
}) => {
  const trendColor = isPositive ? COLORS.success : COLORS.danger;
  const TrendIcon = isPositive ? TrendingUp : TrendingDown;
  const safeId = habitName.replace(/[^a-zA-Z0-9]/g, '_');
  
  return (
    <div 
      className="group relative bg-white border border-gray-300 p-3 hover:bg-[#F3F3F3] hover:shadow-md transition-all duration-200 cursor-pointer"
      onClick={onClick}
    >
      {/* Close Button - Subtle, appears on hover */}
      {onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation(); // Prevent card click
            onRemove();
          }}
          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 p-1 hover:bg-gray-100"
          aria-label="Remove habit"
        >
          <X className="w-3.5 h-3.5 text-gray-400 hover:text-gray-600" />
        </button>
      )}
      
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {change !== undefined && Math.abs(change) > 0 && (
            <div className="flex items-center gap-0.5 flex-shrink-0" style={{ color: trendColor }}>
              <TrendIcon className="w-3.5 h-3.5" />
            </div>
          )}
          <span className="text-sm font-medium text-gray-900 truncate">{habitName}</span>
        </div>
      </div>
      
      <div className="mb-2">
        <div className="flex items-baseline gap-1.5">
          <span className="text-xl font-bold text-gray-900">
            {currentValue.toFixed(currentValue < 10 ? 1 : 0)}
          </span>
          <span className="text-xs text-gray-500">{unit}</span>
        </div>
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
                        <div className="bg-white/85 backdrop-blur-[12px] text-gray-900 px-3 py-2 text-xs shadow-lg border border-gray-200/50 rounded-md">
                          <p className="font-semibold mb-1">{data.date}</p>
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
                  fill="#2e2d2a"
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
    return (
      <div className="bg-white/85 backdrop-blur-[12px] text-gray-900 px-4 py-3 shadow-xl border border-gray-200/50 rounded-md">
        <p className="text-sm font-semibold mb-2">{label}</p>
        {payload.map((entry: any, index: number) => (
          <div key={index} className="mb-2">
            <div className="flex items-center justify-between gap-4 mb-1">
              <span className="text-xs">{entry.name}:</span>
              <span className="text-sm font-semibold">
                {typeof entry.value === 'number' ? entry.value.toFixed(1) : entry.value}
              </span>
            </div>
            {data.time && <p className="text-xs text-gray-500">Time: {data.time}</p>}
            {data.notes && <p className="text-xs text-gray-600 mt-1 italic">{data.notes}</p>}
          </div>
        ))}
      </div>
    );
  }
  return null;
};

// ================================
// MAIN CLIENT COMPONENT
// ================================

/**
 * Fetch analytics data with React Query (cached for instant navigation!)
 */
function useAnalyticsSummary() {
  const { user } = useUser();
  const { getToken } = useAuth();
  
  return useQuery({
    queryKey: ['analytics-summary', user?.id],
    queryFn: async () => {
      const token = await getToken();
      const backendUrl = process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';
      
      // Fetch habits and logs in parallel
      const [habitsRes, logsRes] = await Promise.all([
        fetch(`${backendUrl}/api/habits`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch(`${backendUrl}/api/habit-logs`, {
          headers: { 'Authorization': `Bearer ${token}` }
        })
      ]);
      
      if (!habitsRes.ok || !logsRes.ok) {
        throw new Error('Failed to fetch analytics data');
      }
      
      const habits = await habitsRes.json();
      const logs = await logsRes.json();
      
      console.log('✅ [Analytics Query] Raw backend response:', {
        habitsCount: habits.length,
        logsCount: logs.length,
        timestamp: new Date().toLocaleTimeString()
      });
      
      // Transform habits to match expected format (id → habit_id, name → habit_name)
      const transformedHabits = habits.map((h: any) => ({
        habit_id: h.id,
        habit_name: h.name,
        category: h.category,
        icon: h.icon,
        unit_type: h.unit_type,
        // Keep original fields too for compatibility
        ...h
      }));
      
      // Calculate meaningful summary metrics for the last 30 days
      const now = new Date();
      const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
      const last30Logs = logs.filter((log: any) => {
        if (!log?.date) return false;
        const d = parseISO(log.date);
        return now.getTime() - d.getTime() <= THIRTY_DAYS_MS;
      });

      // Active days in last 30 days (at least one entry)
      const dayKey = (d: Date) => format(startOfDay(d), 'yyyy-MM-dd');
      const activeDaySet = new Set<string>();
      last30Logs.forEach((l: any) => {
        try {
          activeDaySet.add(dayKey(parseISO(l.date)));
        } catch {}
      });
      const activeDays30 = activeDaySet.size;

      // Average entries per day (over full 30d window)
      const avgEntriesPerDay30 = +(last30Logs.length / 30).toFixed(1);

      // Current streak (consecutive days up to today with at least one entry)
      let currentStreakDays = 0;
      for (let i = 0; i < 365; i++) {
        const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
        if (activeDaySet.has(dayKey(d))) {
          currentStreakDays++;
        } else {
          // Break on first gap, unless i === 0 and today has no logs, then streak is 0
          break;
        }
      }

      // Most consistent habit in last 30 days (logged on the most distinct days)
      const habitIdToDays = new Map<string, Set<string>>();
      last30Logs.forEach((l: any) => {
        const key = dayKey(parseISO(l.date));
        const hid = l.habit_id || l.habitId || l.habit?.id;
        if (!hid) return;
        if (!habitIdToDays.has(hid)) habitIdToDays.set(hid, new Set());
        habitIdToDays.get(hid)!.add(key);
      });
      let mostConsistentHabit: { name: string; days: number; pct: number } | null = null;
      for (const [hid, days] of habitIdToDays.entries()) {
        const h = transformedHabits.find((x: any) => x.habit_id === hid);
        const daysCount = days.size;
        const pct = Math.round((daysCount / 30) * 100);
        if (!mostConsistentHabit || daysCount > mostConsistentHabit.days) {
          mostConsistentHabit = { name: h?.habit_name || 'Unknown', days: daysCount, pct };
        }
      }
      
      return {
        habits: transformedHabits,
        summaryMetrics: {
          activeDays30,
          avgEntriesPerDay30,
          currentStreakDays,
          mostConsistentHabit
        }
      };
    },
    staleTime: 0, // No caching - always fetch fresh data to ensure counts update immediately!
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
  const [selectedHabits, setSelectedHabits] = useState<string[]>([]);
  const [habitDropdownOpen, setHabitDropdownOpen] = useState(false);
  const [analyticsData, setAnalyticsData] = useState<any>({});
  const [expandedHabit, setExpandedHabit] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'chart' | 'ticker'>('chart');
  
  const availableHabits = data?.habits || [];
  const summaryMetrics = data?.summaryMetrics;
  
  // Force refetch on mount to ensure fresh data
  useEffect(() => {
    refetch();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount
  
  // Show loading on first fetch only
  if (isLoading && !data) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-end mb-6">
          <div className="h-10 w-64 bg-gray-200 animate-pulse rounded" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => (
            <div key={i} className="bg-white border border-gray-300 p-5 h-24 animate-pulse" />
          ))}
        </div>
        <div className="h-64 bg-white border border-gray-300 animate-pulse" />
      </div>
    );
  }
  
  // Fetch analytics data when habits are selected
  useEffect(() => {
    if (selectedHabits.length === 0) {
      setLoading(false);
      return;
    }

    const fetchAnalytics = async () => {
      setLoading(true);
      try {
        let daysBack = 30;
        if (dateRange?.from) {
          const now = new Date();
          const fromDate = dateRange.from;
          daysBack = Math.ceil((now.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24));
          daysBack = Math.max(1, daysBack);
        }

        const logsRes = await fetch(
          `/api/analytics/habits/trends?period=day&days_back=${daysBack}`
        );
        const response = await logsRes.json();
        const allLogs = response.data || [];

        const dataByHabit: any = {};
        selectedHabits.forEach(habitId => {
          dataByHabit[habitId] = [];
        });

        allLogs.forEach((log: any) => {
          if (selectedHabits.includes(log.habit_id)) {
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
  }, [selectedHabits, dateRange, availableHabits]);

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
    
    if (logs.length === 0) {
      return {
        habitName: habit.habit_name,
        currentValue: 0,
        unit: habit.unit_type || (habit as any).unit || 'count',
        change: 0,
        chartData: [],
        isPositive: true
      };
    }

    const chartData = logs.map((log: any) => {
      const date = log.date ? parseISO(log.date) : new Date();
      const unitLabel = (habit.unit_type || (habit as any).unit || '').toString();
      const totalDuration = Number(log.total_duration || 0);
      const totalAmount = Number(log.total_amount || 0);
      const completedCount = Number(log.completed_count || 0);

      let value = 0;
      if (unitLabel === 'Hours') {
        if (totalDuration > 0) {
          // Heuristic: durations <= 1440 are minutes; larger values are seconds
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
        notes: null
      };
    }).reverse();

    const currentValue = chartData.length > 0 ? chartData[chartData.length - 1].value : 0;
    const recent = chartData.slice(-7);
    const previous = chartData.slice(-14, -7);
    const recentAvg = recent.reduce((sum: number, d: any) => sum + d.value, 0) / (recent.length || 1);
    const previousAvg = previous.reduce((sum: number, d: any) => sum + d.value, 0) / (previous.length || 1);
    const change = previousAvg > 0 ? ((recentAvg - previousAvg) / previousAvg * 100) : 0;

    return {
      habitName: habit.habit_name,
      currentValue,
      unit: habit.unit_type || (habit as any).unit || 'count',
      change,
      chartData,
      isPositive: change >= 0
    };
  };

  const getExpandedData = (habitId: string) => {
    const logs = analyticsData[habitId] || [];
    const habit = availableHabits.find((h: HabitData) => h.habit_id === habitId);
    if (!habit) return null;
    
    if (logs.length === 0) {
      return {
        habit,
        chartData: [],
        totalValue: 0,
        avgValue: 0,
        change: 0,
        isPositive: true
      };
    }

    const chartData = logs.map((log: any) => {
      const date = log.date ? parseISO(log.date) : new Date();
      const unitLabel = (habit.unit_type || (habit as any).unit || '').toString();
      const totalDuration = Number(log.total_duration || 0);
      const totalAmount = Number(log.total_amount || 0);
      const completedCount = Number(log.completed_count || 0);

      let value = 0;
      if (unitLabel === 'Hours') {
        if (totalDuration > 0) {
          if (totalDuration <= 1440) {
            value = totalDuration / 60;
          } else {
            value = totalDuration / 3600;
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
        notes: null
      };
    }).reverse();

    const totalValue = chartData.reduce((sum: number, d: any) => sum + d.value, 0);
    const avgValue = chartData.length > 0 ? totalValue / chartData.length : 0;
    const recent = chartData.slice(-7);
    const previous = chartData.slice(-14, -7);
    const recentAvg = recent.reduce((sum: number, d: any) => sum + d.value, 0) / (recent.length || 1);
    const previousAvg = previous.reduce((sum: number, d: any) => sum + d.value, 0) / (previous.length || 1);
    const change = previousAvg > 0 ? ((recentAvg - previousAvg) / previousAvg * 100) : 0;

    return {
      habit,
      chartData,
      totalValue,
      avgValue,
      change,
      isPositive: change >= 0
    };
  };

  return (
    <>
      {/* Top Bar: Habit Dropdown + View Toggle (left), Date Range Picker (right) */}
      <div className="flex items-center justify-between mb-5">
        {/* Left Side: Habit Multi-Select Dropdown + View Toggle */}
        <div className="flex items-end gap-3">
          {/* Habit Multi-Select Dropdown */}
          <div className="relative">
            <label className="block text-xs font-medium text-gray-600 uppercase tracking-wide mb-2">
              Select
            </label>
            <div className="relative">
              <button
                id="habit-dropdown-button"
                onClick={() => setHabitDropdownOpen(!habitDropdownOpen)}
                className="w-full md:w-auto min-w-[280px] flex items-center justify-between gap-3 px-4 py-2.5 bg-white border border-gray-300 text-sm text-gray-700 hover:bg-[#F3F3F3] transition-colors"
              >
                <span className="text-sm">
                  {selectedHabits.length === 0 
                    ? 'Select...' 
                    : `${selectedHabits.length} habit${selectedHabits.length > 1 ? 's' : ''} selected`
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
                    width: typeof window !== 'undefined'
                      ? document.getElementById('habit-dropdown-button')?.offsetWidth || 280
                      : 280
                  }}
                >
                  <div className="p-1">
                    {availableHabits.length === 0 ? (
                      <div className="px-4 py-3 text-sm text-gray-500 text-center">
                        No habits found
                      </div>
                    ) : (
                      availableHabits.map((habit: HabitData) => (
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
                      ))
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
          </div>
          
          {/* View Toggle - Next to Select */}
          <div className="relative">
            <label className="block text-xs font-medium text-gray-600 uppercase tracking-wide mb-2">
              View
            </label>
            <AnalyticsViewToggle
              currentView={viewMode}
              onViewChange={setViewMode}
              darkMode={false}
            />
          </div>
        </div>
        
        {/* Date Range Picker - Top Right */}
        <div className="flex items-center">
          <DateRangePicker 
            className="w-auto"
            onDateRangeChange={setDateRange}
            initialDateRange={dateRange}
          />
        </div>
      </div>

      {/* Summary Metrics Cards */}
      {summaryMetrics && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <MetricSummaryCard
            label="Active Days (30d)"
            value={summaryMetrics.activeDays30}
            subtitle="days with at least one entry"
          />
          <MetricSummaryCard
            label="Avg Entries/Day (30d)"
            value={summaryMetrics.avgEntriesPerDay30}
            subtitle="average logs per day"
          />
          <MetricSummaryCard
            label="Current Streak"
            value={`${summaryMetrics.currentStreakDays} day${summaryMetrics.currentStreakDays === 1 ? '' : 's'}`}
            subtitle="consecutive days of activity"
          />
          <MetricSummaryCard
            label="Most Consistent (30d)"
            value={summaryMetrics.mostConsistentHabit ? `${summaryMetrics.mostConsistentHabit.pct}%` : 'N/A'}
            subtitle={summaryMetrics.mostConsistentHabit ? summaryMetrics.mostConsistentHabit.name : 'No data yet'}
          />
        </div>
      )}

      {/* Habit Metrics Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="h-64 bg-white border border-gray-300 animate-pulse"></div>
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
      ) : selectedHabits.length > 0 ? (
        <>
          {/* Render based on view mode */}
          {viewMode === 'chart' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {selectedHabits.map((habitId) => {
                const cardData = getHabitCardData(habitId);
                if (!cardData) return null;

                return (
                  <HabitMetricCard
                    key={habitId}
                    {...cardData}
                    onClick={() => setExpandedHabit(expandedHabit === habitId ? null : habitId)}
                    onRemove={() => {
                      setSelectedHabits(prev => prev.filter(id => id !== habitId));
                      if (expandedHabit === habitId) {
                        setExpandedHabit(null);
                      }
                    }}
                  />
                );
              })}
            </div>
          ) : (
            <HabitTickerGrid
              habits={selectedHabits.map((habitId) => {
                const cardData = getHabitCardData(habitId);
                const habit = availableHabits.find((h: HabitData) => h.habit_id === habitId);
                if (!cardData || !habit) return null;

                return {
                  habit_id: habitId,
                  habit_name: cardData.habitName,
                  category: habit.category,
                  unit: cardData.unit,
                  last_7_days_avg: cardData.currentValue,
                  prev_7_days_avg: cardData.currentValue - (cardData.change / 100 * cardData.currentValue),
                  weekly_amount_change_pct: cardData.change,
                  chartData: cardData.chartData.map((d: ChartDataPoint) => ({ value: d.value })),
                };
              }).filter(Boolean) as any}
              onHabitClick={(habitId) => setExpandedHabit(expandedHabit === habitId ? null : habitId)}
              onHabitRemove={(habitId) => {
                setSelectedHabits(prev => prev.filter(id => id !== habitId));
                if (expandedHabit === habitId) {
                  setExpandedHabit(null);
                }
              }}
              darkMode={false}
            />
          )}

          {/* Expanded View */}
          {expandedHabit && (
            <div className="mt-4 bg-white border border-gray-300 p-4">
              {(() => {
                const expandedData = getExpandedData(expandedHabit);
                if (!expandedData) return null;

                const { habit, chartData, totalValue, avgValue, change, isPositive } = expandedData;
                // Use same colors as ticker view
                const emeraldGreen = '#059669'; // Darker emerald green (Tailwind emerald-600)
                const darkRed = '#822503';
                const trendColor = isPositive ? emeraldGreen : darkRed;

                return (
                  <>
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="text-lg font-bold text-gray-900">{habit.habit_name}</h3>
                        <p className="text-sm text-gray-500 mt-0.5">Detailed metrics over time</p>
                      </div>
                      <button
                        onClick={() => setExpandedHabit(null)}
                        className="p-2 hover:bg-[#F3F3F3] transition-colors"
                      >
                        <X className="w-5 h-5 text-gray-600" />
                      </button>
                    </div>

                    <div className="grid grid-cols-3 gap-3 mb-4">
                      <div className="border border-gray-200 p-3">
                        <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Total</p>
                        <p className="text-xl font-bold text-gray-900">{totalValue.toFixed(1)}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{habit.unit_type || (habit as any).unit || 'count'}</p>
                      </div>
                      <div className="border border-gray-200 p-3">
                        <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Average</p>
                        <p className="text-xl font-bold text-gray-900">{avgValue.toFixed(1)}</p>
                        <p className="text-xs text-gray-500 mt-0.5">per day</p>
                      </div>
                      <div className="border border-gray-200 p-3">
                        <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">7-Day Change</p>
                        <p className="text-xl font-bold" style={{ color: trendColor }}>
                          {change > 0 ? '+' : ''}{change.toFixed(0)}%
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5">vs previous</p>
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
                              fill="#2e2d2a"
                              radius={[0, 0, 0, 0]}
                              isAnimationActive={false}
                            name={habit.unit_type || (habit as any).unit || 'Value'}
                            />
                          </BarChart>
                        ) : (
                          <AreaChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                            <defs>
                              <linearGradient id={`gradient-expanded-${expandedHabit}`} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={trendColor} stopOpacity={0.25}/>
                                <stop offset="100%" stopColor={trendColor} stopOpacity={0}/>
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
                              stroke={trendColor}
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

