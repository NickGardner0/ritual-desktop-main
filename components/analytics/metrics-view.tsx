/**
 * MetricsView - Analytics/Metrics content for unified Analytics page
 * 
 * Wraps the existing AnalyticsClient content for use in the unified page.
 * Designed to work with shared filter context or standalone.
 */

'use client';

import React, { useState, useEffect, Suspense, useRef, useCallback } from 'react';
import { useAuth, useUser } from '@clerk/nextjs';
import { useQuery } from '@tanstack/react-query';
import {
  X,
  ChevronDown,
  Check,
  Share2,
  Copy,
  Download,
  Monitor
} from 'lucide-react';
import { DateRangePicker } from '@/components/date-range-picker';
import { DateRange } from 'react-day-picker';
import { format, parseISO, startOfDay, differenceInDays, subDays, isWithinInterval } from 'date-fns';
import { HabitTickerGrid, AnalyticsViewToggle } from '@/components/analytics/habit-ticker-view';
import { analyticsApi, type HabitStats } from '@/lib/services/analytics-api';
import { ComputerActivitySection } from '@/components/analytics/computer-activity';
import { useAnalyticsFiltersOptional } from './analytics-filter-context';
import { useHabits } from '@/contexts/HabitsContext';

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

interface MetricsViewProps {
  // Optional: Allow passing in external filter state for standalone use
  externalDateRange?: DateRange | undefined;
  onDateRangeChange?: (range: DateRange | undefined) => void;
  // Hide controls when used inside unified page (controls are in parent)
  hideControls?: boolean;
  // External chart view mode (when controlled by parent)
  externalChartViewMode?: 'chart' | 'ticker';
  onChartViewModeChange?: (mode: 'chart' | 'ticker') => void;
}

// Metric Card Component
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

      <div className="flex items-start justify-between gap-1 mb-1">
        <div className="flex-1 min-w-0 overflow-hidden">
          <h3 className="font-medium text-[12px] text-gray-900 truncate leading-tight">
            {habitName}
          </h3>
          <p className="text-[9px] text-gray-500 uppercase tracking-wider truncate">
            {unit}
          </p>
        </div>

        <div className="flex flex-col items-end shrink-0">
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

      <p className="text-base font-semibold text-gray-900 tabular-nums leading-tight">
        {currentValue.toFixed(currentValue < 10 ? 2 : 0)}
      </p>
    </div>
  );
};

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    const primaryValue = payload[0]?.value;
    const comparisonValue = payload[1]?.value;
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
          <div className="flex items-center justify-between gap-6">
            <span className="text-gray-500">{payload.length > 1 ? payload[0]?.name || 'Value' : 'Value'}</span>
            <span className="text-gray-900 font-semibold tabular-nums">
              {typeof primaryValue === 'number' ? primaryValue.toFixed(1) : primaryValue}
              {primaryUnit && <span className="text-gray-500 font-normal ml-1">{primaryUnit}</span>}
            </span>
          </div>

          {comparisonValue !== undefined && (
            <div className="flex items-center justify-between gap-6">
              <span className="text-slate-500">{payload[1]?.name || 'Comparison'}</span>
              <span className="text-slate-500 font-semibold tabular-nums">
                {typeof comparisonValue === 'number' ? comparisonValue.toFixed(1) : comparisonValue}
                {compUnit && <span className="font-normal ml-1">{compUnit}</span>}
              </span>
            </div>
          )}

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

// Custom Dropdown Component
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
              className={`px-3 py-2 text-xs cursor-pointer flex items-center justify-between group hover:bg-[#F3F3F3] ${value === option.value ? 'bg-[#F3F3F3] text-gray-900 font-medium' : 'text-gray-600'}`}
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

// Helper to determine start/end dates
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
    case 'ALL': return { from: subDays(now, 365 * 5), to: now };
    default: return { from: subDays(now, 30), to: now };
  }
};

// Analytics Query Hook
function useAnalyticsSummary() {
  const { user, isLoaded: isUserLoaded } = useUser();
  const { getToken } = useAuth();

  return useQuery({
    queryKey: ['analytics-summary', user?.id],
    enabled: isUserLoaded && !!user?.id,
    queryFn: async () => {
      const token = await getToken();
      if (!token) {
        throw new Error('No auth token available');
      }
      
      const backendUrl = process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';

      const [habitsRes, summaryRes, habitsSummaryRes] = await Promise.all([
        fetch(`${backendUrl}/api/habits`, {
          headers: { 'Authorization': `Bearer ${token}` },
          credentials: 'include'
        }),
        fetch('/api/analytics/summary', { credentials: 'include' }),
        fetch('/api/analytics/habits/summary', { credentials: 'include' })
      ]);

      if (!habitsRes.ok || !summaryRes.ok) {
        throw new Error('Failed to fetch analytics data');
      }

      const habits = await habitsRes.json();
      const summaryData = await summaryRes.json();
      const habitsSummaryData = habitsSummaryRes.ok ? await habitsSummaryRes.json() : { data: [] };

      const tinybirdHabitMetrics: Record<string, any> = {};
      (habitsSummaryData.data || []).forEach((h: any) => {
        tinybirdHabitMetrics[h.habit_id] = h;
      });

      const transformedHabits = habits.map((h: any) => ({
        ...h,
        habit_id: h.id,
        habit_name: h.name,
        category: h.category,
        icon: h.icon,
        unit_type: h.unit_type,
      }));

      const summary = summaryData.data || {};

      return {
        habits: transformedHabits,
        tinybirdHabitMetrics,
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
    staleTime: 60 * 1000,
    gcTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
    refetchOnMount: true,
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 5000),
  });
}

export function MetricsView({ 
  externalDateRange, 
  onDateRangeChange,
  hideControls = false,
  externalChartViewMode,
  onChartViewModeChange
}: MetricsViewProps) {
  const { getToken } = useAuth();
  const { user, isLoaded: isUserLoaded } = useUser();
  
  // Use shared habits context instead of separate query
  const { habits: contextHabits, isLoading: habitsLoading } = useHabits();
  
  // Transform habits to match expected format (habit_id instead of id)
  const transformedHabits = React.useMemo(() => 
    contextHabits
      .filter(h => h.id) // Filter out habits without id
      .map(h => ({
        ...h,
        habit_id: h.id!, // Assert non-null since we filtered
        habit_name: h.name,
        category: h.category,
        icon: h.icon,
        unit_type: h.unit_type,
      })), [contextHabits]
  );
  
  // Try to use shared filter context, fall back to local state
  const filterContext = useAnalyticsFiltersOptional();
  
  // Local state for when not using context
  const [localDateRange, setLocalDateRange] = useState<DateRange | undefined>(undefined);
  const [localSelectedHabits, setLocalSelectedHabits] = useState<string[]>([]);
  
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
  
  const selectedHabits = filterContext?.selectedHabits ?? localSelectedHabits;
  const setSelectedHabits = filterContext?.setSelectedHabits ?? setLocalSelectedHabits;
  
  // Only show loading for initial load, not background refetches
  const queryLoading = habitsLoading;

  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [habitDropdownOpen, setHabitDropdownOpen] = useState(false);
  const [analyticsData, setAnalyticsData] = useState<any>({});
  const [expandedHabit, setExpandedHabit] = useState<string | null>(null);
  const [expandedLogs, setExpandedLogs] = useState<any[]>([]);
  const [loadingExpandedLogs, setLoadingExpandedLogs] = useState(false);

  const [allHabitStats, setAllHabitStats] = useState<Record<string, HabitStats>>({});
  const [loadingAllStats, setLoadingAllStats] = useState(false);

  const [expandedTimeRange, setExpandedTimeRange] = useState<'1D' | '1W' | '1M' | '3M' | '6M' | 'YTD' | '1Y' | 'ALL'>('1M');
  const [compareHabitId, setCompareHabitId] = useState<string | null>(null);
  const [comparisonLogs, setComparisonLogs] = useState<any[]>([]);
  const [loadingComparison, setLoadingComparison] = useState(false);
  const [localViewMode, setLocalViewMode] = useState<'chart' | 'ticker'>('chart');
  
  // Use external view mode if provided, otherwise use local state
  const viewMode = externalChartViewMode ?? localViewMode;
  const setViewMode = onChartViewModeChange ?? setLocalViewMode;

  const [showComputerActivity, setShowComputerActivity] = useState(true);
  const [correlationData, setCorrelationData] = useState<any>(null);
  const [loadingCorrelation, setLoadingCorrelation] = useState(false);

  const [showShareModal, setShowShareModal] = useState(false);
  const [shareImageUrl, setShareImageUrl] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const chartRef = useRef<HTMLDivElement>(null);

  // Use transformed habits from shared context
  const availableHabits = transformedHabits;
  const [defaultTinybirdMetrics, setDefaultTinybirdMetrics] = useState<Record<string, any>>({});

  const [customPeriodMetrics, setCustomPeriodMetrics] = useState<Record<string, any>>({});
  const [loadingPeriodMetrics, setLoadingPeriodMetrics] = useState(false);

  const tinybirdHabitMetrics = dateRange?.from && dateRange?.to
    ? customPeriodMetrics
    : defaultTinybirdMetrics;

  // Load view mode from localStorage
  useEffect(() => {
    setMounted(true);
    const savedViewMode = localStorage.getItem('analytics-view-mode');
    if (savedViewMode) {
      setViewMode(savedViewMode as 'chart' | 'ticker');
    } else {
      setViewMode('ticker');
    }
  }, []);

  // Auto-select all habits when data loads
  useEffect(() => {
    if (availableHabits.length > 0 && selectedHabits.length === 0) {
      const allHabitIds = availableHabits.map((h: HabitData) => h.habit_id).filter((id: string) => !!id);
      if (allHabitIds.length > 0) {
        setSelectedHabits(allHabitIds);
      }
    }
  }, [availableHabits, selectedHabits.length, setSelectedHabits]);

  // Persist viewMode
  useEffect(() => {
    if (mounted) {
      localStorage.setItem('analytics-view-mode', viewMode);
    }
  }, [viewMode, mounted]);

  // Fetch default Tinybird metrics on mount
  useEffect(() => {
    if (!isUserLoaded || !user?.id) return;
    
    const fetchDefaultMetrics = async () => {
      try {
        const res = await fetch('/api/analytics/habits/summary');
        if (res.ok) {
          const data = await res.json();
          const metricsMap: Record<string, any> = {};
          (data.data || []).forEach((h: any) => {
            metricsMap[h.habit_id] = h;
          });
          setDefaultTinybirdMetrics(metricsMap);
        }
      } catch (error) {
        console.error('❌ Failed to fetch default Tinybird metrics:', error);
      }
    };

    fetchDefaultMetrics();
  }, [isUserLoaded, user?.id]);

  // Fetch period comparison when date range changes
  useEffect(() => {
    if (!dateRange?.from || !dateRange?.to) {
      setCustomPeriodMetrics({});
      return;
    }

    const fetchPeriodComparison = async () => {
      setLoadingPeriodMetrics(true);
      try {
        const startDate = format(dateRange.from!, 'yyyy-MM-dd');
        const endDate = format(dateRange.to!, 'yyyy-MM-dd');

        const res = await fetch(`/api/analytics/habits/summary?start_date=${startDate}&end_date=${endDate}`);

        if (res.ok) {
          const data = await res.json();
          const metricsMap: Record<string, any> = {};
          (data.data || []).forEach((h: any) => {
            metricsMap[h.habit_id] = h;
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

  // Fetch correlation data
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

  // Fetch analytics data
  useEffect(() => {
    const validSelected = selectedHabits.filter((id: string) => !!id);
    const habitsToFetch = validSelected.length > 0
      ? validSelected
      : availableHabits.map((h: HabitData) => h.habit_id).filter((id: string) => !!id);

    if (habitsToFetch.length === 0) {
      setLoading(false);
      return;
    }

    const fetchAnalytics = async () => {
      const hasExistingData = Object.keys(analyticsData).length > 0;
      if (!hasExistingData) {
        setLoading(true);
      }
      try {
        const now = new Date();
        
        // If no date range is set (All time), fetch a large range (3 years)
        const isAllTime = !dateRange?.from && !dateRange?.to;
        const to = dateRange?.to || now;
        const from = dateRange?.from || (isAllTime ? subDays(now, 1095) : subDays(now, 30)); // 3 years for all time

        const durationDays = differenceInDays(to, from) + 1;
        const daysFromNow = differenceInDays(now, from);
        const totalDaysBack = daysFromNow + durationDays;
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
  }, [selectedHabits.join(','), availableHabits.length, dateRange?.from?.toISOString(), dateRange?.to?.toISOString()]);

  const hasCustomDateRange = !!(dateRange?.from && dateRange?.to);

  // Fetch expanded logs
  useEffect(() => {
    if (!expandedHabit) {
      setExpandedLogs([]);
      setExpandedTimeRange('1M');
      setCompareHabitId(null);
      setComparisonLogs([]);
      return;
    }

    const fetchExpandedLogs = async () => {
      setLoadingExpandedLogs(true);
      try {
        let from: Date, to: Date;
        if (hasCustomDateRange) {
          from = dateRange!.from!;
          to = dateRange!.to!;
        } else {
          const rangeDates = getRangeDates(expandedTimeRange);
          from = rangeDates.from;
          to = rangeDates.to;
        }

        const startDate = format(from, 'yyyy-MM-dd');
        const endDate = format(to, 'yyyy-MM-dd');

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

  // Fetch comparison logs
  useEffect(() => {
    if (!expandedHabit || !compareHabitId) {
      setComparisonLogs([]);
      return;
    }

    const fetchComparisonLogs = async () => {
      setLoadingComparison(true);
      try {
        let from: Date, to: Date;
        if (hasCustomDateRange) {
          from = dateRange!.from!;
          to = dateRange!.to!;
        } else {
          const rangeDates = getRangeDates(expandedTimeRange);
          from = rangeDates.from;
          to = rangeDates.to;
        }
        const startDate = format(from, 'yyyy-MM-dd');
        const endDate = format(to, 'yyyy-MM-dd');

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

  // Fetch all habit stats
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
        }
      } catch (error) {
        console.error('❌ Error fetching all stats from Python API:', error);
      } finally {
        setLoadingAllStats(false);
      }
    };

    fetchAllStats();
  }, [selectedHabits.join(','), dateRange?.from?.toISOString(), dateRange?.to?.toISOString(), getToken]);

  const toggleHabit = (habitId: string) => {
    if (filterContext) {
      filterContext.toggleHabit(habitId);
    } else {
      setLocalSelectedHabits(prev =>
        prev.includes(habitId)
          ? prev.filter(id => id !== habitId)
          : [...prev, habitId]
      );
    }
  };

  // Get habit card data
  const getHabitCardData = (habitId: string) => {
    const logs = analyticsData[habitId] || [];
    const habit = availableHabits.find((h: HabitData) => h.habit_id === habitId);
    if (!habit) return null;

    const now = new Date();
    const isAllTime = !dateRange?.from && !dateRange?.to;
    
    // For "All time", use all logs; otherwise filter by date range
    let currentLogs: any[];
    let prevLogs: any[] = [];
    let durationDays: number;
    
    if (isAllTime) {
      // Use ALL logs for "All time" view
      currentLogs = logs;
      durationDays = logs.length > 0 ? 
        differenceInDays(now, parseISO(logs[logs.length - 1]?.date || logs[0]?.date)) + 1 : 
        30;
    } else {
      const currentTo = dateRange?.to ? startOfDay(dateRange.to) : startOfDay(now);
      const currentFrom = dateRange?.from ? startOfDay(dateRange.from) : startOfDay(subDays(now, 30));
      
      durationDays = differenceInDays(currentTo, currentFrom) + 1;
      
      const prevTo = subDays(currentFrom, 1);
      const prevFrom = subDays(currentFrom, durationDays);
      
      currentLogs = logs.filter((log: any) => {
        const d = parseISO(log.date);
        return isWithinInterval(d, { start: currentFrom, end: currentTo });
      });
      
      prevLogs = logs.filter((log: any) => {
        const d = parseISO(log.date);
        return isWithinInterval(d, { start: prevFrom, end: prevTo });
      });
    }

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
        rawDate: date
      };
    }).sort((a: any, b: any) => a.rawDate.getTime() - b.rawDate.getTime());

    const calculateAvg = (periodLogs: any[]) => {
      if (periodLogs.length === 0) return 0;
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

      return total / uniqueDays;
    };

    const pythonStats = allHabitStats[habitId];
    const tbMetrics = tinybirdHabitMetrics[habitId];
    const localCurrentAvg = calculateAvg(currentLogs);
    const localPreviousAvg = calculateAvg(prevLogs);

    const currentAvg = pythonStats?.average ?? tbMetrics?.avg_amount ?? localCurrentAvg;
    const totalValue = pythonStats?.total ?? tbMetrics?.total_amount ?? chartData.reduce((sum: number, d: { value: number }) => sum + d.value, 0);
    const daysWithData = pythonStats?.days_with_data ?? tbMetrics?.days_with_data ?? chartData.length;

    // Calculate change by comparing first half vs second half of the date range
    // This provides consistent, actionable insights regardless of the selected range
    let change = 0;
    let absoluteChange = 0;
    let lastPeriodAvg = 0;
    let firstPeriodAvg = 0;

    if (chartData.length >= 2) {
      const sortedData = [...chartData].sort((a: any, b: any) => 
        new Date(a.rawDate).getTime() - new Date(b.rawDate).getTime()
      );
      
      // Split into first half and second half (up to 7 days each for larger ranges)
      const halfPoint = Math.floor(sortedData.length / 2);
      const firstHalf = sortedData.slice(0, Math.min(7, halfPoint) || halfPoint);
      const secondHalf = sortedData.slice(Math.max(sortedData.length - 7, halfPoint));
      
      firstPeriodAvg = firstHalf.length > 0 
        ? firstHalf.reduce((sum: number, d: any) => sum + (d.value || 0), 0) / firstHalf.length 
        : 0;
      lastPeriodAvg = secondHalf.length > 0 
        ? secondHalf.reduce((sum: number, d: any) => sum + (d.value || 0), 0) / secondHalf.length 
        : 0;
      
      if (firstPeriodAvg > 0) {
        change = ((lastPeriodAvg - firstPeriodAvg) / firstPeriodAvg) * 100;
        absoluteChange = lastPeriodAvg - firstPeriodAvg;
      } else if (lastPeriodAvg > 0) {
        change = 100;
        absoluteChange = lastPeriodAvg;
      }
    } else if (chartData.length === 1) {
      // Only one data point - use it as the current value
      lastPeriodAvg = chartData[0]?.value || 0;
    }

    // Current value is the average of the second half (most recent period)
    let currentValue = lastPeriodAvg;
    
    // Fallback to overall average if no period average calculated
    if (currentValue === 0 && chartData.length >= 1) {
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
      total: totalValue,
      average: currentAvg,
      daysWithData,
      pythonStats,
      tinybirdMetrics: tbMetrics,
      loadingStats: loadingAllStats,
    };
  };

  // Get expanded data
  const getExpandedData = (habitId: string) => {
    const habit = availableHabits.find((h: HabitData) => h.habit_id === habitId);
    if (!habit) return null;

    const processLogsToMap = (logsSource: any[], unitType: any) => {
      if (!logsSource || !logsSource.length) return { byDate: {}, logs: {} };

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

      const logsMap = uniqueLogs.reduce((acc: any, log: any) => {
        if (!acc[log.date]) acc[log.date] = [];
        acc[log.date].push(log);
        return acc;
      }, {});

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

    const mainData = processLogsToMap(expandedLogs, habit.unit_type || (habit as any).unit);

    let compData = { byDate: {}, logs: {} };
    let compHabit: any = null;
    if (compareHabitId) {
      compHabit = availableHabits.find((h: HabitData) => h.habit_id === compareHabitId);
      if (compHabit) {
        compData = processLogsToMap(comparisonLogs, compHabit.unit_type || (compHabit as any).unit);
      }
    }

    const allDates = Array.from(new Set([...Object.keys(mainData.byDate), ...Object.keys(compData.byDate)])).sort();

    const values = Object.values(mainData.byDate) as number[];
    const totalValue = values.reduce((a, b) => a + b, 0);
    const avgValue = values.length ? totalValue / values.length : 0;
    const minValue = values.length ? Math.min(...values) : 0;
    const maxValue = values.length ? Math.max(...values) : 0;
    const variance = values.length ? values.reduce((a, b) => a + Math.pow(b - avgValue, 2), 0) / values.length : 0;
    const stdDev = Math.sqrt(variance);

    const chartData = allDates.map(dateStr => {
      const date = parseISO(dateStr);
      const val = (mainData.byDate as any)[dateStr] || 0;
      const cVal = (compData.byDate as any)[dateStr];

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
      {/* Top Bar: Controls Layout - only show if not hidden */}
      {!hideControls && (
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <AnalyticsViewToggle
              currentView={viewMode}
              onViewChange={setViewMode}
              darkMode={false}
            />

            {/* Habit Filter Dropdown */}
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
                      <button
                        onClick={() => {
                          if (selectedHabits.length === availableHabits.length) {
                            if (filterContext) {
                              filterContext.clearHabitSelection();
                            } else {
                              setLocalSelectedHabits([]);
                            }
                          } else {
                            if (filterContext) {
                              filterContext.selectAllHabits(availableHabits.map((h: HabitData) => h.habit_id));
                            } else {
                              setLocalSelectedHabits(availableHabits.map((h: HabitData) => h.habit_id));
                            }
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

          <div className="flex items-center gap-3">
            <DateRangePicker
              className="w-auto"
              onDateRangeChange={setDateRange}
              initialDateRange={dateRange}
            />
          </div>
        </div>
      )}

      {/* Controls are now in parent (unified-analytics-client) when hideControls is true */}

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
          {(() => {
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
                            if (filterContext) {
                              filterContext.setSelectedHabits((prev: string[]) => prev.filter((id: string) => id !== habitId));
                            } else {
                              setLocalSelectedHabits(prev => prev.filter((id: string) => id !== habitId));
                            }
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
              const tickerHabits = habitsToShow.map((habitId: string) => {
                const cardData = getHabitCardData(habitId);
                const habit = availableHabits.find((h: HabitData) => h.habit_id === habitId);
                const tbMetrics = tinybirdHabitMetrics[habitId];

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
                  stability_class: tbMetrics?.stability_class as 'stable' | 'moderate' | 'variable' | undefined,
                  consistency_score: tbMetrics?.consistency_score,
                };
              }).filter((item: any): item is NonNullable<typeof item> => item !== null);

              return (
                <div className={`transition-opacity duration-300 ${
                  expandedHabit ? 'opacity-50 pointer-events-auto' : 'opacity-100'
                }`}>
                  <HabitTickerGrid
                    habits={tickerHabits}
                    onHabitClick={(habitId) => setExpandedHabit(expandedHabit === habitId ? null : habitId)}
                    onHabitRemove={(habitId) => {
                      if (filterContext) {
                        filterContext.setSelectedHabits((prev: string[]) => prev.filter(id => id !== habitId));
                      } else {
                        setLocalSelectedHabits(prev => prev.filter(id => id !== habitId));
                      }
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

          {/* Expanded View */}
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

                    {/* Toolbar */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
                      {hasCustomDateRange ? (
                        <div className="flex items-center gap-2 px-3 py-1.5 bg-[#F3F3F3] border border-gray-300">
                          <span className="text-xs font-medium text-gray-700">
                            {format(dateRange!.from!, 'MMM d')} – {format(dateRange!.to!, 'MMM d, yyyy')}
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
                      </div>
                    </div>

                    {/* Stats Grid */}
                    <div ref={chartRef} className="bg-white">
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

                      {/* Correlation Display */}
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

                      {/* Chart */}
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
                                />
                                {compHabit && (
                                  <YAxis
                                    yAxisId="right"
                                    orientation="right"
                                    stroke="#64748B"
                                    tick={{ fill: "#64748B", fontSize: 11, fontWeight: 500 }}
                                    axisLine={false}
                                    tickLine={false}
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
                                />
                                {compHabit && (
                                  <YAxis
                                    yAxisId="right"
                                    orientation="right"
                                    stroke="#64748B"
                                    tick={{ fill: "#64748B", fontSize: 11, fontWeight: 500 }}
                                    axisLine={false}
                                    tickLine={false}
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
    </>
  );
}
