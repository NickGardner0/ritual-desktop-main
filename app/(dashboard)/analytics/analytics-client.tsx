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
      <div className="bg-white/80 backdrop-blur-xl border border-gray-200/50 shadow-xl rounded-lg p-2.5 min-w-[180px]">
        <p className="text-xs font-semibold text-gray-900 mb-1.5">{label}</p>
        <div className="space-y-1 text-xs">
          {/* Value */}
          <div className="flex items-center justify-between gap-3">
            <span className="text-gray-700 font-medium">{payload[0].name}</span>
            <span className="text-gray-900 font-semibold tabular-nums">
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
                {data.time}
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

      // Fetch habits and summary metrics in parallel (now using Tinybird!)
      const [habitsRes, summaryRes] = await Promise.all([
        fetch(`${backendUrl}/api/habits`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch('/api/analytics/summary') // ✅ Tinybird-powered!
      ]);

      if (!habitsRes.ok || !summaryRes.ok) {
        throw new Error('Failed to fetch analytics data');
      }

      const habits = await habitsRes.json();
      const summaryData = await summaryRes.json();

      console.log('✅ [Analytics Query] Tinybird summary response:', {
        habitsCount: habits.length,
        summaryData: summaryData.data,
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

      // Use Tinybird summary metrics (pre-computed!)
      const summary = summaryData.data || {};
      
      return {
        habits: transformedHabits,
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
  // Always initialize to default values to prevent hydration mismatch
  const [selectedHabits, setSelectedHabits] = useState<string[]>([]);
  const [habitDropdownOpen, setHabitDropdownOpen] = useState(false);
  const [analyticsData, setAnalyticsData] = useState<any>({});
  const [expandedHabit, setExpandedHabit] = useState<string | null>(null);
  const [expandedLogs, setExpandedLogs] = useState<any[]>([]);
  const [loadingExpandedLogs, setLoadingExpandedLogs] = useState(false);
  const [comparisonPeriod, setComparisonPeriod] = useState<'week' | 'month'>('week');
  // Always initialize to default value to prevent hydration mismatch
  const [viewMode, setViewMode] = useState<'chart' | 'ticker'>('chart');

  const availableHabits = data?.habits || [];
  const summaryMetrics = data?.summaryMetrics;

  // Fetch individual logs when habit is expanded (from Tinybird!)
  useEffect(() => {
    if (!expandedHabit) {
      setExpandedLogs([]);
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

  // Load from localStorage after mount (client-side only)
  useEffect(() => {
    setMounted(true);
    const savedHabits = localStorage.getItem('analytics-selected-habits');
    if (savedHabits) {
      setSelectedHabits(JSON.parse(savedHabits));
    }
    const savedViewMode = localStorage.getItem('analytics-view-mode');
    if (savedViewMode) {
      setViewMode(savedViewMode as 'chart' | 'ticker');
    }
  }, []);

  // Force refetch on mount to ensure fresh data
  useEffect(() => {
    refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  // Persist selectedHabits to localStorage
  useEffect(() => {
    if (mounted) {
      localStorage.setItem('analytics-selected-habits', JSON.stringify(selectedHabits));
    }
  }, [selectedHabits, mounted]);

  // Persist viewMode to localStorage
  useEffect(() => {
    if (mounted) {
      localStorage.setItem('analytics-view-mode', viewMode);
    }
  }, [viewMode, mounted]);

  // Fetch analytics data when habits are selected
  useEffect(() => {
    if (selectedHabits.length === 0) {
      setLoading(false);
      return;
    }

    const fetchAnalytics = async () => {
      setLoading(true);
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

    // Calculate Averages
    const calculateAvg = (periodLogs: any[]) => {
      if (periodLogs.length === 0) return 0;

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

      // Average over the DURATION of the period, not just days with logs?
      // Usually analytics show "Daily Average" over the period.
      // If I selected 7 days, and logged 1 day. Average is Total / 7.
      return total / durationDays;
    };

    const currentAvg = calculateAvg(currentLogs);
    const previousAvg = calculateAvg(prevLogs);
    const change = previousAvg > 0 ? ((currentAvg - previousAvg) / previousAvg * 100) : 0;

    const currentValue = chartData.length > 0 ? chartData[chartData.length - 1].value : 0;

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

    // Calculate totals
    const totalValue = chartData.reduce((sum, d) => sum + d.value, 0);
    const avgValue = chartData.length > 0 ? totalValue / chartData.length : 0;

    // Calculate change (compare first half vs second half of period)
    const midpoint = Math.floor(chartData.length / 2);
    const firstHalf = chartData.slice(0, midpoint);
    const secondHalf = chartData.slice(midpoint);
    
    const firstHalfAvg = firstHalf.length > 0 ? firstHalf.reduce((sum, d) => sum + d.value, 0) / firstHalf.length : 0;
    const secondHalfAvg = secondHalf.length > 0 ? secondHalf.reduce((sum, d) => sum + d.value, 0) / secondHalf.length : 0;
    
    const change = firstHalfAvg > 0 ? ((secondHalfAvg - firstHalfAvg) / firstHalfAvg * 100) : 0;

    return {
      habit,
      chartData,
      totalValue,
      avgValue,
      change,
      isPositive: change >= 0,
      individualLogs: uniqueLogs // ✅ Include deduplicated individual logs for detailed display
    };
  };

  // Export to CSV function

  // Show loading on first fetch only (AFTER all hooks)
  if (isLoading && !data) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-end mb-6">
          <div className="h-10 w-64 bg-gray-200 animate-pulse rounded" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="bg-white border border-gray-300 p-5 h-24 animate-pulse" />
          ))}
        </div>
        <div className="h-64 bg-white border border-gray-300 animate-pulse" />
      </div>
    );
  }

  return (
    <>
      {/* Top Bar: Habit Dropdown + View Toggle (left), Date Range Picker + Export (right) */}
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

        {/* Date Range Picker + Export Button - Top Right */}
        <div className="flex items-center gap-2">
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

          {/* Expanded View - Now with Individual Log Details from Tinybird! */}
          {expandedHabit && (
            <div className="mt-4 bg-white border border-gray-300 p-4">
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
                        <p className="text-sm text-gray-500 mt-0.5">
                          Detailed metrics · Powered by Tinybird
                        </p>
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
                        <p className="text-xs text-gray-500 mt-0.5">per day with logs</p>
                      </div>
                      <div className="border border-gray-200 p-3">
                        <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Trend</p>
                        <p className="text-xl font-bold" style={{ color: trendColor }}>
                          {change > 0 ? '+' : ''}{change.toFixed(0)}%
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5">1st half vs 2nd half</p>
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
                                <stop offset="0%" stopColor={trendColor} stopOpacity={0.25} />
                                <stop offset="100%" stopColor={trendColor} stopOpacity={0} />
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

