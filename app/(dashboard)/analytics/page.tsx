'use client';

import React, { useState, useEffect } from 'react';
import { useUser, useAuth } from '@clerk/nextjs';
import { 
  TrendingUp, 
  TrendingDown,
  X,
  ChevronDown
} from 'lucide-react';
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip
} from 'recharts';
import { DateRangePicker } from '@/components/date-range-picker';
import { DateRange } from 'react-day-picker';
import { format, parseISO } from 'date-fns';

// Tinybird-inspired color palette
const COLORS = {
  success: '#10B981',    // Bright green
  danger: '#DC2626',     // Dark red
  primary: '#14B8A6',    // Teal (like Tinybird)
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
  icon?: string;
}

const MetricSummaryCard: React.FC<MetricSummaryCardProps> = ({ 
  label, 
  value, 
  subtitle, 
  trend
}) => {
  return (
    <div className="bg-white border border-gray-300 p-5">
      <div className="flex items-start justify-between mb-2">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      </div>
      <div className="mb-1">
        <p className="text-3xl font-bold text-gray-900">{value}</p>
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
}

const HabitMetricCard: React.FC<HabitMetricCardProps> = ({ 
  habitName,
  currentValue, 
  unit,
  change, 
  chartData,
  isPositive,
  onClick
}) => {
  const trendColor = isPositive ? COLORS.success : COLORS.danger;
  const TrendIcon = isPositive ? TrendingUp : TrendingDown;
  
  // Create safe ID for gradient (no spaces or special chars)
  const safeId = habitName.replace(/[^a-zA-Z0-9]/g, '_');
  
  return (
    <div 
      className="bg-white border border-gray-300 p-4 hover:shadow-md transition-all duration-200 cursor-pointer"
      onClick={onClick}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {change !== undefined && Math.abs(change) > 0 && (
            <div className="flex items-center gap-0.5 flex-shrink-0" style={{ color: trendColor }}>
              <TrendIcon className="w-3 h-3" />
            </div>
          )}
          <span className="text-sm font-medium text-gray-900 truncate">{habitName}</span>
        </div>
      </div>
      
      {/* Value */}
      <div className="mb-3">
        <div className="flex items-baseline gap-1.5">
          <span className="text-2xl font-bold text-gray-900">
            {currentValue.toFixed(currentValue < 10 ? 1 : 0)}
          </span>
          <span className="text-xs text-gray-500">{unit}</span>
        </div>
      </div>
      
      {/* Compact Square Chart with Axes - Like Tinybird! */}
      <div className="h-[140px] -mx-2">
        {chartData.length === 0 ? (
          // Empty state for chart
          <div className="flex items-center justify-center h-full">
            <p className="text-xs text-gray-400">No data for selected period</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -15, bottom: 0 }}>
              <defs>
                {/* SUBTLE gradient like Tinybird - very light! */}
                <linearGradient id={`gradient-${safeId}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={COLORS.primary} stopOpacity={0.05}/>
                  <stop offset="95%" stopColor={COLORS.primary} stopOpacity={0}/>
                </linearGradient>
              </defs>
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
                      <div className="bg-white text-gray-900 px-3 py-2 text-xs shadow-lg border border-gray-300">
                        <p className="font-semibold mb-1">{data.date}</p>
                        <p>{data.value.toFixed(1)} {unit}</p>
                        {data.time && <p className="text-gray-500 mt-0.5">{data.time}</p>}
                      </div>
                    );
                  }
                  return null;
                }}
              />
              {/* Line chart like Tinybird - NO dark fill! */}
              <Area
                type="monotone"
                dataKey="value"
                stroke={COLORS.primary}
                strokeWidth={2}
                fill={`url(#gradient-${safeId})`}
                isAnimationActive={false}
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
};

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="bg-white text-gray-900 px-4 py-3 shadow-xl border border-gray-300">
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
            {data.bedTime && <p className="text-xs text-gray-500">Bed: {data.bedTime}</p>}
            {data.wakeTime && <p className="text-xs text-gray-500">Wake: {data.wakeTime}</p>}
            {data.notes && <p className="text-xs text-gray-600 mt-1 italic">{data.notes}</p>}
          </div>
        ))}
      </div>
    );
  }
  return null;
};

export default function AnalyticsPage() {
  const { user } = useUser();
  const { getToken } = useAuth();
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [selectedHabits, setSelectedHabits] = useState<string[]>([]);
  const [availableHabits, setAvailableHabits] = useState<any[]>([]);
  const [habitDropdownOpen, setHabitDropdownOpen] = useState(false);
  const [analyticsData, setAnalyticsData] = useState<any>({});
  const [expandedHabit, setExpandedHabit] = useState<string | null>(null);
  const [summaryMetrics, setSummaryMetrics] = useState<any>(null);
  
  // 🚀 Cache to prevent redundant API calls
  const [analyticsCache, setAnalyticsCache] = useState<Map<string, any>>(new Map());

  // Fetch ALL habits from Python backend (SQLite)
  useEffect(() => {
    if (!user?.id) return;

    const fetchAllHabits = async () => {
      try {
        console.log('📊 [ANALYTICS] Fetching ALL habits from Python backend for user:', user.id);
        
        // Get auth token from Clerk
        const token = await getToken();
        if (!token) {
          console.error('❌ [ANALYTICS] No auth token found');
          return;
        }
        
        // Fetch all habits from Python backend (SQLite/ritual.db)
        const PYTHON_API_BASE = process.env.NEXT_PUBLIC_PYTHON_API_BASE || 'http://localhost:8000';
        const response = await fetch(`${PYTHON_API_BASE}/api/habits`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (!response.ok) {
          console.error('❌ [ANALYTICS] Error fetching habits from Python backend:', response.status);
          return;
        }
        
        const allHabits = await response.json();
        
        if (!allHabits || allHabits.length === 0) {
          console.warn('⚠️ [ANALYTICS] No habits found in SQLite database');
          setAvailableHabits([]);
          return;
        }
        
        console.log('✅ [ANALYTICS] Found', allHabits.length, 'habits from SQLite');
        console.log('✅ [ANALYTICS] Habit names:', allHabits.map((h: any) => h.name));
        
        // Calculate days_back from date range for metrics
        let daysBack = 365;
        if (dateRange?.from) {
          const now = new Date();
          const fromDate = dateRange.from;
          daysBack = Math.ceil((now.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24));
          daysBack = Math.max(1, daysBack);
        }
        
        // Fetch metrics from Tinybird for these habits
        console.log('📊 [ANALYTICS] Fetching metrics from Tinybird (days_back:', daysBack, ')');
        const metricsResponse = await fetch(`/api/analytics/habits/summary?user_id=${user.id}&days_back=${daysBack}`);
        
        let metrics: any[] = [];
        if (metricsResponse.ok) {
          const data = await metricsResponse.json();
          metrics = data.data || [];
          console.log('✅ [ANALYTICS] Found metrics for', metrics.length, 'habits');
        } else {
          console.warn('⚠️ [ANALYTICS] Failed to fetch metrics from Tinybird');
        }
        
        // Merge SQLite habits with Tinybird metrics
        const habitsWithMetrics = allHabits.map((habit: any) => {
          const metric = metrics.find((m: any) => m.habit_id === habit.id);
          return {
            habit_id: habit.id,
            habit_name: habit.name,
            unit: habit.unit_type || 'count',
            icon: habit.icon,
            total_logs: metric?.total_logs || 0,
            completed_count: metric?.completed_count || 0,
            total_duration_seconds: metric?.total_duration_seconds || 0,
            total_amount: metric?.total_amount || 0,
            last_completed_date: metric?.last_completed_date || null,
            first_log_date: metric?.first_log_date || null
          };
        });
        
        setAvailableHabits(habitsWithMetrics);
        console.log('✅ [ANALYTICS] Merged SQLite habits with Tinybird metrics:', habitsWithMetrics.map((h: any) => `${h.habit_name} (${h.total_logs} logs)`));
        
        // Calculate summary metrics from Tinybird data
        const totalHabits = habitsWithMetrics.length;
        const totalLogs = habitsWithMetrics.reduce((sum: number, h: any) => sum + (h.total_logs || 0), 0);
        const totalCompleted = habitsWithMetrics.reduce((sum: number, h: any) => sum + (h.completed_count || 0), 0);
        const completionRate = totalLogs > 0 ? Math.round((totalCompleted / totalLogs) * 100) : 0;
        
        // Find best performing habit (highest completion rate with at least 3 logs)
        const habitsWithRate = habitsWithMetrics
          .filter((h: any) => h.total_logs >= 3)
          .map((h: any) => ({
            name: h.habit_name,
            rate: h.total_logs > 0 ? (h.completed_count / h.total_logs) * 100 : 0
          }))
          .sort((a: any, b: any) => b.rate - a.rate);
        
        const bestHabit = habitsWithRate.length > 0 ? habitsWithRate[0] : null;
        
        setSummaryMetrics({
          totalHabits,
          totalLogs,
          completionRate,
          bestHabit
        });
        
      } catch (error) {
        console.error('❌ [ANALYTICS] Error fetching habits:', error);
      }
    };

    fetchAllHabits();
  }, [user?.id, dateRange]);

  // Fetch analytics data - OPTIMIZED: Single API call + caching
  useEffect(() => {
    if (!user?.id || selectedHabits.length === 0) {
      setLoading(false);
      return;
    }

    const fetchAnalytics = async () => {
      setLoading(true);
      try {
        // Calculate days_back from date range
        let daysBack = 30; // Default
        if (dateRange?.from) {
          const now = new Date();
          const fromDate = dateRange.from;
          daysBack = Math.ceil((now.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24));
          daysBack = Math.max(1, daysBack);
        }

        // Create cache key based on user and date range
        const cacheKey = `${user.id}-${daysBack}`;

        // Check cache first (valid for 30 seconds)
        const cached = analyticsCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < 30000) {
          console.log('📊 [CACHE HIT] Using cached data');
          const allLogs = cached.data;
          
          // Group logs by habit_id for selected habits
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
          setLoading(false);
          return;
        }

        console.log('📊 [OPTIMIZED] Fetching analytics for', selectedHabits.length, 'habits in 1 API call');
        console.log('📊 Date range:', dateRange, '| Days back:', daysBack);

        // 🚀 OPTIMIZATION: Fetch ALL habits in a single API call (no habit_id parameter)
        // This reduces API calls from N (one per habit) to 1 (all habits at once)
        const logsRes = await fetch(
          `/api/analytics/habits/trends?user_id=${user.id}&period=day&days_back=${daysBack}`
        );
        const response = await logsRes.json();
        const allLogs = response.data || [];

        console.log('📊 [OPTIMIZED] Received', allLogs.length, 'total log entries for all habits');

        // Cache the result
        setAnalyticsCache(new Map(analyticsCache.set(cacheKey, {
          data: allLogs,
          timestamp: Date.now()
        })));

        // Group logs by habit_id for selected habits only
        const dataByHabit: any = {};
        selectedHabits.forEach(habitId => {
          dataByHabit[habitId] = [];
        });

        allLogs.forEach((log: any) => {
          if (selectedHabits.includes(log.habit_id)) {
            dataByHabit[log.habit_id].push(log);
          }
        });

        selectedHabits.forEach(habitId => {
          console.log(`📊 Habit ${habitId}: ${dataByHabit[habitId].length} logs`);
        });

        setAnalyticsData(dataByHabit);
      } catch (error) {
        console.error('❌ Error fetching analytics:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchAnalytics();
  }, [user?.id, selectedHabits, dateRange, analyticsCache]);

  // Toggle habit selection
  const toggleHabit = (habitId: string) => {
    setSelectedHabits(prev => 
      prev.includes(habitId) 
        ? prev.filter(id => id !== habitId)
        : [...prev, habitId]
    );
  };

  // Process data for habit card
  const getHabitCardData = (habitId: string) => {
    const logs = analyticsData[habitId] || [];
    const habit = availableHabits.find(h => h.habit_id === habitId);
    if (!habit) {
      console.warn(`⚠️ Habit not found for ${habitId}`);
      return null;
    }
    
    // If no logs, return empty state with 0 values instead of null
    if (logs.length === 0) {
      console.log(`📊 No logs for ${habit.habit_name}, showing empty state`);
      return {
        habitName: habit.habit_name,
        currentValue: 0,
        unit: habit.unit || 'count',
        change: 0,
        chartData: [],
        isPositive: true
      };
    }

    console.log(`📊 Processing card data for ${habit.habit_name}:`, logs);
    console.log(`📊 Habit unit from summary API:`, habit.unit);

    // Process logs for chart - FIXED: Handle Tinybird response structure
    const chartData = logs.map((log: any) => {
      // Tinybird returns: date, habit_id, habit_name, logs_count, completed_count, total_duration, total_amount, unit
      const date = log.date ? parseISO(log.date) : new Date();
      
      // Calculate value based on unit type
      let value = 0;
      if (log.total_amount > 0) {
        // For amount-based tracking (Pages, Miles, Steps, etc.)
        value = log.total_amount;
      } else if (log.total_duration > 0) {
        // For duration-based tracking
        if (habit.unit === 'Minutes') {
          value = log.total_duration / 60; // Convert seconds to minutes
        } else if (habit.unit === 'Hours') {
          value = log.total_duration / 3600; // Convert seconds to hours
        } else {
          value = log.total_duration / 3600; // Default to hours
        }
      } else {
        // Fallback to completed count
        value = log.completed_count || 0;
      }
      
      console.log(`  📅 ${format(date, 'MMM dd')}: value=${value}, total_amount=${log.total_amount}, total_duration=${log.total_duration}`);
      
      return {
        date: format(date, 'MMM dd'),
        shortDate: format(date, 'M/d'),
        value: value,
        time: null, // Tinybird aggregates don't have individual timestamps
        notes: null
      };
    }).reverse();

    // Get most recent value
    const currentValue = chartData.length > 0 ? chartData[chartData.length - 1].value : 0;

    // Calculate 7-day change
    const recent = chartData.slice(-7);
    const previous = chartData.slice(-14, -7);
    const recentAvg = recent.reduce((sum: number, d: any) => sum + d.value, 0) / (recent.length || 1);
    const previousAvg = previous.reduce((sum: number, d: any) => sum + d.value, 0) / (previous.length || 1);
    const change = previousAvg > 0 ? ((recentAvg - previousAvg) / previousAvg * 100) : 0;

    console.log(`📊 Final card data for ${habit.habit_name}:`, {
      currentValue,
      change,
      dataPoints: chartData.length
    });

    return {
      habitName: habit.habit_name,
      currentValue,
      unit: habit.unit || 'count',
      change,
      chartData,
      isPositive: change >= 0
    };
  };

  // Process data for expanded view
  const getExpandedData = (habitId: string) => {
    const logs = analyticsData[habitId] || [];
    const habit = availableHabits.find(h => h.habit_id === habitId);
    if (!habit) return null;
    
    // If no logs, return empty state
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
      
      // Calculate value based on unit type
      let value = 0;
      if (log.total_amount > 0) {
        value = log.total_amount;
      } else if (log.total_duration > 0) {
        if (habit.unit === 'Minutes') {
          value = log.total_duration / 60;
        } else if (habit.unit === 'Hours') {
          value = log.total_duration / 3600;
        } else {
          value = log.total_duration / 3600;
        }
      } else {
        value = log.completed_count || 0;
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

    // Calculate change
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

  if (!user) {
    return (
      <div className="flex-1 overflow-auto bg-white">
        <div className="max-w-7xl mx-auto p-8">
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto bg-white relative">
      <div className="max-w-7xl mx-auto p-6 lg:p-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 mb-1">Analytics</h1>
            <p className="text-sm text-gray-600">Visualize the performance of your habits</p>
          </div>
          
          {/* Date Range Picker */}
          <DateRangePicker 
            className="w-auto"
            onDateRangeChange={setDateRange}
            initialDateRange={dateRange}
          />
        </div>

        {/* Summary Metrics Cards */}
        {summaryMetrics && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <MetricSummaryCard
              label="Total Habits"
              value={summaryMetrics.totalHabits}
              subtitle="Active habits tracked"
            />
            <MetricSummaryCard
              label="Total Logs"
              value={summaryMetrics.totalLogs.toLocaleString()}
              subtitle="Habit entries recorded"
            />
            <MetricSummaryCard
              label="Completion Rate"
              value={`${summaryMetrics.completionRate}%`}
              subtitle={summaryMetrics.completionRate >= 80 ? 'Excellent progress!' : summaryMetrics.completionRate >= 60 ? 'Good progress' : 'Keep going!'}
            />
            <MetricSummaryCard
              label="Best Habit"
              value={summaryMetrics.bestHabit ? `${Math.round(summaryMetrics.bestHabit.rate)}%` : 'N/A'}
              subtitle={summaryMetrics.bestHabit ? summaryMetrics.bestHabit.name : 'Not enough data'}
            />
          </div>
        )}

        {/* Habit Multi-Select Dropdown */}
        <div className="mb-6 relative">
          <label className="block text-xs font-medium text-gray-600 uppercase tracking-wide mb-2">
            Select Habits
          </label>
          <div className="relative">
            <button
              id="habit-dropdown-button"
              onClick={() => setHabitDropdownOpen(!habitDropdownOpen)}
              className="w-full md:w-auto min-w-[280px] flex items-center justify-between gap-3 px-4 py-2.5 bg-white border border-gray-300 text-sm text-gray-700 hover:bg-[#F3F3F3] transition-colors"
            >
              <span className="text-sm">
                {selectedHabits.length === 0 
                  ? 'Select habits...' 
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
                      availableHabits.map((habit) => (
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
          
          {/* Selected habits badges */}
          {selectedHabits.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {selectedHabits.map((habitId) => {
                const habit = availableHabits.find(h => h.habit_id === habitId);
                return habit ? (
                  <div
                    key={habitId}
                    className="flex items-center gap-2 px-2.5 py-1 bg-white text-gray-900 border border-gray-300 text-xs"
                  >
                    <span>{habit.habit_name}</span>
                    <button
                      onClick={() => toggleHabit(habitId)}
                      className="hover:bg-gray-100 rounded-full p-0.5 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ) : null;
              })}
            </div>
          )}
        </div>

        {/* Habit Metrics Grid - Tinybird Style */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} className="h-64 bg-white border border-gray-300 animate-pulse"></div>
            ))}
          </div>
        ) : availableHabits.length === 0 ? (
          <div className="bg-white border border-gray-300 p-12 text-center">
            <div className="max-w-md mx-auto">
              <p className="text-lg font-medium text-gray-900 mb-2">No habits found</p>
              <p className="text-sm text-gray-600 mb-4">
                Start tracking habits to see analytics here. Your habit data will automatically sync to Tinybird for fast, powerful analytics.
              </p>
              <p className="text-xs text-gray-500">
                 Analytics are powered by Tinybird for real-time insights 🚀
              </p>
            </div>
          </div>
        ) : selectedHabits.length > 0 ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {selectedHabits.map((habitId) => {
                const cardData = getHabitCardData(habitId);
                if (!cardData) {
                  console.warn(`⚠️ Skipping card for ${habitId} - habit not found`);
                  return null;
                }

                return (
                  <HabitMetricCard
                    key={habitId}
                    {...cardData}
                    onClick={() => setExpandedHabit(expandedHabit === habitId ? null : habitId)}
                  />
                );
              })}
            </div>

            {/* Expanded View */}
            {expandedHabit && (
              <div className="mt-6 bg-white border border-gray-300 p-6">
                {(() => {
                  const expandedData = getExpandedData(expandedHabit);
                  if (!expandedData) return null;

                  const { habit, chartData, totalValue, avgValue, change, isPositive } = expandedData;
                  const trendColor = isPositive ? COLORS.success : COLORS.danger;

                  return (
                    <>
                      <div className="flex items-center justify-between mb-6">
                        <div>
                          <h3 className="text-xl font-bold text-gray-900">{habit.habit_name}</h3>
                          <p className="text-sm text-gray-500 mt-1">Detailed metrics over time</p>
                        </div>
                        <button
                          onClick={() => setExpandedHabit(null)}
                          className="p-2 hover:bg-[#F3F3F3] transition-colors"
                        >
                          <X className="w-5 h-5 text-gray-600" />
                        </button>
                      </div>

                      {/* Summary Stats */}
                      <div className="grid grid-cols-3 gap-4 mb-6">
                        <div className="border border-gray-200 p-4">
                          <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Total</p>
                          <p className="text-2xl font-bold text-gray-900">{totalValue.toFixed(1)}</p>
                          <p className="text-xs text-gray-500 mt-0.5">{habit.unit || 'count'}</p>
                        </div>
                        <div className="border border-gray-200 p-4">
                          <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Average</p>
                          <p className="text-2xl font-bold text-gray-900">{avgValue.toFixed(1)}</p>
                          <p className="text-xs text-gray-500 mt-0.5">per day</p>
                        </div>
                        <div className="border border-gray-200 p-4">
                          <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">7-Day Change</p>
                          <p className="text-2xl font-bold" style={{ color: trendColor }}>
                            {change > 0 ? '+' : ''}{change.toFixed(0)}%
                          </p>
                          <p className="text-xs text-gray-500 mt-0.5">vs previous</p>
                        </div>
                      </div>

                      {/* Large Chart with Proper Axes */}
                      <ResponsiveContainer width="100%" height={300}>
                        <AreaChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                          <defs>
                            <linearGradient id={`gradient-expanded-${expandedHabit}`} x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor={COLORS.primary} stopOpacity={0.1}/>
                              <stop offset="95%" stopColor={COLORS.primary} stopOpacity={0}/>
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
                            label={{ value: habit.unit || 'Value', angle: -90, position: 'insideLeft', style: { fill: COLORS.gray[600], fontSize: 12 } }}
                          />
                          <Tooltip content={<CustomTooltip />} />
                          <Area
                            type="monotone"
                            dataKey="value"
                            stroke={COLORS.primary}
                            strokeWidth={2}
                            fill={`url(#gradient-expanded-${expandedHabit})`}
                            name={habit.unit || 'Value'}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </>
                  );
                })()}
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
