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

import React, { useState, useEffect, Suspense, useRef, useCallback } from 'react';
import { useAuth, useUser } from '@clerk/nextjs';
import { useQuery } from '@tanstack/react-query';
import {
  TrendingUp,
  TrendingDown,
  X,
  ChevronDown,
  Check,
  Share2,
  Copy,
  Download,
  Monitor
} from 'lucide-react';
import html2canvas from 'html2canvas';
import { DateRangePicker } from '@/components/date-range-picker';
import { DateRange } from 'react-day-picker';
import { format, parseISO, startOfDay, differenceInDays, subDays, isWithinInterval, sub } from 'date-fns';
import { HabitTickerGrid, AnalyticsViewToggle } from '@/components/analytics/habit-ticker-view';
import { analyticsApi, type HabitStats } from '@/lib/services/analytics-api';
import { ComputerActivitySection } from '@/components/analytics/computer-activity';

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
  // Match spark card colors - Perplexity style
  const tealGreen = '#0D9488';
  const warmRed = '#B91C1C';
  const isNeutral = change === undefined || Math.abs(change) < 0.5;
  const chartColor = isNeutral ? '#6B7280' : (isPositive ? tealGreen : warmRed);
  const bgColor = isNeutral
    ? 'rgba(107, 114, 128, 0.08)'
    : (isPositive ? 'rgba(13, 148, 136, 0.08)' : 'rgba(185, 28, 28, 0.08)');

  return (
    <div
      className="group relative bg-white border border-gray-200 p-2.5 hover:bg-gray-50 transition-colors duration-150 cursor-pointer overflow-hidden min-w-0"
      onClick={onClick}
    >
      {/* Close Button - Top right corner, appears on hover */}
      {onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10"
          aria-label="Remove habit"
        >
          <X className="w-3 h-3 text-gray-400 hover:text-gray-600" />
        </button>
      )}

      {/* Header Row: Name + Badge + Change */}
      <div className="flex items-start justify-between gap-1 mb-1">
        <div className="flex-1 min-w-0 overflow-hidden">
          <h3 className="font-medium text-[12px] text-gray-900 truncate leading-tight">
            {habitName}
          </h3>
          <p className="text-[9px] text-gray-500 uppercase tracking-wider truncate">
            {unit}
          </p>
        </div>

        {/* Right side: Badge + Absolute Change */}
        <div className="flex flex-col items-end shrink-0">
          {/* % Badge */}
          <div
            className="flex items-center gap-0.5 px-1 py-0.5 whitespace-nowrap"
            style={{ backgroundColor: bgColor }}
          >
            {!isNeutral && (
              isPositive
                ? <span className="text-[9px]" style={{ color: chartColor }}>↗</span>
                : <span className="text-[9px]" style={{ color: chartColor }}>↘</span>
            )}
            <span
              className="text-[9px] font-medium tabular-nums"
              style={{ color: chartColor }}
            >
              {Math.abs(change || 0).toFixed(1)}%
            </span>
          </div>
          {/* Absolute change */}
          {absoluteChange !== undefined && (
            <span
              className="text-[9px] font-medium tabular-nums mt-0.5"
              style={{ color: chartColor }}
            >
              {absoluteChange >= 0 ? '+' : ''}{absoluteChange.toFixed(1)}
            </span>
          )}
        </div>
      </div>

      {/* Mini Bar Chart */}
      <div className="h-[40px] my-1 overflow-hidden w-full min-w-0">
        {chartData.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-[10px] text-gray-400">No data</p>
          </div>
        ) : (
          <Suspense fallback={
            <div className="flex items-center justify-center h-full">
              <div className="w-3 h-3 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin"></div>
            </div>
          }>
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <BarChart data={chartData} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
                <Bar
                  dataKey="value"
                  fill="#4A4A4C"
                  radius={[1, 1, 0, 0]}
                  isAnimationActive={false}
                  maxBarSize={12}
                />
              </BarChart>
            </ResponsiveContainer>
          </Suspense>
        )}
      </div>

      {/* Value - Bottom */}
      <p className="text-base font-semibold text-gray-900 tabular-nums leading-tight">
        {currentValue.toFixed(currentValue < 10 ? 2 : 0)}
      </p>
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
        let date: Date;
        if (timeStr.includes('T')) {
          date = parseISO(timeStr);
        } else if (timeStr.includes(' ')) {
          date = new Date(timeStr.replace(' ', 'T') + 'Z');
        } else {
          return timeStr;
        }
        if (!isNaN(date.getTime())) {
          return format(date, 'h:mm a');
        }
        return timeStr;
      } catch {
        return timeStr;
      }
    };

    // Get the primary value (first payload)
    const primaryValue = payload[0]?.value;
    const comparisonValue = payload[1]?.value;
    
    // Get units from data
    const primaryUnit = data?.unit || '';
    const compUnit = data?.compUnit || '';

    return (
      <div
        className="p-3 min-w-[160px]"
        style={{
          background: 'rgba(255, 255, 255, 0.7)',
          backdropFilter: 'blur(20px) saturate(150%)',
          WebkitBackdropFilter: 'blur(20px) saturate(150%)',
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.08)',
        }}
      >
        <p className="text-sm font-semibold text-gray-900 mb-2">{label}</p>
        <div className="space-y-1.5 text-xs">
          {/* Primary value with unit */}
          <div className="flex items-center justify-between gap-6">
            <span className="text-gray-500">{payload.length > 1 ? payload[0]?.name || 'Value' : 'Value'}</span>
            <span className="text-gray-900 font-semibold tabular-nums">
              {typeof primaryValue === 'number' ? primaryValue.toFixed(1) : primaryValue}
              {primaryUnit && <span className="text-gray-500 font-normal ml-1">{primaryUnit}</span>}
            </span>
          </div>

          {/* Comparison value with unit if exists */}
          {comparisonValue !== undefined && (
            <div className="flex items-center justify-between gap-6">
              <span className="text-slate-500">{payload[1]?.name || 'Comparison'}</span>
              <span className="text-slate-500 font-semibold tabular-nums">
                {typeof comparisonValue === 'number' ? comparisonValue.toFixed(1) : comparisonValue}
                {compUnit && <span className="font-normal ml-1">{compUnit}</span>}
              </span>
            </div>
          )}

          {/* Sleep Start/End Times */}
          {data.sleepOnset && data.sleepEnd && (
            <>
              <div className="h-px bg-gray-400/30 my-2"></div>
              <div className="flex items-center justify-between gap-6">
                <span className="text-gray-500">Sleep Start</span>
                <span className="text-gray-700 tabular-nums font-medium">
                  {format(parseISO(data.sleepOnset), 'h:mm a')}
                </span>
              </div>
              <div className="flex items-center justify-between gap-6">
                <span className="text-gray-500">Sleep End</span>
                <span className="text-gray-700 tabular-nums font-medium">
                  {format(parseISO(data.sleepEnd), 'h:mm a')}
                </span>
              </div>
            </>
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
  const { user, isLoaded: isUserLoaded } = useUser();
  const { getToken } = useAuth();

  return useQuery({
    queryKey: ['analytics-summary', user?.id],
    enabled: isUserLoaded && !!user?.id, // Only run when user is fully loaded
    queryFn: async () => {
      const token = await getToken();
      
      // Wait for token to be available
      if (!token) {
        console.warn('⚠️ [Analytics Query] No auth token available, waiting...');
        throw new Error('No auth token available');
      }
      
      const backendUrl = process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';

      // Fetch habits, overall summary, and per-habit summary in parallel (all Tinybird-powered!)
      const [habitsRes, summaryRes, habitsSummaryRes] = await Promise.all([
        fetch(`${backendUrl}/api/habits`, {
          headers: { 'Authorization': `Bearer ${token}` },
          credentials: 'include'
        }),
        fetch('/api/analytics/summary', { credentials: 'include' }), // ✅ Tinybird-powered overall metrics
        fetch('/api/analytics/habits/summary', { credentials: 'include' }) // ✅ Tinybird-powered per-habit metrics with % changes!
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
    refetchOnWindowFocus: false, // Don't refetch on window focus (prevents excessive requests)
    refetchOnMount: true, // Refetch when Analytics page mounts (if stale)
    retry: 3, // Retry up to 3 times if token not ready
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 5000), // Exponential backoff
  });
}

// Helper to determine start/end dates for expanded view ranges
const getRangeDates = (range: string) => {
  const now = new Date();

  switch (range) {
    case '1D': return { from: subDays(now, 1), to: now };
    case '1W': return { from: subDays(now, 7), to: now };
    case '1M': return { from: subDays(now, 30), to: now };
    case '3M': return { from: subDays(now, 90), to: now };
    case '6M': return { from: subDays(now, 180), to: now };
    case 'YTD': return { from: startOfDay(new Date(now.getFullYear(), 0, 1)), to: now };
    case '1Y': return { from: subDays(now, 365), to: now };
    case 'ALL': return { from: subDays(now, 365 * 5), to: now }; // Cap at 5 years
    default: return { from: subDays(now, 30), to: now };
  }
};

// Custom Dropdown Component for clean styling
const CustomSelect = ({ value, options, onChange, placeholder = 'Select' }: any) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedLabel = options.find((o: any) => o.value === value)?.label || placeholder;

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between w-[180px] px-3 py-2 text-xs font-medium text-gray-700 bg-white border border-gray-300 hover:bg-[#F3F3F3] focus:outline-none focus:ring-1 focus:ring-gray-400 transition-colors"
      >
        <span className="truncate mr-2">{selectedLabel}</span>
        <ChevronDown className="w-3.5 h-3.5 text-gray-500" />
      </button>

      {isOpen && (
        <div className="absolute right-0 z-50 w-[200px] mt-1 bg-white border border-gray-200 shadow-xl py-1 max-h-[300px] overflow-auto">
          <div className="px-3 py-2 border-b border-gray-100 mb-1">
            <span className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold">Compare with...</span>
          </div>
          {options.map((option: any) => (
            <div
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
              className={`px-3 py-2 text-xs cursor-pointer flex items-center justify-between group hover:bg-[#F3F3F3] ${value === option.value ? 'bg-[#F3F3F3] text-gray-900 font-medium' : 'text-gray-600'
                }`}
            >
              <span>{option.label}</span>
              {value === option.value && <Check className="w-3 h-3 text-gray-900" />}
            </div>
          ))}
          {value && value !== '' && (
            <div
              onClick={() => { onChange(''); setIsOpen(false); }}
              className="px-3 py-2 text-xs text-red-600 hover:bg-red-50 cursor-pointer border-t border-gray-100 mt-1"
            >
              Clear Comparison
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export function AnalyticsClient() {
  const { getToken } = useAuth();
  const { user, isLoaded: isUserLoaded } = useUser();
  const { data, isLoading, isPending, refetch } = useAnalyticsSummary();
  
  // Show loading when query is pending (user not loaded or first fetch)
  const queryLoading = isLoading || isPending;

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

  // Python API stats for ALL habits (single source of truth for cards)
  const [allHabitStats, setAllHabitStats] = useState<Record<string, HabitStats>>({});
  const [loadingAllStats, setLoadingAllStats] = useState(false);
  const [comparisonPeriod, setComparisonPeriod] = useState<'week' | 'month'>('week');

  // Expanded View Controls (Perplexity-style)
  const [expandedTimeRange, setExpandedTimeRange] = useState<'1D' | '1W' | '1M' | '3M' | '6M' | 'YTD' | '1Y' | 'ALL'>('1M');
  const [compareHabitId, setCompareHabitId] = useState<string | null>(null);
  const [comparisonLogs, setComparisonLogs] = useState<any[]>([]);
  const [loadingComparison, setLoadingComparison] = useState(false);
  // Always initialize to default value to prevent hydration mismatch
  const [viewMode, setViewMode] = useState<'chart' | 'ticker'>('chart');

  // Computer Activity visibility (persisted in localStorage)
  const [showComputerActivity, setShowComputerActivity] = useState(true);

  // Correlation data for habit comparison in expanded view
  const [correlationData, setCorrelationData] = useState<any>(null);
  const [loadingCorrelation, setLoadingCorrelation] = useState(false);

  // Share modal state
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareImageUrl, setShareImageUrl] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const chartRef = useRef<HTMLDivElement>(null);

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
    // Wait for user to be authenticated before fetching
    if (!isUserLoaded || !user?.id) return;
    
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
  }, [isUserLoaded, user?.id]); // Fetch when user is authenticated

  // Fetch correlation when comparing two habits in expanded view
  useEffect(() => {
    if (!expandedHabit || !compareHabitId) {
      setCorrelationData(null);
      return;
    }

    const fetchCorrelation = async () => {
      setLoadingCorrelation(true);
      try {
        const params = new URLSearchParams({
          habit1_id: expandedHabit,
          habit2_id: compareHabitId,
          days_back: '90',
        });

        const res = await fetch(`/api/analytics/correlation?${params.toString()}`);
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.data) {
            setCorrelationData(data.data);
            console.log('✅ Correlation loaded:', data.data.correlation);
          }
        }
      } catch (error) {
        console.error('❌ Failed to fetch correlation:', error);
      } finally {
        setLoadingCorrelation(false);
      }
    };

    fetchCorrelation();
  }, [expandedHabit, compareHabitId]);

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
  // Check if custom date range is active (from main date picker)
  const hasCustomDateRange = !!(dateRange?.from && dateRange?.to);

  useEffect(() => {
    if (!expandedHabit) {
      setExpandedLogs([]);
      // Reset expanded view controls
      setExpandedTimeRange('1M');
      setCompareHabitId(null);
      setComparisonLogs([]);
      return;
    }

    const fetchExpandedLogs = async () => {
      setLoadingExpandedLogs(true);
      try {
        // Use main date picker range if set, otherwise use internal range selector
        let from: Date, to: Date;
        if (hasCustomDateRange) {
          from = dateRange.from!;
          to = dateRange.to!;
        } else {
          const rangeDates = getRangeDates(expandedTimeRange);
          from = rangeDates.from;
          to = rangeDates.to;
        }

        const startDate = format(from, 'yyyy-MM-dd');
        const endDate = format(to, 'yyyy-MM-dd');

        console.log(`📊 Fetching expanded logs for ${expandedHabit} (${hasCustomDateRange ? 'custom range' : expandedTimeRange}): ${startDate} to ${endDate}`);

        const response = await fetch(
          `/api/analytics/habits/logs?habit_id=${expandedHabit}&start_date=${startDate}&end_date=${endDate}`
        );

        const result = await response.json();

        if (result.success) {
          setExpandedLogs(result.data);
        } else {
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
  }, [expandedHabit, expandedTimeRange, hasCustomDateRange, dateRange?.from?.toISOString(), dateRange?.to?.toISOString()]);

  // Fetch Comparison Logs
  useEffect(() => {
    if (!expandedHabit || !compareHabitId) {
      setComparisonLogs([]);
      return;
    }

    const fetchComparisonLogs = async () => {
      setLoadingComparison(true);
      try {
        // Use main date picker range if set, otherwise use internal range selector
        let from: Date, to: Date;
        if (hasCustomDateRange) {
          from = dateRange.from!;
          to = dateRange.to!;
        } else {
          const rangeDates = getRangeDates(expandedTimeRange);
          from = rangeDates.from;
          to = rangeDates.to;
        }
        const startDate = format(from, 'yyyy-MM-dd');
        const endDate = format(to, 'yyyy-MM-dd');

        console.log(`📊 Fetching comparison logs for ${compareHabitId}`);

        const response = await fetch(
          `/api/analytics/habits/logs?habit_id=${compareHabitId}&start_date=${startDate}&end_date=${endDate}`
        );

        const result = await response.json();
        if (result.success) {
          setComparisonLogs(result.data);
        } else {
          setComparisonLogs([]);
        }
      } catch (error) {
        console.error('❌ Error fetching comparison logs:', error);
        setComparisonLogs([]);
      } finally {
        setLoadingComparison(false);
      }
    };

    fetchComparisonLogs();
  }, [compareHabitId, expandedTimeRange, expandedHabit, hasCustomDateRange, dateRange?.from?.toISOString(), dateRange?.to?.toISOString()]);

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
      // SPECIFIC DATE RANGE: Calculate first 7 days vs last 7 days of the selected range
      // This makes the comparison meaningful for any custom date range
      
      if (chartData.length >= 2) {
        // Sort data chronologically (should already be sorted, but ensure it)
        const sortedData = [...chartData].sort((a: any, b: any) => 
          new Date(a.rawDate).getTime() - new Date(b.rawDate).getTime()
        );
        
        // Get first 7 days of the selected range (or all if less than 7)
        const first7Days = sortedData.slice(0, Math.min(7, Math.floor(sortedData.length / 2)));
        // Get last 7 days of the selected range (or remaining if less than 7)
        const last7Days = sortedData.slice(Math.max(sortedData.length - 7, Math.ceil(sortedData.length / 2)));
        
        // Calculate averages
        const first7Avg = first7Days.length > 0 
          ? first7Days.reduce((sum: number, d: any) => sum + (d.value || 0), 0) / first7Days.length 
          : 0;
        const last7Avg = last7Days.length > 0 
          ? last7Days.reduce((sum: number, d: any) => sum + (d.value || 0), 0) / last7Days.length 
          : 0;
        
        // Calculate change
        if (first7Avg > 0) {
          change = ((last7Avg - first7Avg) / first7Avg) * 100;
          absoluteChange = last7Avg - first7Avg;
        } else if (last7Avg > 0) {
          change = 100; // Went from 0 to something
          absoluteChange = last7Avg;
        }
      } else {
        // Not enough data for comparison
        change = 0;
        absoluteChange = 0;
      }
    }

    // Get current value - the overall average for the selected period
    // Priority: Tinybird (most accurate) > Python API > local calculation
    let currentValue = 0;

    if (isAllTimeView && progressData) {
      // ALL TIME: Use last period average from progress data (most recent 7 days performance)
      const hasAmountData = (progressData.first_period_avg_amount ?? 0) > 0 || (progressData.last_period_avg_amount ?? 0) > 0;
      currentValue = hasAmountData
        ? (progressData.last_period_avg_amount ?? 0)
        : (progressData.last_period_avg_duration ?? 0);
    } else if (tbMetrics?.avg_amount !== undefined) {
      // CUSTOM DATE RANGE: Use Tinybird's pre-calculated average (most accurate)
      currentValue = tbMetrics.avg_amount;
    } else if (pythonStats?.average !== undefined) {
      // Fallback to Python API stats
      currentValue = pythonStats.average;
    } else if (chartData.length >= 1) {
      // Last resort: Calculate from chart data
      const totalValue = chartData.reduce((sum: number, d: any) => sum + (d.value || 0), 0);
      currentValue = totalValue / chartData.length;
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

    // Helper to process logs list into date-aggregated map
    const processLogsToMap = (logsSource: any[], unitType: any) => {
      if (!logsSource || !logsSource.length) return { byDate: {}, logs: {} };

      // Deduplicate logs first
      const uniqueLogs = logsSource.reduce((acc: any[], log: any) => {
        const existingIndex = acc.findIndex((l: any) => l.id === log.id);
        if (existingIndex >= 0) {
          if (log.metadata && log.metadata !== '{}' && (!acc[existingIndex].metadata || acc[existingIndex].metadata === '{}')) {
            acc[existingIndex] = log;
          }
        } else {
          acc.push(log);
        }
        return acc;
      }, []);

      // Group by Date
      const logsMap = uniqueLogs.reduce((acc: any, log: any) => {
        if (!acc[log.date]) acc[log.date] = [];
        acc[log.date].push(log);
        return acc;
      }, {});

      // Calculate Totals per Date
      const valuesMap: Record<string, number> = {};
      const unit = (unitType || '').toString().toLowerCase();

      Object.keys(logsMap).forEach(dateStr => {
        let total = 0;
        const dayLogs = logsMap[dateStr];
        dayLogs.forEach((log: any) => {
          const duration = Number(log.duration || 0);
          const amount = Number(log.amount || 0);

          if (unit.includes('hour')) {
            if (duration > 0) total += duration / 3600;
            else if (amount > 0) total += amount;
          } else if (unit.includes('minute')) {
            if (duration > 0) total += duration / 60;
            else if (amount > 0) total += amount;
          } else {
            total += amount > 0 ? amount : (duration > 0 ? 1 : 0);
          }
        });
        valuesMap[dateStr] = total;
      });

      return { byDate: valuesMap, logs: logsMap };
    };

    // Process Main Habit Data
    const mainData = processLogsToMap(expandedLogs, habit.unit_type || (habit as any).unit);

    // Process Comparison Habit Data
    let compData = { byDate: {}, logs: {} };
    let compHabit: any = null;
    if (compareHabitId) {
      compHabit = availableHabits.find((h: HabitData) => h.habit_id === compareHabitId);
      if (compHabit) {
        compData = processLogsToMap(comparisonLogs, compHabit.unit_type || (compHabit as any).unit);
      }
    }

    // Combine Dates
    const allDates = Array.from(new Set([...Object.keys(mainData.byDate), ...Object.keys(compData.byDate)])).sort();

    // Stats calculations (Main Habit Only for stats grid)
    const values = Object.values(mainData.byDate) as number[];
    const totalValue = values.reduce((a, b) => a + b, 0);
    const avgValue = values.length ? totalValue / values.length : 0;
    const minValue = values.length ? Math.min(...values) : 0;
    const maxValue = values.length ? Math.max(...values) : 0;
    const variance = values.length ? values.reduce((a, b) => a + Math.pow(b - avgValue, 2), 0) / values.length : 0;
    const stdDev = Math.sqrt(variance);

    // Create Chart Data
    const chartData = allDates.map(dateStr => {
      const date = parseISO(dateStr);
      // Main values
      const val = (mainData.byDate as any)[dateStr] || 0;
      // Comp values
      const cVal = (compData.byDate as any)[dateStr]; // Undefined if no data, which allows gaps

      // Metadata (from main habit only for now)
      const dayLogs = (mainData.logs as any)[dateStr] || [];
      const logsWithMeta = dayLogs.filter((l: any) => l.metadata && l.metadata !== '{}');
      const logToUse = logsWithMeta.length > 0 ? logsWithMeta[0] : dayLogs[0];

      let metadata = {};
      if (logToUse && logToUse.metadata) {
        try {
          const meta = typeof logToUse.metadata === 'string' ? JSON.parse(logToUse.metadata) : logToUse.metadata;
          if (meta.sleep_onset) metadata = { ...metadata, sleepOnset: meta.sleep_onset };
          if (meta.sleep_end) metadata = { ...metadata, sleepEnd: meta.sleep_end };
        } catch (e) { }
      }

      if (logToUse && logToUse.completed_at) {
        try {
          // Basic time extraction
          const dt = new Date(logToUse.completed_at);
          const h = dt.getHours();
          const m = dt.getMinutes();
          const ampm = h >= 12 ? 'pm' : 'am';
          metadata = { ...metadata, time: `${h % 12 || 12}:${m.toString().padStart(2, '0')}${ampm}` };
        } catch { }
      }

      return {
        date: format(date, 'MMM d, yyyy'),
        shortDate: format(date, 'MMM d'),
        value: val,
        compValue: cVal !== undefined ? cVal : 0,
        unit: habit.unit_type || (habit as any).unit || '',
        compUnit: compHabit ? (compHabit.unit_type || (compHabit as any).unit || '') : '',
        ...metadata
      };
    });

    return {
      habit,
      compHabit,
      chartData,
      totalValue,
      avgValue,
      minValue,
      maxValue,
      stdDev
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
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
            <div key={i} className="border border-gray-200 p-3 h-32 animate-shimmer bg-[length:200%_100%] bg-gradient-to-r from-gray-100 via-gray-50 to-gray-100" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Top Bar: Controls Layout */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        {/* Left Side: View Toggle + System Selector */}
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
                  className="fixed inset-0 ml-[70px]"
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

        {/* Right Side: Date Range Picker */}
        <div className="flex items-center gap-3">
          <DateRangePicker
            className="w-auto"
            onDateRangeChange={setDateRange}
            initialDateRange={dateRange}
          />
        </div>
      </div>

      {/* Habit Metrics Grid */}
      {(loading || queryLoading) ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
            <div key={i} className="h-32 border border-gray-300 animate-shimmer bg-[length:200%_100%] bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200"></div>
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
                <div 
                  className={`grid grid-cols-2 sm:grid-cols-4 gap-2 transition-opacity duration-300 ${
                    expandedHabit ? 'opacity-50 pointer-events-auto' : 'opacity-100'
                  }`}
                  style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}
                >
                  {habitsToShow.map((habitId: string) => {
                    const cardData = getHabitCardData(habitId);
                    if (!cardData) return null;

                    return (
                      <div key={habitId} className="min-w-0">
                        <HabitMetricCard
                          {...cardData}
                          onClick={() => setExpandedHabit(expandedHabit === habitId ? null : habitId)}
                          onRemove={() => {
                            setSelectedHabits(prev => prev.filter((id: string) => id !== habitId));
                            if (expandedHabit === habitId) {
                              setExpandedHabit(null);
                            }
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              );
            } else {
              // Build habit data, using available habits directly as fallback
              const tickerHabits = habitsToShow.map((habitId: string) => {
                const cardData = getHabitCardData(habitId);
                const habit = availableHabits.find((h: HabitData) => h.habit_id === habitId);
                const tbMetrics = tinybirdHabitMetrics[habitId];

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
                    stability_class: undefined,
                    consistency_score: undefined,
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
                  // Include stability metrics from Tinybird
                  stability_class: tbMetrics?.stability_class as 'stable' | 'moderate' | 'variable' | undefined,
                  consistency_score: tbMetrics?.consistency_score,
                };
              }).filter((item: { habit_id: string; habit_name: string; category: string; unit: string; last_7_days_avg: number; prev_7_days_avg: number; weekly_amount_change_pct: number; chartData: { value: number }[] } | null): item is NonNullable<typeof item> => item !== null);

              // Debug: log what we're passing (can remove later)
              if (tickerHabits.length === 0) {
                console.log(`📊 Ticker: habitsToShow=${habitsToShow.length}, tickerHabits=0, selectedValid=${validSelectedHabits.length}`);
              }

              return (
                <div className={`transition-opacity duration-300 ${
                  expandedHabit ? 'opacity-50 pointer-events-auto' : 'opacity-100'
                }`}>
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
                </div>
              );
            }
          })()}

          {/* Expanded View - Now with Individual Log Details from Tinybird! */}
          {expandedHabit && (
            <div className="mt-4 bg-white border border-gray-200 p-6">
              {loadingExpandedLogs ? (
                <div className="flex items-center justify-center h-[400px]">
                  <div className="text-center">
                    <div className="w-8 h-8 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin mx-auto mb-2"></div>
                    <p className="text-sm text-gray-500">Loading metrics...</p>
                  </div>
                </div>
              ) : (() => {
                const expandedData = getExpandedData(expandedHabit);
                if (!expandedData) return null;

                const { habit, compHabit, chartData, totalValue, avgValue, minValue, maxValue, stdDev } = expandedData;
                const ranges = ['1D', '1W', '1M', '3M', '6M', 'YTD', '1Y', 'ALL'];

                // Prepare options for custom select
                const compareOptions = availableHabits
                  .filter((h: any) => h.habit_id !== expandedHabit)
                  .map((h: any) => ({ label: h.habit_name, value: h.habit_id }));

                return (
                  <>
                    {/* Header Row */}
                    <div className="flex items-start justify-between mb-8">
                      <div>
                        <div className="flex items-center gap-3">
                          <h3 className="text-2xl font-medium text-gray-900 tracking-tight">{habit.habit_name}</h3>
                          {compHabit && (
                            <span className="text-gray-400 text-xl font-medium flex items-center">
                              <span className="mr-2">vs</span>
                              <span className="text-slate-500">{compHabit.habit_name}</span>
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => setExpandedHabit(null)}
                        className="p-2 transition-colors"
                      >
                        <X className="w-5 h-5 text-gray-400 hover:text-gray-600" />
                      </button>
                    </div>

                    {/* Toolbar: Time Range & Compare */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
                      {/* Time Ranges - Show custom date range if active, otherwise show range buttons */}
                      {hasCustomDateRange ? (
                        <div className="flex items-center gap-2 px-3 py-1.5 bg-[#F3F3F3] border border-gray-300">
                          <span className="text-xs font-medium text-gray-700">
                            {format(dateRange.from!, 'MMM d')} – {format(dateRange.to!, 'MMM d, yyyy')}
                          </span>
                          <span className="text-[10px] text-gray-500">(from date picker)</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-0.5 p-1 bg-white border border-gray-200 shadow-sm">
                          {ranges.map((range) => (
                            <button
                              key={range}
                              onClick={() => setExpandedTimeRange(range as any)}
                              className={`px-3 py-1.5 text-xs transition-all duration-200 ${expandedTimeRange === range
                                ? 'bg-[#F3F3F3] text-gray-900 font-medium shadow-sm'
                                : 'text-gray-500 hover:text-gray-900 hover:bg-[#F3F3F3] font-normal'
                                }`}
                            >
                              {range}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Compare Dropdown & Share Button */}
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-3">
                          <span className="text-[10px] font-medium text-gray-400 uppercase tracking-widest">Compare</span>
                          <CustomSelect
                            value={compareHabitId}
                            options={compareOptions}
                            onChange={(val: string) => setCompareHabitId(val || null)}
                            placeholder="None"
                          />
                        </div>
                        <button
                          onClick={async () => {
                            if (!chartRef.current) return;
                            setIsCapturing(true);
                            try {
                              const canvas = await html2canvas(chartRef.current, {
                                backgroundColor: '#ffffff',
                                scale: 2,
                                logging: false,
                                useCORS: true,
                              });
                              const imageUrl = canvas.toDataURL('image/png');
                              setShareImageUrl(imageUrl);
                              setShowShareModal(true);
                            } catch (error) {
                              console.error('Failed to capture chart:', error);
                            } finally {
                              setIsCapturing(false);
                            }
                          }}
                          disabled={isCapturing}
                          className="flex items-center gap-2 px-3 py-1.5 bg-white border border-gray-200 text-sm text-gray-700 hover:bg-[#F3F3F3] shadow-sm transition-colors disabled:opacity-50"
                        >
                          <Share2 className="w-4 h-4" />
                          <span>{isCapturing ? 'Capturing...' : 'Share'}</span>
                        </button>
                      </div>
                    </div>

                    {/* Shareable Content - wrapped for screenshot capture */}
                    <div ref={chartRef} className="bg-white">
                    {/* Stats Grid - Square Compact Style */}
                    <div className="grid grid-cols-5 gap-3 mb-8">
                      <div className="bg-white border border-gray-200 p-2 shadow-sm backdrop-blur-sm">
                        <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wide mb-0.5">Total</p>
                        <p className="text-lg font-medium text-gray-900 tabular-nums tracking-tight">{totalValue.toFixed(1)}</p>
                      </div>
                      <div className="bg-white border border-gray-200 p-2 shadow-sm backdrop-blur-sm">
                        <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wide mb-0.5">Average</p>
                        <p className="text-lg font-medium text-gray-900 tabular-nums tracking-tight">{avgValue.toFixed(1)}</p>
                      </div>
                      <div className="bg-white border border-gray-200 p-2 shadow-sm backdrop-blur-sm">
                        <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wide mb-0.5">Min</p>
                        <p className="text-lg font-medium text-gray-900 tabular-nums tracking-tight">{minValue.toFixed(1)}</p>
                      </div>
                      <div className="bg-white border border-gray-200 p-2 shadow-sm backdrop-blur-sm">
                        <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wide mb-0.5">Max</p>
                        <p className="text-lg font-medium text-gray-900 tabular-nums tracking-tight">{maxValue.toFixed(1)}</p>
                      </div>
                      <div className="bg-white border border-gray-200 p-2 shadow-sm backdrop-blur-sm">
                        <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wide mb-0.5">Std Dev</p>
                        <p className="text-lg font-medium text-gray-900 tabular-nums tracking-tight">{stdDev.toFixed(1)}</p>
                      </div>
                    </div>

                    {/* Correlation Display - Shows when comparing two habits */}
                    {compHabit && correlationData && (
                      <div className="mb-4 inline-flex items-center gap-2 px-2.5 py-1.5 bg-white/70 backdrop-blur-md border border-gray-200/60 shadow-sm">
                        <span className="text-[10px] text-gray-500 uppercase tracking-wide">Correlation</span>
                        <span className="text-sm font-semibold text-gray-900 tabular-nums">
                          {correlationData.correlation?.coefficient?.toFixed(2)}
                        </span>
                        <span className="text-[10px] text-gray-400">
                          {correlationData.correlation?.strength}
                        </span>
                      </div>
                    )}
                    {compHabit && loadingCorrelation && (
                      <div className="mb-4 inline-flex items-center gap-2 px-2.5 py-1.5 bg-white/70 backdrop-blur-md border border-gray-200/60 animate-pulse">
                        <div className="h-3 bg-gray-200 w-16"></div>
                      </div>
                    )}

                    <Suspense fallback={
                      <div className="flex items-center justify-center h-[300px]">
                        <div className="w-6 h-6 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin"></div>
                      </div>
                    }>
                      <div className="h-[350px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          {viewMode === 'chart' ? (
                            <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gray[200]} vertical={false} />
                              <XAxis
                                dataKey="shortDate"
                                stroke={COLORS.gray[400]}
                                tick={{ fill: COLORS.gray[600], fontSize: 11, fontWeight: 500 }}
                                axisLine={{ stroke: COLORS.gray[200] }}
                                tickLine={false}
                                dy={10}
                              />
                              <YAxis
                                yAxisId="left"
                                stroke={COLORS.gray[400]}
                                tick={{ fill: COLORS.gray[600], fontSize: 11, fontWeight: 500 }}
                                axisLine={false}
                                tickLine={false}
                                label={{ value: habit.unit_type || (habit as any).unit || '', angle: -90, position: 'insideLeft', style: { fill: COLORS.gray[400], fontSize: 10, fontWeight: 600 } }}
                              />
                              {compHabit && (
                                <YAxis
                                  yAxisId="right"
                                  orientation="right"
                                  stroke="#64748B"
                                  tick={{ fill: "#64748B", fontSize: 11, fontWeight: 500 }}
                                  axisLine={false}
                                  tickLine={false}
                                  label={{ value: compHabit.unit_type || (compHabit as any).unit || '', angle: 90, position: 'insideRight', style: { fill: "#64748B", fontSize: 10, fontWeight: 600 } }}
                                />
                              )}
                              <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(0,0,0,0.05)' }} />
                              <Bar
                                yAxisId="left"
                                dataKey="value"
                                name={habit.habit_name}
                                fill="#4A4A4C"
                                radius={[0, 0, 0, 0]}
                                maxBarSize={50}
                              />
                              {compHabit && (
                                <Bar
                                  yAxisId="right"
                                  dataKey="compValue"
                                  name={compHabit.habit_name}
                                  fill="#64748B"
                                  radius={[0, 0, 0, 0]}
                                  maxBarSize={50}
                                />
                              )}
                            </BarChart>
                          ) : (
                            <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                              <defs>
                                <linearGradient id={`gradient-${expandedHabit}`} x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="5%" stopColor="#4A4A4C" stopOpacity={0.25} />
                                  <stop offset="95%" stopColor="#4A4A4C" stopOpacity={0.03} />
                                </linearGradient>
                                {compHabit && (
                                  <linearGradient id={`gradient-comp`} x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#64748B" stopOpacity={0.15} />
                                    <stop offset="95%" stopColor="#64748B" stopOpacity={0} />
                                  </linearGradient>
                                )}
                              </defs>
                              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.gray[200]} vertical={false} />
                              <XAxis
                                dataKey="shortDate"
                                stroke={COLORS.gray[400]}
                                tick={{ fill: COLORS.gray[600], fontSize: 11, fontWeight: 500 }}
                                axisLine={{ stroke: COLORS.gray[200] }}
                                tickLine={false}
                                dy={10}
                              />
                              <YAxis
                                yAxisId="left"
                                stroke={COLORS.gray[400]}
                                tick={{ fill: COLORS.gray[600], fontSize: 11, fontWeight: 500 }}
                                axisLine={false}
                                tickLine={false}
                                label={{ value: habit.unit_type || (habit as any).unit || '', angle: -90, position: 'insideLeft', style: { fill: COLORS.gray[400], fontSize: 10, fontWeight: 600 } }}
                              />
                              {compHabit && (
                                <YAxis
                                  yAxisId="right"
                                  orientation="right"
                                  stroke="#64748B"
                                  tick={{ fill: "#64748B", fontSize: 11, fontWeight: 500 }}
                                  axisLine={false}
                                  tickLine={false}
                                  label={{ value: compHabit.unit_type || (compHabit as any).unit || '', angle: 90, position: 'insideRight', style: { fill: "#64748B", fontSize: 10, fontWeight: 600 } }}
                                />
                              )}
                              <Tooltip content={<CustomTooltip />} cursor={{ stroke: COLORS.gray[300], strokeWidth: 1, strokeDasharray: '4 4' }} />
                              <Area
                                yAxisId="left"
                                type="monotone"
                                dataKey="value"
                                stroke="#4A4A4C"
                                strokeWidth={2}
                                fill={`url(#gradient-${expandedHabit})`}
                                name={habit.habit_name}
                                activeDot={{ r: 4, fill: '#4A4A4C', stroke: '#fff', strokeWidth: 2 }}
                              />

                              {compHabit && (
                                <Area
                                  yAxisId="right"
                                  type="monotone"
                                  dataKey="compValue"
                                  stroke="#64748B"
                                  strokeWidth={2}
                                  fill={`url(#gradient-comp)`}
                                  name={compHabit.habit_name}
                                  activeDot={{ r: 4, fill: '#64748B', stroke: '#fff', strokeWidth: 2 }}
                                />
                              )}
                            </AreaChart>
                          )}
                        </ResponsiveContainer>
                      </div>
                    </Suspense>
                    </div>
                  </>
                );
              })()}
            </div>
          )}
        </>
      ) : null}

      {/* Computer Activity Section */}
      {showComputerActivity ? (
        <div className="mt-8">
          <ComputerActivitySection
            startDate={dateRange?.from ? format(dateRange.from, 'yyyy-MM-dd') : undefined}
            endDate={dateRange?.to ? format(dateRange.to, 'yyyy-MM-dd') : undefined}
            daysBack={30}
            isVisible={showComputerActivity}
            onDismiss={() => setShowComputerActivity(false)}
          />
        </div>
      ) : (
        <div className="mt-8 flex justify-center">
          <button
            onClick={() => setShowComputerActivity(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <Monitor className="w-4 h-4" />
            Show Computer Activity
          </button>
        </div>
      )}

      {/* Share Modal */}
      {showShareModal && shareImageUrl && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center">
          {/* Backdrop - matches habit-selection-modal style */}
          <div 
            className="absolute inset-0 bg-[#f6f6f3]/60"
            onClick={() => {
              setShowShareModal(false);
              setShareImageUrl(null);
            }}
          />
          
          {/* Modal */}
          <div className="relative bg-white rounded-xl shadow-2xl max-w-md w-full mx-4 overflow-hidden border border-gray-200">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-900">Share Chart</h3>
              <button
                onClick={() => {
                  setShowShareModal(false);
                  setShareImageUrl(null);
                }}
                className="p-1.5 transition-colors"
              >
                <X className="w-5 h-5 text-gray-400 hover:text-gray-600" />
              </button>
            </div>

            {/* Preview */}
            <div className="px-5 py-4">
              <div className="rounded-lg overflow-hidden border border-gray-200 shadow-sm">
                <img 
                  src={shareImageUrl} 
                  alt="Chart preview" 
                  className="w-full h-auto"
                />
              </div>
            </div>

            {/* Share Options */}
            <div className="px-5 pb-5">
              <div className="grid grid-cols-4 gap-3">
                {/* Copy - Save to Downloads and notify */}
                <button
                  onClick={async () => {
                    try {
                      // Convert data URL to binary
                      const base64Data = shareImageUrl!.split(',')[1];
                      const binaryString = atob(base64Data);
                      const bytes = new Uint8Array(binaryString.length);
                      for (let i = 0; i < binaryString.length; i++) {
                        bytes[i] = binaryString.charCodeAt(i);
                      }
                      
                      // Check if we're in Tauri
                      if (typeof window !== 'undefined' && '__TAURI__' in window) {
                        const { save } = await import('@tauri-apps/api/dialog');
                        const { writeBinaryFile } = await import('@tauri-apps/api/fs');
                        const { downloadDir } = await import('@tauri-apps/api/path');
                        
                        // Save to Downloads folder automatically
                        const downloadsPath = await downloadDir();
                        const fileName = `ritual-chart-${Date.now()}.png`;
                        const filePath = `${downloadsPath}${fileName}`;
                        
                        await writeBinaryFile(filePath, bytes);
                        
                        // Update button text to show success
                        const btn = document.activeElement as HTMLButtonElement;
                        if (btn?.querySelector('span')) {
                          btn.querySelector('span')!.textContent = 'Saved!';
                          setTimeout(() => {
                            btn.querySelector('span')!.textContent = 'Copy';
                          }, 2000);
                        }
                      } else {
                        // Browser fallback
                        const blob = new Blob([bytes], { type: 'image/png' });
                        const url = URL.createObjectURL(blob);
                        const link = document.createElement('a');
                        link.download = `ritual-chart-${Date.now()}.png`;
                        link.href = url;
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                        URL.revokeObjectURL(url);
                      }
                    } catch (error) {
                      console.error('Failed to save:', error);
                    }
                  }}
                  className="flex flex-col items-center gap-2 p-3 rounded-xl hover:bg-gray-50 transition-colors group"
                >
                  <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center group-hover:bg-gray-200 transition-colors">
                    <Copy className="w-5 h-5 text-gray-700" />
                  </div>
                  <span className="text-xs text-gray-600 font-medium">Copy</span>
                </button>

                {/* Download - with save dialog */}
                <button
                  onClick={async () => {
                    try {
                      // Convert data URL to binary
                      const base64Data = shareImageUrl!.split(',')[1];
                      const binaryString = atob(base64Data);
                      const bytes = new Uint8Array(binaryString.length);
                      for (let i = 0; i < binaryString.length; i++) {
                        bytes[i] = binaryString.charCodeAt(i);
                      }
                      
                      // Check if we're in Tauri
                      if (typeof window !== 'undefined' && '__TAURI__' in window) {
                        const { save } = await import('@tauri-apps/api/dialog');
                        const { writeBinaryFile } = await import('@tauri-apps/api/fs');
                        
                        // Show save dialog
                        const filePath = await save({
                          defaultPath: `ritual-chart-${Date.now()}.png`,
                          filters: [{ name: 'PNG Image', extensions: ['png'] }]
                        });
                        
                        if (filePath) {
                          await writeBinaryFile(filePath, bytes);
                          // Update button text to show success
                          const btn = document.activeElement as HTMLButtonElement;
                          if (btn?.querySelector('span')) {
                            btn.querySelector('span')!.textContent = 'Saved!';
                            setTimeout(() => {
                              btn.querySelector('span')!.textContent = 'Download';
                            }, 2000);
                          }
                        }
                      } else {
                        // Browser fallback
                        const blob = new Blob([bytes], { type: 'image/png' });
                        const url = URL.createObjectURL(blob);
                        const link = document.createElement('a');
                        link.download = `ritual-chart-${Date.now()}.png`;
                        link.href = url;
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                        URL.revokeObjectURL(url);
                      }
                    } catch (error) {
                      console.error('Failed to download:', error);
                    }
                  }}
                  className="flex flex-col items-center gap-2 p-3 rounded-xl hover:bg-gray-50 transition-colors group"
                >
                  <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center group-hover:bg-gray-200 transition-colors">
                    <Download className="w-5 h-5 text-gray-700" />
                  </div>
                  <span className="text-xs text-gray-600 font-medium">Download</span>
                </button>

                {/* Twitter/X */}
                <button
                  onClick={() => {
                    const text = encodeURIComponent('Check out my habit tracking progress! 📊 #RitualApp');
                    window.open(`https://twitter.com/intent/tweet?text=${text}`, '_blank', 'width=550,height=420');
                  }}
                  className="flex flex-col items-center gap-2 p-3 rounded-xl hover:bg-gray-50 transition-colors group"
                >
                  <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center group-hover:bg-gray-200 transition-colors">
                    <svg className="w-5 h-5 text-gray-700" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                    </svg>
                  </div>
                  <span className="text-xs text-gray-600 font-medium">X</span>
                </button>

                {/* Reddit */}
                <button
                  onClick={() => {
                    const title = encodeURIComponent('My habit tracking progress 📊');
                    window.open(`https://www.reddit.com/submit?title=${title}`, '_blank', 'width=550,height=420');
                  }}
                  className="flex flex-col items-center gap-2 p-3 rounded-xl hover:bg-gray-50 transition-colors group"
                >
                  <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center group-hover:bg-gray-200 transition-colors">
                    <svg className="w-5 h-5 text-gray-700" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z"/>
                    </svg>
                  </div>
                  <span className="text-xs text-gray-600 font-medium">Reddit</span>
                </button>
              </div>

              {/* Tip */}
              <p className="text-[11px] text-gray-400 text-center mt-4">
                Download the image first, then attach it to your post
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}



