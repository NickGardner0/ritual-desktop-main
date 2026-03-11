/**
 * MetricsView - Analytics/Metrics content for unified Analytics page
 * 
 * Metrics content used by the unified analytics page.
 * Designed to work with shared filter context or standalone.
 */

'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useAuth, useUser } from '@clerk/nextjs';
import {
  Copy,
  Camera,
  ChevronDown,
  Download,
  X,
} from 'lucide-react';
import type { DateRange } from 'react-day-picker';
import { format, parseISO, startOfDay, differenceInDays, subDays, eachDayOfInterval } from 'date-fns';
import { AnalyticsViewToggle } from '@/components/analytics/analytics-view-toggle';
import { analyticsApi } from '@/lib/services/analytics-api';
import { useAnalyticsFiltersOptional } from './analytics-filter-context';
import { useHabits } from '@/contexts/HabitsContext';
import type { RangeKey } from '@/components/charts/PerplexityExpandedHabitChart';
import { habitToFinanceSeries } from '@/lib/charts/habitToFinanceSeries';
import { BrailleSpinner } from '@/components/ui/braille-spinner';
import { ExpandedMetricCard } from '@/components/metrics/ExpandedMetricCard';
import type { RangeOption } from '@/components/metrics/RangeSegmentedControl';
import { isTauri } from '@/lib/tauri-utils';
import {
  COMPUTER_HABIT_DISPLAY_NAME,
  getHabitDisplayName,
  isComputerHabitName,
} from '@/lib/computer-time-habit';
import * as DialogPrimitive from '@radix-ui/react-dialog';
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

type ComputerDailyRow = {
  day: string;
  active_hours: number;
  active_ms?: number;
  events_count?: number;
  apps_count?: number;
};

const COMPUTER_ACTIVITY_CARD_ID = '__computer_activity__';

function sanitizeDailyActiveHours(rawHours: number, rawActiveMs?: number): number {
  const msDerivedHours = Number(rawActiveMs || 0) / (1000 * 60 * 60);
  let hours = Number(rawHours || 0);

  if (!Number.isFinite(hours) || hours < 0) {
    hours = 0;
  }

  if (hours > 24 && Number.isFinite(msDerivedHours) && msDerivedHours > 0 && msDerivedHours <= 24) {
    hours = msDerivedHours;
  }

  return Math.min(Math.max(hours, 0), 24);
}

interface MetricsViewProps {
  externalDateRange?: DateRange | undefined;
  onDateRangeChange?: (range: DateRange | undefined) => void;
  hideControls?: boolean;
  externalChartViewMode?: 'chart' | 'ticker';
  onChartViewModeChange?: (mode: 'chart' | 'ticker') => void;
  summaryPanelOpen?: boolean;
  onSummaryPanelChange?: (open: boolean | ((prev: boolean) => boolean)) => void;
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
  placeholder = 'None',
}: CompareSelectProps) => (
  <Select
    value={value ?? COMPARE_NONE_VALUE}
    onValueChange={(nextValue) =>
      onChange(nextValue === COMPARE_NONE_VALUE ? null : nextValue)
    }
  >
    <SelectTrigger className="h-[30px] min-w-[80px] border-[rgba(39,37,30,0.07)] bg-white px-2 text-[12px] font-medium tracking-[-0.4px] text-[rgba(39,37,30,0.65)] transition-colors hover:bg-[rgba(39,37,30,0.02)] hover:text-[#27251E] focus:outline-none focus:ring-0">
      <SelectValue placeholder={placeholder} />
    </SelectTrigger>
    <SelectContent align="end" className="border-[rgba(39,37,30,0.07)] bg-white shadow-[0_12px_24px_rgba(39,37,30,0.12)]">
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
  onChartViewModeChange,
  summaryPanelOpen: externalSummaryPanelOpen,
  onSummaryPanelChange,
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
  const [localSummaryPanelOpen, setLocalSummaryPanelOpen] = useState(false);
  const summaryPanelOpen = externalSummaryPanelOpen ?? localSummaryPanelOpen;
  const setSummaryPanelOpen = onSummaryPanelChange ?? setLocalSummaryPanelOpen;
  const [expandedLogs, setExpandedLogs] = useState<any[]>([]);
  const [loadingExpandedLogs, setLoadingExpandedLogs] = useState(false);

  const [summaryMetrics, setSummaryMetrics] = useState<Record<string, any>>({});

  const [expandedTimeRange, setExpandedTimeRange] = useState<RangeKey>('1M');
  const [compareHabitId, setCompareHabitId] = useState<string | null>(null);
  const [comparisonLogs, setComparisonLogs] = useState<any[]>([]);
  const [loadingComparison, setLoadingComparison] = useState(false);
  const [localViewMode, setLocalViewMode] = useState<'chart' | 'ticker'>('chart');
  
  // Use external view mode if provided, otherwise use local state
  const viewMode = externalChartViewMode ?? localViewMode;
  const setViewMode = onChartViewModeChange ?? setLocalViewMode;
  const expandedChartType: 'bar' | 'spark' = viewMode === 'chart' ? 'bar' : 'spark';

  const [correlationData, setCorrelationData] = useState<any>(null);
  const [loadingCorrelation, setLoadingCorrelation] = useState(false);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [computerActivityDaily, setComputerActivityDaily] = useState<ComputerDailyRow[]>([]);
  const [showComputerActivity, setShowComputerActivity] = useState(true);

  const [isCapturing, setIsCapturing] = useState(false);
  const chartRef = useRef<HTMLDivElement>(null);
  const exportCardRef = useRef<HTMLDivElement>(null);
  const shareObjectUrlRef = useRef<string | null>(null);
  const backfillAttempted = useRef(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareImageUrl, setShareImageUrl] = useState<string | null>(null);
  const [shareImageBlob, setShareImageBlob] = useState<Blob | null>(null);
  const [shareLabel, setShareLabel] = useState<string>('chart');
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [downloadState, setDownloadState] = useState<'idle' | 'done' | 'failed'>('idle');

  // Use transformed habits from shared context
  const availableHabits = transformedHabits;
  const detectedComputerHabitId = React.useMemo(
    () => availableHabits.find((habit) => isComputerHabitName(habit.habit_name))?.habit_id || null,
    [availableHabits],
  );
  const filteredHabits = React.useMemo(
    () => availableHabits.filter((habit) => !isComputerHabitName(habit.habit_name)),
    [availableHabits],
  );

  const captureExpandedChart = useCallback(async (label: string) => {
    const captureTarget = exportCardRef.current || chartRef.current;
    if (!captureTarget || isCapturing) return;

    setShareLabel(label);
    setShowShareModal(true);
    setShareImageUrl(null);
    setShareImageBlob(null);
    setCopyState('idle');
    setDownloadState('idle');
    setIsCapturing(true);
    try {
      const html2canvas = (await import('html2canvas')).default;
      const scale = Math.max(2, Math.min(4, (window.devicePixelRatio || 1) * 2));
      const canvas = await html2canvas(captureTarget, {
        backgroundColor: '#FFFFFF',
        scale,
        useCORS: true,
        logging: false,
        removeContainer: true,
        onclone: (clonedDoc) => {
          clonedDoc.querySelectorAll<HTMLElement>('[data-export-title]').forEach((el) => {
            el.style.overflow = 'visible';
            el.style.textOverflow = 'clip';
            el.style.whiteSpace = 'normal';
          });
          clonedDoc.querySelectorAll<HTMLElement>('[data-export-close]').forEach((el) => {
            el.style.display = 'none';
          });
        },
      });

      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((result) => resolve(result), 'image/png', 1);
      });
      if (!blob) {
        throw new Error('Failed to render image blob');
      }

      const objectUrl = URL.createObjectURL(blob);
      if (shareObjectUrlRef.current) {
        URL.revokeObjectURL(shareObjectUrlRef.current);
      }
      shareObjectUrlRef.current = objectUrl;
      setShareImageUrl(objectUrl);
      setShareImageBlob(blob);
    } catch (error) {
      console.error('Failed to export chart image:', error);
    } finally {
      setIsCapturing(false);
    }
  }, [isCapturing]);

  const closeShareModal = useCallback(() => {
    setShowShareModal(false);
    setCopyState('idle');
    setDownloadState('idle');
    setShareImageBlob(null);
    setShareImageUrl(null);
    if (shareObjectUrlRef.current) {
      URL.revokeObjectURL(shareObjectUrlRef.current);
      shareObjectUrlRef.current = null;
    }
  }, []);

  const getShareFileName = useCallback(() => {
    const fileBase = shareLabel
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'habit-chart';
    return `${fileBase}-${format(new Date(), 'yyyyMMdd')}.png`;
  }, [shareLabel]);

  const getShareBlob = useCallback(async (): Promise<Blob | null> => {
    if (shareImageBlob) return shareImageBlob;
    if (!shareImageUrl) return null;
    const response = await fetch(shareImageUrl);
    if (!response.ok) return null;
    return response.blob();
  }, [shareImageBlob, shareImageUrl]);

  const downloadShareImage = useCallback(async () => {
    try {
      const blob = await getShareBlob();
      if (!blob) {
        setDownloadState('failed');
        return;
      }

      const fileName = getShareFileName();

      if (isTauri()) {
        const [{ save }, { writeBinaryFile }] = await Promise.all([
          import('@tauri-apps/api/dialog'),
          import('@tauri-apps/api/fs'),
        ]);
        const destination = await save({
          defaultPath: fileName,
          filters: [{ name: 'PNG Image', extensions: ['png'] }],
        });
        if (!destination) return;

        const bytes = new Uint8Array(await blob.arrayBuffer());
        await writeBinaryFile({
          path: destination,
          contents: bytes,
        });
      } else {
        const downloadUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.download = fileName;
        link.href = downloadUrl;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 250);
      }

      setDownloadState('done');
    } catch (error) {
      console.error('Failed to download chart image:', error);
      setDownloadState('failed');
    }
  }, [getShareBlob, getShareFileName]);

  const copyShareImage = useCallback(async () => {
    try {
      const blob = await getShareBlob();
      if (!blob) {
        setCopyState('failed');
        return;
      }

      if (typeof navigator !== 'undefined'
        && navigator.clipboard?.write
        && typeof ClipboardItem !== 'undefined') {
        const item = new ClipboardItem({
          [blob.type || 'image/png']: blob,
        });
        await navigator.clipboard.write([item]);
        setCopyState('copied');
        return;
      }

      if (isTauri()) {
        const { invoke } = await import('@tauri-apps/api/tauri');
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = '';
        const chunkSize = 0x8000;
        for (let index = 0; index < bytes.length; index += chunkSize) {
          binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
        }
        const png_base64 = btoa(binary);
        await invoke('copy_png_to_clipboard', { png_base64 });
        setCopyState('copied');
        return;
      }

      setCopyState('failed');
    } catch (error) {
      console.error('Failed to copy chart image:', error);
      setCopyState('failed');
    }
  }, [getShareBlob]);

  useEffect(() => {
    if (copyState === 'idle') return;
    const timer = window.setTimeout(() => setCopyState('idle'), 1600);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  useEffect(() => {
    if (downloadState === 'idle') return;
    const timer = window.setTimeout(() => setDownloadState('idle'), 1600);
    return () => window.clearTimeout(timer);
  }, [downloadState]);

  useEffect(() => {
    return () => {
      if (shareObjectUrlRef.current) {
        URL.revokeObjectURL(shareObjectUrlRef.current);
        shareObjectUrlRef.current = null;
      }
    };
  }, []);

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
    const filteredHabitIds = filteredHabits.map((h: HabitData) => h.habit_id).filter((id: string) => !!id);
    const habitsToFetch = validSelected.length > 0
      ? validSelected.filter((id: string) => filteredHabitIds.includes(id))
      : filteredHabitIds;

    if (habitsToFetch.length === 0) {
      setAnalyticsData({});
      setSummaryMetrics({});
      setLoading(false);
      return;
    }

    const fetchCanonicalAnalytics = async () => {
      const hasExistingData = Object.keys(analyticsData).length > 0;
      if (!hasExistingData) {
        setLoading(true);
      }
      setAnalyticsError(null);

      const params = new URLSearchParams();
      const rangeSpanDays = dateRange?.from && dateRange?.to
        ? differenceInDays(dateRange.to, dateRange.from) + 1
        : 0;
      const useWideRange = !dateRange?.from || !dateRange?.to || rangeSpanDays < 7;

      if (!useWideRange) {
        params.set('start_date', format(dateRange!.from!, 'yyyy-MM-dd'));
        params.set('end_date', format(dateRange!.to!, 'yyyy-MM-dd'));
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

        const totalDailyRows = Object.values(dataByHabit).reduce((sum, rows) => sum + rows.length, 0);
        const habitsWithData = Object.values(dataByHabit).filter(rows => rows.length > 0).length;
        const coverageRatio = habitsToFetch.length > 0 ? habitsWithData / habitsToFetch.length : 0;

        if (totalDailyRows === 0) {
          throw new Error('Tinybird returned no daily data, falling back to Python backend');
        }

        if (habitsToFetch.length > 1 && coverageRatio < 0.5) {
          console.warn(`⚠️ Tinybird only has data for ${habitsWithData}/${habitsToFetch.length} habits (${(coverageRatio * 100).toFixed(0)}%), falling back to Python`);
          throw new Error('Tinybird data too sparse, falling back to Python backend');
        }

        setAnalyticsData(dataByHabit);
        setSummaryMetrics(summaryMap);
      } catch (error) {
        console.error('❌ Tinybird canonical analytics failed, falling back to Python:', error);
        try {
          const token = await getToken();
          if (!token) {
            throw new Error('Authentication required to load analytics metrics.');
          }

          const now = new Date();
          const to = useWideRange ? now : (dateRange?.to || now);
          const from = useWideRange ? subDays(now, 1095) : (dateRange?.from || subDays(now, 1095));
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
            const rows = response?.data || response?.daily_data || [];
            fallbackDailyByHabit[habitId] = rows.map((point: any) => ({
              habit_id: habitId,
              date: point.date,
              daily_value: Number(point.value ?? point.total_amount ?? 0),
              unit: point.unit,
              total_amount: Number(point.total_amount ?? point.value ?? 0),
              total_duration_seconds: Number(point.total_duration_seconds ?? 0),
              completed_count: Number(point.value || point.total_amount || 0) > 0 ? 1 : 0,
            }));
          });

          setSummaryMetrics(fallbackSummaryMap);
          setAnalyticsData(fallbackDailyByHabit);

          if (!backfillAttempted.current) {
            backfillAttempted.current = true;
            fetch(`${process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000'}/api/analytics/tinybird-backfill`, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            }).then(r => r.json())
              .then(res => console.log('📊 Tinybird backfill result:', res))
              .catch(err => console.warn('⚠️ Tinybird backfill failed (non-critical):', err));
          }
        } catch (fallbackError) {
          console.error('❌ Python analytics fallback failed:', fallbackError);
          setAnalyticsData({});
          setSummaryMetrics({});
          setAnalyticsError(
            fallbackError instanceof Error
              ? fallbackError.message
              : 'Unable to load analytics metrics at the moment.',
          );
        }
      } finally {
        setLoading(false);
      }
    };

    fetchCanonicalAnalytics();
  }, [
    selectedHabits.join(','),
    filteredHabits.length,
    dateRange?.from?.toISOString(),
    dateRange?.to?.toISOString(),
    isUserLoaded,
    user?.id,
    getToken,
  ]);

  useEffect(() => {
    if (!isUserLoaded || !user?.id) return;

    const now = new Date();
    const hasExplicitRange = !!(dateRange?.from && dateRange?.to);
    const startDate = format(hasExplicitRange ? dateRange!.from! : subDays(now, 1095), 'yyyy-MM-dd');
    const endDate = format(hasExplicitRange ? dateRange!.to! : now, 'yyyy-MM-dd');
    const query = `start_date=${startDate}&end_date=${endDate}`;
    const controller = new AbortController();

    const fetchComputerActivity = async () => {
      try {
        const dailyRes = await fetch(`/api/watcher/stats/daily?${query}`, { signal: controller.signal });

        if (!dailyRes.ok) {
          throw new Error('Failed to load computer activity');
        }

        const dailyPayload = await dailyRes.json();

        if (controller.signal.aborted) return;

        const dailyRows = (dailyPayload?.data || [])
          .map((row: any) => {
            const activeMs = Number(row.active_ms || 0);
            const activeHours = sanitizeDailyActiveHours(Number(row.active_hours || 0), activeMs);
            return {
              day: String(row.day || ''),
              active_hours: activeHours,
              active_ms: activeMs > 0 ? activeMs : Math.round(activeHours * 60 * 60 * 1000),
              events_count: Number(row.events_count || 0),
              apps_count: Number(row.apps_count || 0),
            };
          })
          .filter((row: ComputerDailyRow) => row.day && row.active_hours >= 0)
          .sort((a: ComputerDailyRow, b: ComputerDailyRow) => a.day.localeCompare(b.day));

        setComputerActivityDaily(dailyRows);
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error('❌ Failed loading computer activity metrics:', error);
        setComputerActivityDaily([]);
      }
    };

    fetchComputerActivity();

    return () => controller.abort();
  }, [dateRange?.from?.toISOString(), dateRange?.to?.toISOString(), isUserLoaded, user?.id]);

  // Fetch correlation data
  useEffect(() => {
    if (!expandedHabit || !compareHabitId || expandedHabit === COMPUTER_ACTIVITY_CARD_ID) {
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

    if (expandedHabit === COMPUTER_ACTIVITY_CARD_ID) {
      setExpandedLogs([]);
      setCompareHabitId(null);
      setComparisonLogs([]);
      setLoadingExpandedLogs(false);
      return;
    }

    const expandedHabitData = availableHabits.find((h: HabitData) => h.habit_id === expandedHabit);
    const metricType = String((expandedHabitData as any)?.metric_type || '').toLowerCase();
    const habitName = String(expandedHabitData?.habit_name || '').toLowerCase();
    const shouldAttachSleepMetadata = metricType.includes('sleep') || habitName.includes('sleep');

    const enrichRowsWithSleepMetadata = async (
      rows: any[],
      habitId: string,
      startDate: string,
      endDate: string,
    ) => {
      if (!shouldAttachSleepMetadata || rows.length === 0) {
        return rows;
      }

      try {
        const params = new URLSearchParams({
          habits: habitId,
          statuses: 'completed',
          start_date: startDate,
          end_date: endDate,
          sort: 'date',
          order: 'asc',
          limit: '1000',
        });
        const response = await fetch(`/api/analytics/habits/logs/all?${params.toString()}`);
        if (!response.ok) {
          return rows;
        }

        const payload = await response.json();
        const logs = Array.isArray(payload?.data) ? payload.data : [];
        if (logs.length === 0) {
          return rows;
        }

        const metadataByDate = new Map<string, { metadata: Record<string, unknown>; completed_at?: string; score: number }>();

        logs.forEach((log: any) => {
          let parsedMeta: Record<string, unknown> = {};
          if (log?.metadata) {
            if (typeof log.metadata === 'string') {
              try {
                parsedMeta = JSON.parse(log.metadata);
              } catch {
                parsedMeta = {};
              }
            } else if (typeof log.metadata === 'object') {
              parsedMeta = { ...log.metadata };
            }
          }

          const sleepOnset = (
            parsedMeta.sleep_onset
            ?? parsedMeta.sleepOnset
            ?? log?.sleep_onset
            ?? log?.sleepOnset
            ?? null
          ) as string | null;
          const sleepEnd = (
            parsedMeta.sleep_end
            ?? parsedMeta.sleepEnd
            ?? log?.sleep_end
            ?? log?.sleepEnd
            ?? null
          ) as string | null;
          const completedAt = (log?.completed_at ?? log?.timestamp ?? null) as string | null;
          const dateKey = log?.date as string | undefined;

          if (!dateKey || (!sleepOnset && !sleepEnd && !completedAt)) {
            return;
          }

          const normalizedMeta: Record<string, unknown> = { ...parsedMeta };
          if (sleepOnset) normalizedMeta.sleep_onset = sleepOnset;
          if (sleepEnd) normalizedMeta.sleep_end = sleepEnd;

          const score = Number(Boolean(sleepOnset)) + Number(Boolean(sleepEnd));
          const existing = metadataByDate.get(dateKey);
          if (!existing) {
            metadataByDate.set(dateKey, {
              metadata: normalizedMeta,
              completed_at: completedAt || undefined,
              score,
            });
            return;
          }

          const existingTs = existing.completed_at ? new Date(existing.completed_at).getTime() : 0;
          const candidateTs = completedAt ? new Date(completedAt).getTime() : 0;
          const shouldReplace = score > existing.score || (score === existing.score && candidateTs > existingTs);
          if (shouldReplace) {
            metadataByDate.set(dateKey, {
              metadata: normalizedMeta,
              completed_at: completedAt || undefined,
              score,
            });
          }
        });

        if (metadataByDate.size === 0) {
          return rows;
        }

        return rows.map((row: any) => {
          const match = metadataByDate.get(row.date);
          if (!match) return row;

          let existingMeta: Record<string, unknown> = {};
          if (row.metadata) {
            if (typeof row.metadata === 'string') {
              try {
                existingMeta = JSON.parse(row.metadata);
              } catch {
                existingMeta = {};
              }
            } else if (typeof row.metadata === 'object') {
              existingMeta = { ...row.metadata };
            }
          }

          return {
            ...row,
            metadata: { ...existingMeta, ...match.metadata },
            completed_at: row.completed_at || match.completed_at,
          };
        });
      } catch {
        return rows;
      }
    };

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
        if (result.success && result.data?.length > 0) {
          const enrichedRows = await enrichRowsWithSleepMetadata(
            result.data,
            expandedHabit,
            startDate,
            endDate,
          );
          setExpandedLogs(enrichedRows);
        } else {
          const token = await getToken();
          if (token) {
            const daysBack = Math.max(1, differenceInDays(to, from) + 1);
            const fallback = await analyticsApi.getDailyBreakdown(token, {
              habitId: expandedHabit,
              daysBack,
            }).catch(() => null);
            const rows = (fallback?.data || fallback?.daily_data || []).map((point: any) => ({
              habit_id: expandedHabit,
              date: point.date,
              daily_value: Number(point.value ?? point.total_amount ?? 0),
              unit: point.unit,
              total_amount: Number(point.total_amount ?? point.value ?? 0),
              total_duration_seconds: Number(point.total_duration_seconds ?? 0),
            }));
            const enrichedRows = await enrichRowsWithSleepMetadata(
              rows,
              expandedHabit,
              startDate,
              endDate,
            );
            setExpandedLogs(enrichedRows);
          } else {
            setExpandedLogs([]);
          }
        }
      } catch (error) {
        console.error('❌ Error fetching expanded logs:', error);
        setExpandedLogs([]);
      } finally {
        setLoadingExpandedLogs(false);
      }
    };

    fetchExpandedLogs();
  }, [expandedHabit, expandedTimeRange, hasCustomDateRange, dateRange?.from?.toISOString(), dateRange?.to?.toISOString(), availableHabits, getToken]);

  // Fetch comparison logs
  useEffect(() => {
    if (!expandedHabit || !compareHabitId || expandedHabit === COMPUTER_ACTIVITY_CARD_ID) {
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
        if (result.success && result.data?.length > 0) {
          setComparisonLogs(result.data);
        } else {
          const token = await getToken();
          if (token) {
            const daysBack = Math.max(1, differenceInDays(to, from) + 1);
            const fallback = await analyticsApi.getDailyBreakdown(token, {
              habitId: compareHabitId,
              daysBack,
            }).catch(() => null);
            const rows = (fallback?.data || fallback?.daily_data || []).map((point: any) => ({
              habit_id: compareHabitId,
              date: point.date,
              daily_value: Number(point.value ?? point.total_amount ?? 0),
              unit: point.unit,
              total_amount: Number(point.total_amount ?? point.value ?? 0),
              total_duration_seconds: Number(point.total_duration_seconds ?? 0),
            }));
            setComparisonLogs(rows);
          } else {
            setComparisonLogs([]);
          }
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

  useEffect(() => {
    if (expandedHabit !== COMPUTER_ACTIVITY_CARD_ID) return;
    if (detectedComputerHabitId && !selectedHabits.includes(detectedComputerHabitId)) {
      setExpandedHabit(null);
      return;
    }
    if (!computerActivityDaily.length) {
      setExpandedHabit(null);
    }
  }, [computerActivityDaily.length, detectedComputerHabitId, expandedHabit, selectedHabits]);

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

    const localTotal = chartData.reduce((sum: number, d: { value: number }) => sum + d.value, 0);
    const localAverage = chartData.length > 0 ? localTotal / chartData.length : 0;
    const totalValue = Number(summary.total_value ?? localTotal);
    const daysWithData = Number(summary.days_with_data ?? chartData.length);

    // Day-over-day: compare the most recent logged day vs the previous logged day
    const nonZeroDays = chartData.filter((d: { value: number }) => d.value > 0);
    const latestDay = nonZeroDays.length > 0 ? nonZeroDays[nonZeroDays.length - 1] : null;
    const previousDay = nonZeroDays.length > 1 ? nonZeroDays[nonZeroDays.length - 2] : null;

    const latestValue = latestDay ? Number(latestDay.value) : 0;
    const previousValue = previousDay ? Number(previousDay.value) : 0;
    const currentValue = latestValue || Number(summary.current_value ?? localAverage ?? 0);

    let change = previousValue > 0
      ? ((latestValue - previousValue) / previousValue) * 100
      : (latestValue > 0 ? 100 : 0);
    let absoluteChange = latestValue - previousValue;

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
      average: localAverage,
      daysWithData,
      trendCurrentValue: latestValue || currentValue,
      trendPreviousValue: previousValue,
    };
  };

  const getComputerActivityCardData = React.useCallback(() => {
    if (!computerActivityDaily.length) return null;

    const chartData = computerActivityDaily.map((row) => {
      const date = parseISO(row.day);
      return {
        date: format(date, 'MMM dd'),
        shortDate: format(date, 'M/d'),
        value: Number(row.active_hours || 0),
        rawDate: date,
      };
    });

    const values = chartData.map((d) => Number(d.value || 0));
    const total = values.reduce((sum, value) => sum + value, 0);
    const average = values.length > 0 ? total / values.length : 0;

    const nonZeroDays = chartData.filter((d) => d.value > 0);
    const latestDay = nonZeroDays.length > 0 ? nonZeroDays[nonZeroDays.length - 1] : null;
    const previousDay = nonZeroDays.length > 1 ? nonZeroDays[nonZeroDays.length - 2] : null;
    const latestValue = latestDay ? Number(latestDay.value) : 0;
    const previousValue = previousDay ? Number(previousDay.value) : 0;

    const change = previousValue > 0 ? ((latestValue - previousValue) / previousValue) * 100 : (latestValue > 0 ? 100 : 0);
    const absoluteChange = latestValue - previousValue;

    return {
      habitName: COMPUTER_HABIT_DISPLAY_NAME,
      currentValue: latestValue || average,
      unit: 'hours',
      change: Number.isFinite(change) ? change : 0,
      absoluteChange: Number.isFinite(absoluteChange) ? absoluteChange : 0,
      chartData,
      isPositive: (Number.isFinite(change) ? change : 0) >= 0,
      total,
      average,
      min: values.length > 0 ? Math.min(...values) : 0,
      max: values.length > 0 ? Math.max(...values) : 0,
      events: computerActivityDaily.reduce((sum, row) => sum + Number(row.events_count || 0), 0),
      activeDays: values.filter((value) => value > 0).length,
      trendCurrentValue: latestValue || average,
      trendPreviousValue: previousValue,
    };
  }, [computerActivityDaily]);

  const getComputerActivityRowsForExpandedRange = React.useCallback(() => {
    if (!computerActivityDaily.length) return [];

    const rangeDates = hasCustomDateRange
      ? { from: dateRange!.from!, to: dateRange!.to! }
      : getRangeDates(expandedTimeRange);
    const fromDayStart = startOfDay(rangeDates.from).getTime();
    const toDayStart = startOfDay(rangeDates.to).getTime();

    return computerActivityDaily
      .filter((row) => {
        const rowDayMs = parseISO(row.day).getTime();
        return Number.isFinite(rowDayMs) && rowDayMs >= fromDayStart && rowDayMs <= toDayStart;
      })
      .sort((a, b) => a.day.localeCompare(b.day));
  }, [
    computerActivityDaily,
    hasCustomDateRange,
    dateRange?.from?.toISOString(),
    dateRange?.to?.toISOString(),
    expandedTimeRange,
  ]);

  const getComputerActivityExpandedData = React.useCallback((rows: ComputerDailyRow[]) => {
    if (!rows.length) return null;

    const chartData = rows.map((row) => {
      const date = parseISO(row.day);
      return {
        date: format(date, 'MMM d, yyyy'),
        shortDate: format(date, 'MMM d'),
        value: Number(row.active_hours || 0),
        unit: 'hours',
        entries: Number(row.events_count || 0),
      };
    });

    const values = chartData.map((d) => Number(d.value || 0));
    const total = values.reduce((sum, value) => sum + value, 0);
    const average = values.length > 0 ? total / values.length : 0;
    const min = values.length > 0 ? Math.min(...values) : 0;
    const max = values.length > 0 ? Math.max(...values) : 0;
    const variance = values.length
      ? values.reduce((sum, value) => sum + Math.pow(value - average, 2), 0) / values.length
      : 0;
    const nonZeroValues = values.filter((v) => v > 0);
    const latestVal = nonZeroValues.length > 0 ? nonZeroValues[nonZeroValues.length - 1] : 0;
    const prevVal = nonZeroValues.length > 1 ? nonZeroValues[nonZeroValues.length - 2] : 0;
    const change = prevVal > 0 ? ((latestVal - prevVal) / prevVal) * 100 : (latestVal > 0 ? 100 : 0);
    const absoluteChange = latestVal - prevVal;

    return {
      chartData,
      total,
      average,
      min,
      max,
      stdDev: Math.sqrt(variance),
      events: rows.reduce((sum, row) => sum + Number(row.events_count || 0), 0),
      activeDays: values.filter((value) => value > 0).length,
      change: Number.isFinite(change) ? change : 0,
      absoluteChange: Number.isFinite(absoluteChange) ? absoluteChange : 0,
    };
  }, []);

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

    const rangeDates = hasCustomDateRange
      ? { from: dateRange!.from!, to: dateRange!.to! }
      : getRangeDates(expandedTimeRange);
    const allDatesInRange = eachDayOfInterval({ start: startOfDay(rangeDates.from), end: startOfDay(rangeDates.to) })
      .map(d => format(d, 'yyyy-MM-dd'));
    const dataDateSet = new Set([...Object.keys(mainData.byDate), ...Object.keys(compData.byDate)]);
    const allDates = Array.from(new Set([...allDatesInRange, ...dataDateSet])).sort();

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
          const sleepOnset = meta.sleep_onset || meta.sleepOnset || null;
          const sleepEnd = meta.sleep_end || meta.sleepEnd || null;
          if (sleepOnset) metadata = { ...metadata, sleepOnset };
          if (sleepEnd) metadata = { ...metadata, sleepEnd };
        } catch (e) { }
      }

      if (logToUse) {
        const sleepOnset = logToUse.sleep_onset || logToUse.sleepOnset || null;
        const sleepEnd = logToUse.sleep_end || logToUse.sleepEnd || null;
        if (sleepOnset) metadata = { ...metadata, sleepOnset };
        if (sleepEnd) metadata = { ...metadata, sleepEnd };
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
        compValue: cVal !== undefined ? cVal : null,
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

  const computerActivityCard = getComputerActivityCardData();
  const hasRenderableMetricCards = filteredHabits.length > 0 || Boolean(computerActivityCard);
  const hasValidHabitData = (availableHabits.length > 0 && availableHabits[0]?.habit_id) || Boolean(computerActivityCard);

  const summaryRows = useMemo(() => {
    const validSelected = selectedHabits.filter((id: string): id is string => !!id);
    const filteredIds = filteredHabits.map((h: HabitData) => h.habit_id).filter((id: string): id is string => !!id);
    const ids = validSelected.length > 0
      ? validSelected.filter((id: string) => filteredIds.includes(id))
      : filteredIds;
    const isComputerSelected = detectedComputerHabitId ? validSelected.includes(detectedComputerHabitId) : true;
    const allIds = computerActivityCard && isComputerSelected ? [...ids, COMPUTER_ACTIVITY_CARD_ID] : ids;

    return allIds.map((habitId: string) => {
      const cardData = habitId === COMPUTER_ACTIVITY_CARD_ID
        ? computerActivityCard
        : getHabitCardData(habitId);
      if (!cardData) return null;

      const pct = Number(cardData.change ?? 0);
      const isUp = pct > 0;
      const isDown = pct < 0;
      const absPct = Math.abs(pct);
      const fmtPct = absPct >= 10 ? absPct.toFixed(1) : absPct.toFixed(2);

      const val = Number(cardData.currentValue ?? 0);
      const fmtVal = val >= 100 ? val.toFixed(0) : val >= 10 ? val.toFixed(1) : val.toFixed(2);

      return {
        id: habitId,
        name: cardData.habitName,
        value: fmtVal,
        unit: cardData.unit || '',
        pctText: `${fmtPct}%`,
        isUp,
        isDown,
      };
    }).filter(Boolean) as { id: string; name: string; value: string; unit: string; pctText: string; isUp: boolean; isDown: boolean }[];
  }, [selectedHabits, filteredHabits, detectedComputerHabitId, computerActivityCard]);

  if (!hasValidHabitData && (loading || queryLoading)) {
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
        <div className="mx-auto w-full max-w-[920px] flex flex-wrap items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <AnalyticsViewToggle
              currentView={viewMode}
              onViewChange={setViewMode}
              darkMode={false}
            />

            <button
              onClick={() => setSummaryPanelOpen(prev => !prev)}
              className={`flex items-center justify-center w-[34px] h-[34px] border text-sm transition-colors ${
                summaryPanelOpen
                  ? 'bg-gray-900 border-gray-900 text-white'
                  : 'bg-white border-gray-300 text-gray-500 hover:bg-[#F3F3F3]'
              }`}
              title="Habit summary"
            >
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M2 3.5h11M2 7.5h11M2 11.5h7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
            </button>

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
                          <span className="text-sm text-gray-900">
                            {getHabitDisplayName(habit.habit_name)}
                          </span>
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
      {analyticsError && (
        <div className="mb-4 border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Analytics metrics unavailable: {analyticsError}
        </div>
      )}

      {/* Habit Metrics Grid */}
      {(loading || queryLoading) ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
            <div key={i} className="h-32 border border-gray-300 animate-shimmer bg-[length:200%_100%] bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200"></div>
          ))}
        </div>
      ) : !hasRenderableMetricCards ? (
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
            const filteredHabitIds = filteredHabits.map((h: HabitData) => h.habit_id).filter((id: string): id is string => !!id);
            const selectedFilteredHabitIds = validSelectedHabits.filter((id: string) => filteredHabitIds.includes(id));
            const computerCardData = computerActivityCard;
            const isComputerSelected = detectedComputerHabitId ? validSelectedHabits.includes(detectedComputerHabitId) : true;
            const showComputerCard = Boolean(computerCardData) && isComputerSelected;

            const habitsToShow = validSelectedHabits.length > 0
              ? selectedFilteredHabitIds
              : filteredHabitIds;

            const metricCardIds = showComputerCard
              ? [...habitsToShow, COMPUTER_ACTIVITY_CARD_ID]
              : habitsToShow;

            if (viewMode === 'chart') {
              return (
                <div 
                  className={`mx-auto grid w-full max-w-[920px] grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4 transition-opacity duration-300 ${
                    expandedHabit ? 'opacity-50 pointer-events-auto' : 'opacity-100'
                  }`}
                >
                  {metricCardIds.map((habitId: string) => {
                    const cardData = habitId === COMPUTER_ACTIVITY_CARD_ID
                      ? computerCardData
                      : getHabitCardData(habitId);
                    if (!cardData) return null;

                    return (
                      <div key={habitId} className="min-w-0">
                        <HabitMetricCard
                          {...cardData}
                          chartType="bar"
                          onClick={() => setExpandedHabit(expandedHabit === habitId ? null : habitId)}
                          onRemove={() => {
                            const removedHabitId = habitId === COMPUTER_ACTIVITY_CARD_ID
                              ? detectedComputerHabitId
                              : habitId;
                            if (!removedHabitId) return;
                            if (filterContext) {
                              filterContext.setSelectedHabits((prev: string[]) => prev.filter((id: string) => id !== removedHabitId));
                            } else {
                              setLocalSelectedHabits(prev => prev.filter((id: string) => id !== removedHabitId));
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
              const tickerHabits = metricCardIds.map((habitId: string) => {
                if (habitId === COMPUTER_ACTIVITY_CARD_ID && computerCardData) {
                  return {
                    habit_id: habitId,
                    habit_name: COMPUTER_HABIT_DISPLAY_NAME,
                    category: 'computer',
                    unit: computerCardData.unit || 'hours',
                    display_value: computerCardData.currentValue || 0,
                    absolute_change: computerCardData.absoluteChange || 0,
                    last_7_days_avg: computerCardData.trendCurrentValue || computerCardData.currentValue || 0,
                    prev_7_days_avg: computerCardData.trendPreviousValue || 0,
                    weekly_amount_change_pct: computerCardData.change || 0,
                    chartData: (computerCardData.chartData || []).map((d: ChartDataPoint) => ({ value: d.value || 0 })),
                  };
                }

                const cardData = getHabitCardData(habitId);
                const habit = filteredHabits.find((h: HabitData) => h.habit_id === habitId);

                if (habit && !cardData) {
                  return {
                    habit_id: habitId,
                    habit_name: habit.habit_name || 'Unknown',
                    category: habit.category || '',
                    unit: habit.unit_type || 'count',
                    display_value: 0,
                    absolute_change: 0,
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
                  display_value: cardData.currentValue || 0,
                  absolute_change: cardData.absoluteChange || 0,
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
                      const removedHabitId = habitId === COMPUTER_ACTIVITY_CARD_ID
                        ? detectedComputerHabitId
                        : habitId;
                      if (!removedHabitId) return;
                      if (filterContext) {
                        filterContext.setSelectedHabits((prev: string[]) => prev.filter(id => id !== removedHabitId));
                      } else {
                        setLocalSelectedHabits(prev => prev.filter(id => id !== removedHabitId));
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
              {expandedHabit === COMPUTER_ACTIVITY_CARD_ID ? (
                (() => {
                  const rowsInRange = getComputerActivityRowsForExpandedRange();
                  const expandedData = getComputerActivityExpandedData(rowsInRange);
                  if (!expandedData) return null;

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
                  const points = habitToFinanceSeries(expandedData.chartData);
                  const firstPoint = points[0];
                  const lastPoint = points[points.length - 1];
                  const dateRangeText = hasCustomDateRange
                    ? `${format(dateRange!.from!, 'MMM d, yyyy')} – ${format(dateRange!.to!, 'MMM d, yyyy')}`
                    : (firstPoint && lastPoint
                      ? `${format(new Date(firstPoint.t), 'MMM d, yyyy')} – ${format(new Date(lastPoint.t), 'MMM d, yyyy')}`
                      : 'No data');
                  const deltaDirection = expandedData.change >= 0 ? 'up' : 'down';
                  const deltaValueText = `${expandedData.absoluteChange >= 0 ? '+' : ''}${expandedData.absoluteChange.toFixed(2)}`;
                  const deltaPercentText = `${expandedData.change >= 0 ? '+' : ''}${expandedData.change.toFixed(2)}%`;
                  const primaryValue = lastPoint
                    ? Number(lastPoint.close).toFixed(Number(lastPoint.close) < 10 ? 2 : 0)
                    : '--';

                  const stats: Array<{ label: string; value: string }> = [
                    { label: 'Total', value: `${expandedData.total.toFixed(2)}h` },
                    { label: 'Average', value: `${expandedData.average.toFixed(2)}h` },
                    { label: 'Min', value: `${expandedData.min.toFixed(2)}h` },
                    { label: 'Max', value: `${expandedData.max.toFixed(2)}h` },
                    { label: 'Std Dev', value: `${expandedData.stdDev.toFixed(2)}h` },
                  ];

                  return (
                    <div ref={exportCardRef}>
                      <ExpandedMetricCard
                        title={COMPUTER_HABIT_DISPLAY_NAME}
                        primaryValue={primaryValue}
                        unit="hours"
                        deltaValue={deltaValueText}
                        deltaPercent={deltaPercentText}
                        deltaDirection={deltaDirection}
                        dateRangeText={dateRangeText}
                        rangePreset={expandedTimeRange}
                        onRangePresetChange={(value) => setExpandedTimeRange(value as RangeKey)}
                        rangeOptions={ranges}
                        rangeLockedText={hasCustomDateRange ? 'Custom range' : undefined}
                        actions={(
                          <button
                            type="button"
                            onClick={() => captureExpandedChart(COMPUTER_HABIT_DISPLAY_NAME)}
                            disabled={isCapturing}
                            aria-label="Export chart image"
                            title="Export chart image"
                            className="inline-flex h-[30px] w-[30px] items-center justify-center border border-[rgba(39,37,30,0.07)] bg-white text-[rgba(39,37,30,0.65)] transition-colors hover:bg-[rgba(39,37,30,0.02)] hover:text-[#27251E] disabled:cursor-wait disabled:opacity-70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gray-400 focus-visible:ring-inset"
                          >
                            <Camera className="h-3.5 w-3.5" />
                          </button>
                        )}
                        onClose={() => setExpandedHabit(null)}
                        stats={stats}
                        showStats
                      >
                        <div ref={chartRef}>
                          <PerplexityExpandedHabitChart
                            points={points}
                            range={expandedTimeRange}
                            unit="hours"
                            chartType={expandedChartType}
                            showGrid
                            showReferenceLine
                          />
                        </div>
                      </ExpandedMetricCard>
                    </div>
                  );
                })()
              ) : loadingExpandedLogs ? (
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

                const compareOptions = filteredHabits
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
                  <div ref={exportCardRef}>
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
                          placeholder="None"
                        />
                      )}
                      actions={(
                        <button
                          type="button"
                          onClick={() => captureExpandedChart(habit.habit_name)}
                          disabled={isCapturing}
                          aria-label="Export chart image"
                          title="Export chart image"
                          className="inline-flex h-[30px] w-[30px] items-center justify-center border border-[rgba(39,37,30,0.07)] bg-white text-[rgba(39,37,30,0.65)] transition-colors hover:bg-[rgba(39,37,30,0.02)] hover:text-[#27251E] disabled:cursor-wait disabled:opacity-70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gray-400 focus-visible:ring-inset"
                        >
                          <Camera className="h-3.5 w-3.5" />
                        </button>
                      )}
                      onClose={() => setExpandedHabit(null)}
                      stats={stats}
                      showStats
                    >
                      <div ref={chartRef}>
                        <PerplexityExpandedHabitChart
                          points={points}
                          range={expandedTimeRange}
                          unit={habit.unit_type || (habit as any).unit || ''}
                          compareLabel={compHabit?.habit_name}
                          compareUnit={compHabit?.unit_type || (compHabit as any)?.unit || ''}
                          chartType={expandedChartType}
                          showGrid
                          showReferenceLine
                        />
                      </div>
                    </ExpandedMetricCard>
                  </div>
                );
              })()}
            </div>
          )}
        </>
      ) : null}

      {/* Activity Breakdown panel (timeline + app/website horizontal bars) */}
      {showComputerActivity ? (
        <div className="mx-auto mt-8 w-full max-w-[888px]">
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
            className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            Show Activity Breakdown Panel
          </button>
        </div>
      )}

      {showShareModal ? (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6">
          <div
            className="absolute inset-0 bg-transparent"
            onClick={closeShareModal}
          />
          <div className="relative z-10 w-[min(92vw,680px)] max-h-[86vh] overflow-hidden rounded-sm border border-[rgba(39,37,30,0.12)] bg-white p-3 sm:p-4 shadow-[0_16px_36px_rgba(15,23,42,0.12)]">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-[26px] font-medium leading-[1.02] tracking-[-0.7px] text-[#27251E]">
                Share screenshot
              </h2>
              <button
                type="button"
                onClick={closeShareModal}
                className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-[rgba(39,37,30,0.12)] bg-white/80 text-[rgba(39,37,30,0.56)] transition-colors hover:bg-white hover:text-[#27251E]"
                aria-label="Close share screenshot modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-2.5 bg-white">
              {isCapturing ? (
                <div className="flex min-h-[220px] items-center justify-center">
                  <div className="text-center">
                    <BrailleSpinner className="mx-auto text-[30px] text-[rgba(39,37,30,0.6)]" />
                    <p className="mt-2 text-sm text-[rgba(39,37,30,0.62)]">Preparing screenshot...</p>
                  </div>
                </div>
              ) : shareImageUrl ? (
                <div className="max-h-[52vh] overflow-auto">
                  <img
                    src={shareImageUrl}
                    alt={`${shareLabel} chart screenshot preview`}
                    className="block h-auto w-full rounded-sm object-contain"
                  />
                </div>
              ) : (
                <div className="flex min-h-[220px] items-center justify-center text-sm text-[rgba(39,37,30,0.62)]">
                  Couldn&apos;t prepare screenshot preview.
                </div>
              )}
            </div>

            <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={copyShareImage}
                disabled={!shareImageUrl || isCapturing}
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-sm border border-border bg-[rgba(39,37,30,0.04)] px-2.5 text-[13px] font-medium tracking-[-0.2px] text-[#2E2C24] transition-colors hover:bg-[rgba(39,37,30,0.08)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Copy className="h-3.5 w-3.5" />
                {copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy Failed' : 'Copy Image'}
              </button>

              <button
                type="button"
                onClick={downloadShareImage}
                disabled={!shareImageUrl || isCapturing}
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-sm border border-border bg-[rgba(39,37,30,0.04)] px-2.5 text-[13px] font-medium tracking-[-0.2px] text-[#2E2C24] transition-colors hover:bg-[rgba(39,37,30,0.08)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Download className="h-3.5 w-3.5" />
                {downloadState === 'done' ? 'Downloaded' : downloadState === 'failed' ? 'Download Failed' : 'Download Image'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Habit Summary Side Panel */}
      <DialogPrimitive.Root open={summaryPanelOpen} onOpenChange={(open) => setSummaryPanelOpen(open)}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/5 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <DialogPrimitive.Content
            onOpenAutoFocus={(e) => e.preventDefault()}
            className="fixed inset-y-0 right-0 z-50 h-full w-[320px] border-l border-white/30 shadow-[-2px_0_24px_rgba(0,0,0,0.08)] transition ease-in-out data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:duration-200 data-[state=open]:duration-300 data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right"
            style={{ background: 'rgba(255, 255, 255, 0.72)', backdropFilter: 'blur(40px) saturate(1.8)', WebkitBackdropFilter: 'blur(40px) saturate(1.8)' }}
          >
            <DialogPrimitive.Title className="sr-only">Habit Summary</DialogPrimitive.Title>
            <div className="flex items-center justify-between px-5 pt-5 pb-3">
              <h3 className="text-[13px] font-semibold text-[#1A1A1A]/80 uppercase tracking-[0.04em]">Habit Summary</h3>
              <DialogPrimitive.Close className="text-[#1A1A1A]/30 hover:text-[#1A1A1A]/60 transition-colors">
                <X className="h-3.5 w-3.5" />
              </DialogPrimitive.Close>
            </div>

            <div className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 52px)' }}>
              {summaryRows.map((row: typeof summaryRows[number], i: number) => (
                <div
                  key={row.id}
                  className={`flex items-center justify-between px-5 py-[10px] hover:bg-white/40 transition-colors cursor-pointer ${
                    i < summaryRows.length - 1 ? 'border-b border-[#1A1A1A]/[0.06]' : ''
                  }`}
                  onClick={() => {
                    setSummaryPanelOpen(false);
                    setExpandedHabit(row.id);
                  }}
                >
                  <span className="text-[13px] font-medium text-[#1A1A1A]/85 truncate mr-3">{row.name}</span>
                  <div className="flex items-center gap-2.5 shrink-0">
                    <span className="text-[13px] tabular-nums text-[#1A1A1A]/90 font-medium">{row.value}</span>
                    <span
                      className={`inline-flex items-center gap-[3px] rounded-[4px] px-[7px] py-[2.5px] text-[11px] font-semibold tabular-nums leading-none ${
                        row.isUp
                          ? 'bg-[#34C759]/15 text-[#248A3D]'
                          : row.isDown
                            ? 'bg-[#FF3B30]/12 text-[#D70015]'
                            : 'bg-[#1A1A1A]/[0.06] text-[#1A1A1A]/40'
                      }`}
                    >
                      {row.isUp ? '↗' : row.isDown ? '↘' : '–'} {row.pctText}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}
