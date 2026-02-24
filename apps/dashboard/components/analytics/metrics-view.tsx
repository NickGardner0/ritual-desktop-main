/**
 * MetricsView - Analytics/Metrics content for unified Analytics page
 * 
 * Metrics content used by the unified analytics page.
 * Designed to work with shared filter context or standalone.
 */

'use client';

import React, { useState, useEffect, Suspense, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useAuth, useUser } from '@clerk/nextjs';
import {
  ChevronDown,
  Grid3X3,
  Minus,
  Monitor,
} from 'lucide-react';
import type { DateRange } from 'react-day-picker';
import { format, parseISO, startOfDay, differenceInDays, subDays } from 'date-fns';
import { AnalyticsViewToggle } from '@/components/analytics/analytics-view-toggle';
import { analyticsApi } from '@/lib/services/analytics-api';
import { useAnalyticsFiltersOptional } from './analytics-filter-context';
import { useHabits } from '@/contexts/HabitsContext';
import type { RangeKey } from '@/components/charts/PerplexityExpandedHabitChart';
import { habitToFinanceSeries } from '@/lib/charts/habitToFinanceSeries';
import { BrailleSpinner } from '@/components/ui/braille-spinner';
import { ExpandedMetricCard } from '@/components/metrics/ExpandedMetricCard';
import type { RangeOption } from '@/components/metrics/RangeSegmentedControl';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const DateRangePicker = dynamic(
  () => import('@/components/date-range-picker').then(m => ({ default: m.DateRangePicker })),
  { ssr: false }
);

const HabitMetricCard = dynamic(
  () => import('./habit-metric-card').then(m => ({ default: m.HabitMetricCard })),
  { ssr: false }
);

const HabitTickerGrid = dynamic(
  () => import('@/components/analytics/habit-ticker-view').then(m => ({ default: m.HabitTickerGrid })),
  { ssr: false }
);

const PerplexityExpandedHabitChart = dynamic(
  () => import('@/components/charts/PerplexityExpandedHabitChart').then(m => ({ default: m.PerplexityExpandedHabitChart })),
  { ssr: false }
);

const ComputerActivitySection = dynamic(
  () => import('@/components/analytics/computer-activity').then(m => ({ default: m.ComputerActivitySection })),
  { ssr: false }
);

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


// Custom Dropdown Component
type CompareOption = { label: string; value: string };

interface CompareSelectProps {
  value: string | null;
  options: CompareOption[];
  onChange: (value: string | null) => void;
  placeholder?: string;
}

const COMPARE_NONE_VALUE = '__none__';

const CompareSelect = ({
  value,
  options,
  onChange,
  placeholder = 'Compare',
}: CompareSelectProps) => (
  <Select
    value={value ?? COMPARE_NONE_VALUE}
    onValueChange={(nextValue) =>
      onChange(nextValue === COMPARE_NONE_VALUE ? null : nextValue)
    }
  >
    <SelectTrigger className="h-8 min-w-[132px] rounded-none border-gray-300 bg-white px-2.5 text-xs text-gray-700 transition-colors hover:bg-[#F3F3F3] hover:text-gray-900 focus:bg-[#F3F3F3] focus:outline-none focus:ring-0">
      <SelectValue placeholder={placeholder} />
    </SelectTrigger>
    <SelectContent align="end" className="rounded-none border-gray-300 bg-white shadow-[0_14px_32px_rgba(15,23,42,0.12)]">
      <SelectItem value={COMPARE_NONE_VALUE} className="text-muted-foreground">
        None
      </SelectItem>
      {options.map((option) => (
        <SelectItem key={option.value} value={option.value}>
          {option.label}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
);

// Helper to determine start/end dates
const getRangeDates = (range: RangeKey) => {
  const now = new Date();
  const todayStart = startOfDay(now);
  switch (range) {
    // Inclusive ranges: e.g. 1W = 7 calendar days including today.
    case '1D': return { from: todayStart, to: now };
    case '5D': return { from: subDays(todayStart, 4), to: now };
    case '1W': return { from: subDays(todayStart, 6), to: now };
    case '1M': return { from: subDays(todayStart, 29), to: now };
    case '3M': return { from: subDays(todayStart, 89), to: now };
    case '6M': return { from: subDays(todayStart, 179), to: now };
    case 'YTD': return { from: startOfDay(new Date(now.getFullYear(), 0, 1)), to: now };
    case '1Y': return { from: subDays(todayStart, 364), to: now };
    case '5Y': return { from: subDays(todayStart, (365 * 5) - 1), to: now };
    case 'MAX': return { from: subDays(todayStart, (365 * 5) - 1), to: now };
    case 'ALL': return { from: subDays(todayStart, (365 * 5) - 1), to: now };
    default: return { from: subDays(todayStart, 29), to: now };
  }
};

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

  const [summaryMetrics, setSummaryMetrics] = useState<Record<string, any>>({});

  const [expandedTimeRange, setExpandedTimeRange] = useState<RangeKey>('1M');
  const [compareHabitId, setCompareHabitId] = useState<string | null>(null);
  const [comparisonLogs, setComparisonLogs] = useState<any[]>([]);
  const [loadingComparison, setLoadingComparison] = useState(false);
  const [localViewMode, setLocalViewMode] = useState<'chart' | 'ticker'>('chart');
  const [showChartGrid, setShowChartGrid] = useState(true);
  const [showBaseline, setShowBaseline] = useState(true);
  
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

  // Fetch canonical daily values + summary (Tinybird first, Python fallback only on failure)
  useEffect(() => {
    if (!isUserLoaded || !user?.id) return;

    const validSelected = selectedHabits.filter((id: string) => !!id);
    const habitsToFetch = validSelected.length > 0
      ? validSelected
      : availableHabits.map((h: HabitData) => h.habit_id).filter((id: string) => !!id);

    if (habitsToFetch.length === 0) {
      setLoading(false);
      return;
    }

    const fetchCanonicalAnalytics = async () => {
      const hasExistingData = Object.keys(analyticsData).length > 0;
      if (!hasExistingData) {
        setLoading(true);
      }

      const params = new URLSearchParams();
      if (dateRange?.from && dateRange?.to) {
        params.set('start_date', format(dateRange.from, 'yyyy-MM-dd'));
        params.set('end_date', format(dateRange.to, 'yyyy-MM-dd'));
      } else {
        params.set('days_back', '1095');
      }

      try {
        const [dailyRes, summaryRes] = await Promise.all([
          fetch(`/api/analytics/habits/daily-values?output=daily&${params.toString()}`),
          fetch(`/api/analytics/habits/daily-values?output=summary&${params.toString()}`),
        ]);

        if (!dailyRes.ok || !summaryRes.ok) {
          throw new Error(`Tinybird canonical fetch failed (daily=${dailyRes.status}, summary=${summaryRes.status})`);
        }

        const [dailyPayload, summaryPayload] = await Promise.all([
          dailyRes.json(),
          summaryRes.json(),
        ]);

        const dataByHabit: Record<string, any[]> = {};
        habitsToFetch.forEach((habitId: string) => {
          dataByHabit[habitId] = [];
        });

        (dailyPayload.data || []).forEach((row: any) => {
          if (habitsToFetch.includes(row.habit_id)) {
            dataByHabit[row.habit_id].push(row);
          }
        });

        const summaryMap: Record<string, any> = {};
        (summaryPayload.data || []).forEach((row: any) => {
          summaryMap[row.habit_id] = row;
        });

        setAnalyticsData(dataByHabit);
        setSummaryMetrics(summaryMap);
      } catch (error) {
        console.error('❌ Tinybird canonical analytics failed, falling back to Python:', error);

        const token = await getToken();
        if (!token) return;

        const now = new Date();
        const to = dateRange?.to || now;
        const from = dateRange?.from || subDays(now, 30);
        const fallbackDays = Math.max(1, differenceInDays(to, from) + 1);

        const [statsResult, dailyResults] = await Promise.all([
          analyticsApi.getHabitStats(token, {
            startDate: format(from, 'yyyy-MM-dd'),
            endDate: format(to, 'yyyy-MM-dd'),
          }),
          Promise.all(
            habitsToFetch.map((habitId) =>
              analyticsApi.getDailyBreakdown(token, {
                habitId,
                daysBack: fallbackDays,
              }).catch(() => null)
            )
          ),
        ]);

        const fallbackSummaryMap: Record<string, any> = {};
        (statsResult.habits || []).forEach((stat: any) => {
          fallbackSummaryMap[stat.id] = {
            habit_id: stat.id,
            habit_name: stat.name,
            unit: stat.unit,
            total_value: stat.total,
            current_value: stat.average,
            previous_value: 0,
            change_pct: 0,
            absolute_change: 0,
            days_with_data: stat.days_with_data,
          };
        });

        const fallbackDailyByHabit: Record<string, any[]> = {};
        habitsToFetch.forEach((habitId: string, index: number) => {
          const response = dailyResults[index];
          const rows = response?.daily_data || [];
          fallbackDailyByHabit[habitId] = rows.map((point: any) => ({
            habit_id: habitId,
            date: point.date,
            daily_value: Number(point.value || 0),
            unit: point.unit,
            total_amount: Number(point.value || 0),
            total_duration_seconds: 0,
            completed_count: Number(point.value || 0) > 0 ? 1 : 0,
          }));
        });

        setSummaryMetrics(fallbackSummaryMap);
        setAnalyticsData(fallbackDailyByHabit);
      } finally {
        setLoading(false);
      }
    };

    fetchCanonicalAnalytics();
  }, [
    selectedHabits.join(','),
    availableHabits.length,
    dateRange?.from?.toISOString(),
    dateRange?.to?.toISOString(),
    isUserLoaded,
    user?.id,
    getToken,
  ]);

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
          `/api/analytics/habits/daily-values?output=daily&habit_id=${expandedHabit}&start_date=${startDate}&end_date=${endDate}`
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
          `/api/analytics/habits/daily-values?output=daily&habit_id=${compareHabitId}&start_date=${startDate}&end_date=${endDate}`
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

    const chartData = logs
      .map((log: any) => {
        const date = log.date ? parseISO(log.date) : new Date();
        return {
          date: format(date, 'MMM dd'),
          shortDate: format(date, 'M/d'),
          value: Number(log.daily_value ?? log.value ?? log.total_amount ?? 0),
          rawDate: date,
        };
      })
      .sort((a: any, b: any) => a.rawDate.getTime() - b.rawDate.getTime());

    const enrichedChartData = chartData.map((point: any, index: number, arr: any[]) => {
      const prevValue = index > 0 ? arr[index - 1].value : point.value;
      return {
        ...point,
        upValue: point.value >= prevValue ? point.value : null,
        downValue: point.value < prevValue ? point.value : null,
      };
    });

    const summary = summaryMetrics[habitId] || {};

    const dailyValues = chartData.map((d: { value: number }) => Number(d.value || 0));
    const dataPointCount = dailyValues.length;
    const trendWindowSize = Math.min(14, Math.max(1, Math.floor(dataPointCount / 2)));
    const firstWindowValues = dailyValues.slice(0, trendWindowSize);
    const lastWindowValues = dailyValues.slice(-trendWindowSize);
    const firstWindowAvg = firstWindowValues.length > 0
      ? firstWindowValues.reduce((sum: number, value: number) => sum + value, 0) / firstWindowValues.length
      : 0;
    const lastWindowAvg = lastWindowValues.length > 0
      ? lastWindowValues.reduce((sum: number, value: number) => sum + value, 0) / lastWindowValues.length
      : 0;

    const localTotal = chartData.reduce((sum: number, d: { value: number }) => sum + d.value, 0);
    const localAverage = chartData.length > 0 ? localTotal / chartData.length : 0;

    const currentValue = Number(summary.current_value ?? localAverage ?? 0);
    const previousValue = Number(summary.previous_value ?? 0);
    const totalValue = Number(summary.total_value ?? localTotal);
    const daysWithData = Number(summary.days_with_data ?? chartData.length);

    let change = firstWindowAvg > 0
      ? ((lastWindowAvg - firstWindowAvg) / firstWindowAvg) * 100
      : (lastWindowAvg > 0 ? 100 : 0);
    let absoluteChange = lastWindowAvg - firstWindowAvg;

    if (!Number.isFinite(change)) change = 0;
    if (!Number.isFinite(absoluteChange)) absoluteChange = 0;

    return {
      habitName: habit.habit_name,
      currentValue,
      unit: summary.unit || habit.unit_type || (habit as any).unit || 'count',
      change,
      absoluteChange,
      chartData: enrichedChartData,
      isPositive: change >= 0,
      total: totalValue,
      average: currentValue,
      daysWithData,
      trendCurrentValue: lastWindowAvg || currentValue,
      trendPreviousValue: firstWindowAvg || previousValue,
    };
  };

  // Get expanded data
  const getExpandedData = (habitId: string) => {
    const habit = availableHabits.find((h: HabitData) => h.habit_id === habitId);
    if (!habit) return null;

    const processLogsToMap = (logsSource: any[], unitType: any) => {
      if (!logsSource || !logsSource.length) return { byDate: {}, logs: {} };

      const uniqueLogs = logsSource.reduce((acc: any[], log: any) => {
        const key = log.id || `${log.habit_id || ''}:${log.date || ''}`;
        const existingIndex = acc.findIndex((l: any) => (l.id || `${l.habit_id || ''}:${l.date || ''}`) === key);
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
          if (log.daily_value !== undefined && log.daily_value !== null) {
            total += Number(log.daily_value || 0);
            return;
          }

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

    const enrichedChartData = chartData.map((point: any, index: number, arr: any[]) => {
      const prevValue = index > 0 ? arr[index - 1].value : point.value;
      return {
        ...point,
        upValue: point.value >= prevValue ? point.value : null,
        downValue: point.value < prevValue ? point.value : null,
      };
    });

    return {
      habit,
      compHabit,
      chartData: enrichedChartData,
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
                    ? 'All'
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
                  last_7_days_avg: cardData.trendCurrentValue || cardData.currentValue || 0,
                  prev_7_days_avg: cardData.trendPreviousValue || 0,
                  weekly_amount_change_pct: cardData.change || 0,
                  chartData: (cardData.chartData || []).map((d: ChartDataPoint) => ({ value: d.value || 0 })),
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
            <div className="mt-4">
              {loadingExpandedLogs ? (
                <div className="flex h-[400px] items-center justify-center">
                  <div className="text-center">
                    <BrailleSpinner className="mx-auto mb-2 text-2xl text-gray-600" />
                    <p className="text-sm text-gray-500">Loading metrics...</p>
                  </div>
                </div>
              ) : (() => {
                const expandedData = getExpandedData(expandedHabit);
                if (!expandedData) return null;

                const { habit, compHabit, chartData, totalValue, avgValue, minValue, maxValue, stdDev } = expandedData;
                const expandedCardData = getHabitCardData(expandedHabit);
                const ranges: RangeOption[] = [
                  { value: '1D', label: '1D' },
                  { value: '5D', label: '5D' },
                  { value: '1W', label: '1W' },
                  { value: '1M', label: '1M' },
                  { value: '6M', label: '6M' },
                  { value: 'YTD', label: 'YTD' },
                  { value: '1Y', label: '1Y' },
                  { value: '5Y', label: '5Y' },
                  { value: 'MAX', label: 'MAX' },
                ];
                const points = habitToFinanceSeries(chartData);
                const firstPoint = points[0];
                const lastPoint = points[points.length - 1];
                const dateRangeText = hasCustomDateRange
                  ? `${format(dateRange!.from!, 'MMM d, yyyy')} – ${format(dateRange!.to!, 'MMM d, yyyy')}`
                  : (firstPoint && lastPoint
                    ? `${format(new Date(firstPoint.t), 'MMM d, yyyy')} – ${format(new Date(lastPoint.t), 'MMM d, yyyy')}`
                    : 'No data');
                const deltaDirection = expandedCardData?.change === undefined
                  ? 'neutral'
                  : expandedCardData.change >= 0
                    ? 'up'
                    : 'down';
                const deltaValueText = expandedCardData?.absoluteChange === undefined
                  ? undefined
                  : `${expandedCardData.absoluteChange >= 0 ? '+' : ''}${expandedCardData.absoluteChange.toFixed(2)}`;
                const deltaPercentText = expandedCardData?.change === undefined
                  ? undefined
                  : `${expandedCardData.change >= 0 ? '+' : ''}${expandedCardData.change.toFixed(2)}%`;
                const primaryValue = lastPoint
                  ? Number(lastPoint.close).toFixed(Number(lastPoint.close) < 10 ? 2 : 0)
                  : '--';

                const compareOptions = availableHabits
                  .filter((h: any) => h.habit_id !== expandedHabit)
                  .map((h: any) => ({ label: h.habit_name, value: h.habit_id }));

                const stats: Array<{ label: string; value: string }> = [
                  { label: 'Total', value: totalValue.toFixed(1) },
                  { label: 'Average', value: avgValue.toFixed(1) },
                  { label: 'Min', value: minValue.toFixed(1) },
                  { label: 'Max', value: maxValue.toFixed(1) },
                  { label: 'Std Dev', value: stdDev.toFixed(1) },
                ];

                if (compHabit) {
                  stats.push({
                    label: 'Correlation',
                    value: loadingCorrelation ? '...' : (correlationData?.correlation?.coefficient?.toFixed(2) ?? 'N/A'),
                  });
                }

                return (
                  <ExpandedMetricCard
                    title={habit.habit_name}
                    primaryValue={primaryValue}
                    unit={habit.unit_type || (habit as any).unit || ''}
                    deltaValue={deltaValueText}
                    deltaPercent={deltaPercentText}
                    deltaDirection={deltaDirection}
                    dateRangeText={dateRangeText}
                    rangePreset={expandedTimeRange}
                    onRangePresetChange={(value) => setExpandedTimeRange(value as RangeKey)}
                    rangeOptions={ranges}
                    rangeLockedText={hasCustomDateRange ? 'Custom range' : undefined}
                    compareControl={(
                      <CompareSelect
                        value={compareHabitId}
                        options={compareOptions}
                        onChange={(val) => setCompareHabitId(val)}
                        placeholder="Compare"
                      />
                    )}
                    actions={(
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          aria-label={showChartGrid ? 'Hide chart grid' : 'Show chart grid'}
                          title={showChartGrid ? 'Hide grid' : 'Show grid'}
                          aria-pressed={showChartGrid}
                          onClick={() => setShowChartGrid((prev) => !prev)}
                          className={`inline-flex h-8 w-8 items-center justify-center rounded-none border border-gray-300 bg-white text-gray-600 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gray-400 focus-visible:ring-inset ${
                            showChartGrid
                              ? 'bg-[#F3F3F3] text-gray-900'
                              : 'hover:bg-[#F3F3F3] hover:text-gray-900 focus:bg-[#F3F3F3]'
                          }`}
                        >
                          <Grid3X3 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label={showBaseline ? 'Hide reference line' : 'Show reference line'}
                          title={showBaseline ? 'Hide reference line' : 'Show reference line'}
                          aria-pressed={showBaseline}
                          onClick={() => setShowBaseline((prev) => !prev)}
                          className={`inline-flex h-8 w-8 items-center justify-center rounded-none border border-gray-300 bg-white text-gray-600 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gray-400 focus-visible:ring-inset ${
                            showBaseline
                              ? 'bg-[#F3F3F3] text-gray-900'
                              : 'hover:bg-[#F3F3F3] hover:text-gray-900 focus:bg-[#F3F3F3]'
                          }`}
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                    onClose={() => setExpandedHabit(null)}
                    stats={stats}
                  >
                    <div ref={chartRef}>
                      <PerplexityExpandedHabitChart
                        points={points}
                        range={expandedTimeRange}
                        unit={habit.unit_type || (habit as any).unit || ''}
                        chartType={viewMode === "chart" ? "bar" : "spark"}
                        showGrid={showChartGrid}
                        showReferenceLine={showBaseline}
                      />
                    </div>
                  </ExpandedMetricCard>
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

      {/* Screen recordings now explored via AI Search in Computer Activity panel */}
    </>
  );
}
