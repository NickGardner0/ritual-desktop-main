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
  ChevronLeft,
  ChevronRight,
  Download,
  X,
} from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { DateRange } from 'react-day-picker';
import { format, parseISO, startOfDay, differenceInDays, subDays, eachDayOfInterval } from 'date-fns';
import { analyticsApi } from '@/lib/services/analytics-api';
import { useAnalyticsFiltersOptional } from './analytics-filter-context';
import { useHabits } from '@/contexts/HabitsContext';
import type { RangeKey } from '@/components/charts/PerplexityExpandedHabitChart';
import { habitToFinanceSeries } from '@/lib/charts/habitToFinanceSeries';
import { BrailleSpinner } from '@/components/ui/braille-spinner';
import { ExpandedMetricCard } from '@/components/metrics/ExpandedMetricCard';
import type { RangeOption } from '@/components/metrics/RangeSegmentedControl';
import { isTauri } from '@/lib/tauri-utils';
import { invokeDailySummariesWithInitRetry } from '@/lib/computerActivity/tauri-activity';
import { normalizeComputerDailySummaryRow, type NormalizedComputerDailyRow } from '@/lib/computerActivity/normalize';
import {
  COMPUTER_HABIT_DISPLAY_NAME,
  getHabitDisplayName,
  isComputerHabitName,
} from '@/lib/computer-time-habit';
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

const HabitTickerCard = dynamic(
  () => import('@/components/analytics/habit-ticker-view').then(m => ({ default: m.HabitTickerCard })),
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

import { VercelBarListCard } from '@/components/analytics/vercel-bar-list';
import { ComputerTimeBarList } from '@/components/analytics/computer-time-bar-list';
import type { BarListItem, BarListRange } from '@/components/analytics/vercel-bar-list';
import { HabitChartCard } from '@/components/analytics/habit-chart-card';

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
const CARD_ORDER_KEY = 'ritual-metric-card-order';

// ── Metric Category Tabs ──
const METRIC_CATEGORY_TABS = [
  { id: 'all', label: 'All' },
  { id: 'health', label: 'Health' },
  { id: 'digital', label: 'Digital' },
  { id: 'productivity', label: 'Productivity' },
  { id: 'experiments', label: 'Experiments' },
] as const;

/** Map a habit to one of the fixed category tabs by name pattern. */
function getMetricCategoryForHabit(habitName: string, dbCategory?: string): string {
  const name = habitName.toLowerCase();

  // Health
  if (name.includes('sleep') || name.includes('heart') || name.includes('step')
    || name.includes('walk') || name.includes('workout') || name.includes('exercise')
    || name.includes('calorie') || name.includes('weight') || name.includes('water')
    || name.includes('hydrat') || name.includes('running') || name.includes('yoga')
    || name.includes('stretch') || name.includes('recovery') || name.includes('hrv')
    || name.includes('resting') || name.includes('strain')) return 'health';

  // Digital
  if (name.includes('screen time') || name.includes('computer')
    || name.includes('social media') || name.includes('phone')
    || name.includes('digital')) return 'digital';

  // Productivity
  if (name.includes('coding') || name.includes('deep work') || name.includes('focus')
    || name.includes('reading') || name.includes('read') || name.includes('journal')
    || name.includes('meditat') || name.includes('study') || name.includes('writing')
    || name.includes('planning') || name.includes('time block')) return 'productivity';

  // Experiments
  if (name.includes('nicotine') || name.includes('caffeine') || name.includes('alcohol')
    || name.includes('fasting') || name.includes('cold') || name.includes('supplement')
    || name.includes('nootropic') || name.includes('experiment')
    || name.includes('tobacco') || name.includes('sugar')) return 'experiments';

  // Fall back to db category if it matches one of our tabs
  const cat = (dbCategory || '').toLowerCase();
  if (cat.includes('fitness') || cat.includes('health') || cat.includes('wellness')) return 'health';
  if (cat.includes('productivity') || cat.includes('education') || cat.includes('learning')) return 'productivity';
  if (cat.includes('experiment')) return 'experiments';

  return 'experiments'; // default bucket
}

function SortableMetricCard({ id, children }: { id: string; children: React.ReactNode }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.85 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="min-w-0">
      {children}
    </div>
  );
}

type HeartRateSummaryRow = {
  current_avg_bpm?: number;
  previous_avg_bpm?: number;
  change_pct?: number;
  absolute_change?: number;
  min_bpm?: number;
  max_bpm?: number;
  total_samples?: number;
  days_with_data?: number;
  first_day?: string;
  last_day?: string;
};

type HeartRateSeriesRow = {
  bucket_start: string;
  bpm_avg: number;
  bpm_min: number;
  bpm_max: number;
  sample_count: number;
};

function getHeartRateBucket(rangeKey: RangeKey, rangeDays?: number): '1m' | 'hour' | 'day' {
  if (typeof rangeDays === 'number' && Number.isFinite(rangeDays)) {
    if (rangeDays <= 1) return '1m';
    if (rangeDays <= 7) return 'hour';
    return 'day';
  }

  switch (rangeKey) {
    case '1D':
      return '1m';
    case '5D':
    case '1W':
      return 'hour';
    default:
      return 'day';
  }
}

function isSleepLikeHabit(habit?: HabitData | null): boolean {
  if (!habit) return false;

  const metricType = String((habit as any)?.metric_type || '').toLowerCase();
  const habitName = String(habit.habit_name || '').toLowerCase();

  return metricType.includes('sleep') || habitName.includes('sleep');
}

function isGranularHeartRateHabit(habit?: HabitData | null): boolean {
  if (!habit) return false;

  const metricType = String((habit as any)?.metric_type || '').toLowerCase();
  const habitName = String(habit.habit_name || '').toLowerCase();
  const integrationSource = String((habit as any)?.integration_source || '').toLowerCase();

  if (integrationSource !== 'whoop') return false;
  return metricType === 'heart_rate' || metricType === 'hr' || habitName === 'heart rate';
}

function mapDailyBreakdownRows(habitId: string, rows: any[]): any[] {
  return rows.map((point: any) => {
    const entries = Array.isArray(point?.entries) ? point.entries : [];
    const sleepEntry = entries.find((entry: any) => entry?.sleep_start || entry?.sleep_end || entry?.time) || entries[0];

    return {
      habit_id: habitId,
      date: point.date,
      daily_value: Number(point.value ?? point.total_amount ?? 0),
      unit: point.unit,
      total_amount: Number(point.total_amount ?? point.value ?? 0),
      total_duration_seconds: Number(point.total_duration_seconds ?? 0),
      completed_count: entries.length || (Number(point.value || point.total_amount || 0) > 0 ? 1 : 0),
      entries,
      sleep_onset: point.sleep_onset ?? sleepEntry?.sleep_start ?? null,
      sleep_end: point.sleep_end ?? sleepEntry?.sleep_end ?? null,
      time: point.time ?? sleepEntry?.time ?? null,
      completed_at: point.completed_at ?? null,
    };
  });
}

interface MetricsViewProps {
  externalDateRange?: DateRange | undefined;
  onDateRangeChange?: (range: DateRange | undefined) => void;
  hideControls?: boolean;
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

/**
 * Infer whether a higher value is desirable for a given habit.
 * Returns true  → higher = good (green), lower = bad (red)
 * Returns false → lower = good (green), higher = bad (red)
 * Returns null  → neutral / unknown — keep default up=green, down=red
 */
function inferHigherIsBetter(habitName: string, unit?: string): boolean | null {
  const name = habitName.toLowerCase();
  const u = (unit || '').toLowerCase();

  // Explicitly "lower is better"
  if (name.includes('nicotine') || name.includes('tobacco') || name.includes('smoking')) return false;
  if (name.includes('alcohol') || name.includes('drinking') || name.includes('drinks')) return false;
  if (name.includes('screen time')) return false;
  if (name.includes('social media') && !name.includes('post')) return false;
  if (name.includes('junk food') || name.includes('fast food')) return false;
  if (name.includes('sugar') && !name.includes('blood')) return false;
  if (name.includes('procrastinat')) return false;
  if (name.includes('caffeine') || name.includes('coffee')) return false;
  if (name.includes('stress')) return false;
  if (name.includes('anxiety')) return false;
  if (name.includes('idle') || name.includes('sedentary') || name.includes('sitting')) return false;

  // Explicitly "higher is better"
  if (name.includes('sleep') && (u.includes('hour') || u.includes('min'))) return true;
  if (name.includes('workout') || name.includes('exercise') || name.includes('training')) return true;
  if (name.includes('step') || name.includes('walk') || name.includes('run')) return true;
  if (name.includes('reading') || name.includes('read')) return true;
  if (name.includes('meditat')) return true;
  if (name.includes('water') || name.includes('hydrat')) return true;
  if (name.includes('coding') || name.includes('deep work') || name.includes('focus')) return true;
  if (name.includes('journal')) return true;
  if (name.includes('stretching') || name.includes('yoga')) return true;
  if (name.includes('savings') || name.includes('income')) return true;
  if (name.includes('gratitude')) return true;

  // Default: null means we don't know, use standard up=green/down=red
  return null;
}

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
  const [habitDropdownOpen, setHabitDropdownOpen] = useState(false);
  const [analyticsData, setAnalyticsData] = useState<any>({});
  const [expandedHabit, setExpandedHabit] = useState<string | null>(null);
  const [expandedLogs, setExpandedLogs] = useState<any[]>([]);
  const [expandedSyncContext, setExpandedSyncContext] = useState<any>(null);
  const [loadingExpandedLogs, setLoadingExpandedLogs] = useState(false);

  const [summaryMetrics, setSummaryMetrics] = useState<Record<string, any>>({});

  const [expandedTimeRange, setExpandedTimeRange] = useState<RangeKey>('1M');
  const [barListRange, setBarListRange] = useState<BarListRange>('1M');
  const [compareHabitId, setCompareHabitId] = useState<string | null>(null);
  const [comparisonLogs, setComparisonLogs] = useState<any[]>([]);
  const [loadingComparison, setLoadingComparison] = useState(false);
  const [activeCategoryTab, setActiveCategoryTab] = useState<string | null>(null);
  const [cardPage, setCardPage] = useState(0);
  const [totalCardPages, setTotalCardPages] = useState(1);
  const clampedCardPage = Math.min(cardPage, Math.max(totalCardPages - 1, 0));

  const [correlationData, setCorrelationData] = useState<any>(null);
  const [loadingCorrelation, setLoadingCorrelation] = useState(false);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [computerActivityDaily, setComputerActivityDaily] = useState<ComputerDailyRow[]>([]);
  const [heartRateExpandedSeries, setHeartRateExpandedSeries] = useState<HeartRateSeriesRow[]>([]);
  const [heartRateExpandedSummary, setHeartRateExpandedSummary] = useState<HeartRateSummaryRow | null>(null);

  // Drag-to-reorder: persisted card order
  const [appliedCardOrder, setAppliedCardOrder] = useState<string[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const stored = localStorage.getItem(CARD_ORDER_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  });

  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Track current visible card IDs so handleDragEnd can seed order if needed
  const visibleCardIdsRef = useRef<string[]>([]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setAppliedCardOrder((prev) => {
      // If order is empty, seed from current visible IDs
      const base = prev.length > 0 ? prev : visibleCardIdsRef.current;
      const activeId = String(active.id);
      const overId = String(over.id);
      const oldIndex = base.indexOf(activeId);
      const newIndex = base.indexOf(overId);
      if (oldIndex === -1 || newIndex === -1) return base;
      const next = arrayMove(base, oldIndex, newIndex);
      try { localStorage.setItem(CARD_ORDER_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

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
  const hasCustomDateRange = !!(dateRange?.from && dateRange?.to);
  const expandedHabitData = React.useMemo(
    () => availableHabits.find((h: HabitData) => h.habit_id === expandedHabit) || null,
    [availableHabits, expandedHabit],
  );
  const expandedHabitUsesGranularHeartRate = isGranularHeartRateHabit(expandedHabitData);

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

  // Auto-select all habits when data loads
  useEffect(() => {
    if (availableHabits.length > 0 && selectedHabits.length === 0) {
      const allHabitIds = availableHabits.map((h: HabitData) => h.habit_id).filter((id: string) => !!id);
      if (allHabitIds.length > 0) {
        setSelectedHabits(allHabitIds);
      }
    }
  }, [availableHabits, selectedHabits.length, setSelectedHabits]);

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
      const useWideRange = !dateRange?.from || !dateRange?.to;

      if (!useWideRange) {
        params.set('start_date', format(dateRange!.from!, 'yyyy-MM-dd'));
        params.set('end_date', format(dateRange!.to!, 'yyyy-MM-dd'));
      } else {
        params.set('days_back', '1095');
      }

      if (habitsToFetch.length === 1) {
        params.set('habit_id', habitsToFetch[0]);
      } else {
        params.set('habit_ids', habitsToFetch.join(','));
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

        const sleepHabitIds = habitsToFetch.filter((habitId) =>
          isSleepLikeHabit(availableHabits.find((habit: HabitData) => habit.habit_id === habitId))
        );

        if (sleepHabitIds.length > 0) {
          const token = await getToken();
          if (token) {
            const now = new Date();
            const to = useWideRange ? now : (dateRange?.to || now);
            const from = useWideRange ? subDays(now, 1095) : (dateRange?.from || subDays(now, 1095));
            const startDate = format(from, 'yyyy-MM-dd');
            const endDate = format(to, 'yyyy-MM-dd');
            const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;

            const [statsResult, dailyResults] = await Promise.all([
              analyticsApi.getHabitStats(token, { startDate, endDate }),
              Promise.all(
                sleepHabitIds.map((habitId) =>
                  analyticsApi.getDailyBreakdown(token, {
                    habitId,
                    startDate,
                    endDate,
                    timezone,
                  }).catch(() => null)
                )
              ),
            ]);

            const statsById = new Map(
              (statsResult.habits || []).map((stat: any) => [stat.id, stat])
            );

            sleepHabitIds.forEach((habitId, index) => {
              const stat = statsById.get(habitId);
              if (stat) {
                summaryMap[habitId] = {
                  ...(summaryMap[habitId] || {}),
                  habit_id: stat.id,
                  habit_name: stat.name,
                  unit: stat.unit,
                  total_value: stat.total,
                  current_value: stat.average,
                  days_with_data: stat.days_with_data,
                };
              }

              const response = dailyResults[index];
              const rows = response?.data || response?.daily_data || [];
              if (rows.length > 0) {
                dataByHabit[habitId] = mapDailyBreakdownRows(habitId, rows);
              }
            });
          }
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
          const fallbackTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;

          const [statsResult, dailyResults] = await Promise.all([
            analyticsApi.getHabitStats(token, {
              startDate: format(from, 'yyyy-MM-dd'),
              endDate: format(to, 'yyyy-MM-dd'),
            }),
            Promise.all(
              habitsToFetch.map((habitId) =>
                analyticsApi.getDailyBreakdown(token, {
                  habitId,
                  startDate: format(from, 'yyyy-MM-dd'),
                  endDate: format(to, 'yyyy-MM-dd'),
                  timezone: fallbackTimezone,
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
            fallbackDailyByHabit[habitId] = mapDailyBreakdownRows(habitId, rows);
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
    // Cap default computer activity to 180 days to avoid slow queries on large DBs
    const startDate = format(hasExplicitRange ? dateRange!.from! : subDays(now, 180), 'yyyy-MM-dd');
    const endDate = format(hasExplicitRange ? dateRange!.to! : now, 'yyyy-MM-dd');
    const query = `start_date=${startDate}&end_date=${endDate}`;
    const controller = new AbortController();

    const fetchComputerActivity = async () => {
      try {
        let dailyRows: ComputerDailyRow[] = [];

        if (isTauri()) {
          const summaries = await invokeDailySummariesWithInitRetry(startDate, endDate);
          if (controller.signal.aborted) return;

          dailyRows = summaries
            .map(normalizeComputerDailySummaryRow)
            .filter((row): row is NormalizedComputerDailyRow => Boolean(row && row.day && row.active_hours >= 0))
            .sort((a, b) => a.day.localeCompare(b.day));
        } else {
          const dailyRes = await fetch(`/api/watcher/stats/daily?${query}`, { signal: controller.signal });

          if (!dailyRes.ok) {
            console.warn('Computer activity API returned', dailyRes.status, await dailyRes.text().catch(() => ''));
            setComputerActivityDaily([]);
            return;
          }

          const dailyPayload = await dailyRes.json();

          if (controller.signal.aborted) return;

          const fallbackRows: any[] = Array.isArray(dailyPayload?.data) ? dailyPayload.data : [];
          dailyRows = fallbackRows
            .map(normalizeComputerDailySummaryRow)
            .filter((row): row is NormalizedComputerDailyRow => Boolean(row && row.day && row.active_hours >= 0))
            .sort((a, b) => a.day.localeCompare(b.day));
        }

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
    if (!expandedHabit || !compareHabitId || expandedHabit === COMPUTER_ACTIVITY_CARD_ID || expandedHabitUsesGranularHeartRate) {
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
  }, [expandedHabit, compareHabitId, expandedHabitUsesGranularHeartRate]);

  useEffect(() => {
    if (!expandedHabitUsesGranularHeartRate) {
      setHeartRateExpandedSeries([]);
      setHeartRateExpandedSummary(null);
      return;
    }

    const controller = new AbortController();
    const rangeDates = hasCustomDateRange
      ? { from: dateRange!.from!, to: dateRange!.to! }
      : getRangeDates(expandedTimeRange);
    const rangeSpanDays = differenceInDays(rangeDates.to, rangeDates.from) + 1;
    const bucket = getHeartRateBucket(expandedTimeRange, rangeSpanDays);
    const params = new URLSearchParams({
      start_date: format(rangeDates.from, 'yyyy-MM-dd'),
      end_date: format(rangeDates.to, 'yyyy-MM-dd'),
      bucket,
    });

    const fetchExpandedHeartRate = async () => {
      setLoadingExpandedLogs(true);
      try {
        const [summaryRes, seriesRes] = await Promise.all([
          fetch(`/api/analytics/heart-rate/summary?${params.toString()}`, { signal: controller.signal }),
          fetch(`/api/analytics/heart-rate/series?${params.toString()}`, { signal: controller.signal }),
        ]);

        if (!summaryRes.ok || !seriesRes.ok) {
          throw new Error(`Failed to load heart-rate detail (summary=${summaryRes.status}, series=${seriesRes.status})`);
        }

        const [summaryPayload, seriesPayload] = await Promise.all([
          summaryRes.json(),
          seriesRes.json(),
        ]);

        if (controller.signal.aborted) return;

        setHeartRateExpandedSummary(summaryPayload?.data || null);
        setHeartRateExpandedSeries(Array.isArray(seriesPayload?.data) ? seriesPayload.data : []);
      } catch (error) {
        if (controller.signal.aborted) return;
        console.warn('Failed to load expanded heart-rate analytics:', error);
        setHeartRateExpandedSummary(null);
        setHeartRateExpandedSeries([]);
      } finally {
        if (!controller.signal.aborted) {
          setLoadingExpandedLogs(false);
        }
      }
    };

    fetchExpandedHeartRate();

    return () => controller.abort();
  }, [
    expandedHabitUsesGranularHeartRate,
    expandedTimeRange,
    hasCustomDateRange,
    dateRange?.from?.toISOString(),
    dateRange?.to?.toISOString(),
  ]);

  // Fetch expanded logs
  useEffect(() => {
    if (!expandedHabit) {
      setExpandedLogs([]);
      setExpandedSyncContext(null);
      setExpandedTimeRange('1M');
      setCompareHabitId(null);
      setComparisonLogs([]);
      return;
    }

    if (expandedHabit === COMPUTER_ACTIVITY_CARD_ID || expandedHabitUsesGranularHeartRate) {
      setExpandedLogs([]);
      setExpandedSyncContext(null);
      setCompareHabitId(null);
      setComparisonLogs([]);
      if (expandedHabit === COMPUTER_ACTIVITY_CARD_ID) {
        setLoadingExpandedLogs(false);
      }
      return;
    }

    const metricType = String((expandedHabitData as any)?.metric_type || '').toLowerCase();
    const habitName = String(expandedHabitData?.habit_name || '').toLowerCase();
    const shouldAttachSleepMetadata = metricType.includes('sleep') || habitName.includes('sleep');
    const shouldPreferPythonBreakdown = isSleepLikeHabit(expandedHabitData);

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

        if (shouldPreferPythonBreakdown) {
          const token = await getToken();
          if (token) {
            const fallback = await analyticsApi.getDailyBreakdown(token, {
              habitId: expandedHabit,
              startDate,
              endDate,
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || undefined,
            }).catch(() => null);
            setExpandedSyncContext(fallback?.sync_context || null);
            const rows = mapDailyBreakdownRows(expandedHabit, fallback?.data || fallback?.daily_data || []);
            setExpandedLogs(rows);
            return;
          }
        }

        const response = await fetch(
          `/api/analytics/habits/daily-values?output=daily&habit_id=${expandedHabit}&start_date=${startDate}&end_date=${endDate}`
        );

        const result = await response.json();
        if (result.success && result.data?.length > 0) {
          setExpandedSyncContext(null);
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
            const fallback = await analyticsApi.getDailyBreakdown(token, {
              habitId: expandedHabit,
              startDate,
              endDate,
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || undefined,
            }).catch(() => null);
            setExpandedSyncContext(fallback?.sync_context || null);
            const rows = mapDailyBreakdownRows(expandedHabit, fallback?.data || fallback?.daily_data || []);
            const enrichedRows = await enrichRowsWithSleepMetadata(
              rows,
              expandedHabit,
              startDate,
              endDate,
            );
            setExpandedLogs(enrichedRows);
          } else {
            setExpandedSyncContext(null);
            setExpandedLogs([]);
          }
        }
      } catch (error) {
        console.error('❌ Error fetching expanded logs:', error);
        setExpandedSyncContext(null);
        setExpandedLogs([]);
      } finally {
        setLoadingExpandedLogs(false);
      }
    };

    fetchExpandedLogs();
  }, [
    expandedHabit,
    expandedTimeRange,
    hasCustomDateRange,
    dateRange?.from?.toISOString(),
    dateRange?.to?.toISOString(),
    expandedHabitData,
    expandedHabitUsesGranularHeartRate,
    getToken,
  ]);

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
        const compareHabit = availableHabits.find((h: HabitData) => h.habit_id === compareHabitId);

        if (isSleepLikeHabit(compareHabit)) {
          const token = await getToken();
          if (token) {
            const fallback = await analyticsApi.getDailyBreakdown(token, {
              habitId: compareHabitId,
              startDate,
              endDate,
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || undefined,
            }).catch(() => null);
            setComparisonLogs(mapDailyBreakdownRows(compareHabitId, fallback?.data || fallback?.daily_data || []));
            return;
          }
        }

        const response = await fetch(
          `/api/analytics/habits/daily-values?output=daily&habit_id=${compareHabitId}&start_date=${startDate}&end_date=${endDate}`
        );

        const result = await response.json();
        if (result.success && result.data?.length > 0) {
          setComparisonLogs(result.data);
        } else {
          const token = await getToken();
          if (token) {
            const fallback = await analyticsApi.getDailyBreakdown(token, {
              habitId: compareHabitId,
              startDate,
              endDate,
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || undefined,
            }).catch(() => null);
            const rows = mapDailyBreakdownRows(compareHabitId, fallback?.data || fallback?.daily_data || []);
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

    // For wide/unbounded ranges ("All time", or ranges > 60 days), compare
    // the average of the last 30 days vs the 30 days before that.
    // For narrow ranges, compare day-over-day (most recent vs previous logged day).
    const isWideRange = !hasCustomDateRange || (dateRange?.from && dateRange?.to && differenceInDays(dateRange.to, dateRange.from) > 60);

    let latestValue: number;
    let previousValue: number;
    let currentValue: number;

    if (isWideRange && chartData.length > 0) {
      const now = new Date();
      const thirtyDaysAgo = subDays(now, 30);
      const sixtyDaysAgo = subDays(now, 60);

      const recentDays = chartData.filter((d: any) => d.rawDate >= thirtyDaysAgo);
      const priorDays = chartData.filter((d: any) => d.rawDate >= sixtyDaysAgo && d.rawDate < thirtyDaysAgo);

      const recentNonZero = recentDays.filter((d: { value: number }) => d.value > 0);
      const priorNonZero = priorDays.filter((d: { value: number }) => d.value > 0);

      latestValue = recentNonZero.length > 0
        ? recentNonZero.reduce((sum: number, d: { value: number }) => sum + d.value, 0) / recentNonZero.length
        : 0;
      previousValue = priorNonZero.length > 0
        ? priorNonZero.reduce((sum: number, d: { value: number }) => sum + d.value, 0) / priorNonZero.length
        : 0;
      currentValue = latestValue || Number(summary.current_value ?? localAverage ?? 0);
    } else {
      const nonZeroDays = chartData.filter((d: { value: number }) => d.value > 0);
      const latestDay = nonZeroDays.length > 0 ? nonZeroDays[nonZeroDays.length - 1] : null;
      const previousDay = nonZeroDays.length > 1 ? nonZeroDays[nonZeroDays.length - 2] : null;

      latestValue = latestDay ? Number(latestDay.value) : 0;
      previousValue = previousDay ? Number(previousDay.value) : 0;
      currentValue = latestValue || Number(summary.current_value ?? localAverage ?? 0);
    }

    let change = previousValue > 0
      ? ((latestValue - previousValue) / previousValue) * 100
      : (latestValue > 0 ? 100 : 0);
    let absoluteChange = latestValue - previousValue;

    if (!Number.isFinite(change)) change = 0;
    if (!Number.isFinite(absoluteChange)) absoluteChange = 0;

    const habitUnit = summary.unit || habit.unit_type || (habit as any).unit || 'count';

    return {
      habitName: habit.habit_name,
      currentValue,
      unit: habitUnit,
      change,
      absoluteChange,
      chartData: enrichedChartData,
      isPositive: change >= 0,
      higherIsBetter: inferHigherIsBetter(habit.habit_name, habitUnit),
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

    const isWideRangeComputer = !hasCustomDateRange || (dateRange?.from && dateRange?.to && differenceInDays(dateRange.to, dateRange.from) > 60);

    let compLatestValue: number;
    let compPreviousValue: number;

    if (isWideRangeComputer && chartData.length > 0) {
      const now = new Date();
      const thirtyDaysAgo = subDays(now, 30);
      const sixtyDaysAgo = subDays(now, 60);

      const recentDays = chartData.filter((d) => d.rawDate >= thirtyDaysAgo && d.value > 0);
      const priorDays = chartData.filter((d) => d.rawDate >= sixtyDaysAgo && d.rawDate < thirtyDaysAgo && d.value > 0);

      compLatestValue = recentDays.length > 0
        ? recentDays.reduce((sum, d) => sum + d.value, 0) / recentDays.length
        : 0;
      compPreviousValue = priorDays.length > 0
        ? priorDays.reduce((sum, d) => sum + d.value, 0) / priorDays.length
        : 0;
    } else {
      const nonZeroDays = chartData.filter((d) => d.value > 0);
      const latestDay = nonZeroDays.length > 0 ? nonZeroDays[nonZeroDays.length - 1] : null;
      const previousDay = nonZeroDays.length > 1 ? nonZeroDays[nonZeroDays.length - 2] : null;
      compLatestValue = latestDay ? Number(latestDay.value) : 0;
      compPreviousValue = previousDay ? Number(previousDay.value) : 0;
    }

    const change = compPreviousValue > 0 ? ((compLatestValue - compPreviousValue) / compPreviousValue) * 100 : (compLatestValue > 0 ? 100 : 0);
    const absoluteChange = compLatestValue - compPreviousValue;

    return {
      habitName: COMPUTER_HABIT_DISPLAY_NAME,
      currentValue: compLatestValue || average,
      unit: 'hours',
      change: Number.isFinite(change) ? change : 0,
      absoluteChange: Number.isFinite(absoluteChange) ? absoluteChange : 0,
      chartData,
      isPositive: (Number.isFinite(change) ? change : 0) >= 0,
      higherIsBetter: null as boolean | null,
      total,
      average,
      min: values.length > 0 ? Math.min(...values) : 0,
      max: values.length > 0 ? Math.max(...values) : 0,
      events: computerActivityDaily.reduce((sum, row) => sum + Number(row.events_count || 0), 0),
      activeDays: values.filter((value) => value > 0).length,
      trendCurrentValue: compLatestValue || average,
      trendPreviousValue: compPreviousValue,
    };
  }, [computerActivityDaily, hasCustomDateRange, dateRange]);

  const getHeartRateExpandedData = React.useCallback(() => {
    if (!heartRateExpandedSeries.length && !heartRateExpandedSummary) return null;

    const chartData = heartRateExpandedSeries
      .map((row) => {
        const date = parseISO(row.bucket_start);
        return {
          date: format(date, 'MMM d, yyyy h:mm a'),
          shortDate: format(date, 'MMM d'),
          value: Number(row.bpm_avg || 0),
          unit: 'bpm',
          samples: Number(row.sample_count || 0),
          rawDate: date,
        };
      })
      .sort((a, b) => a.rawDate.getTime() - b.rawDate.getTime());

    const values = chartData.map((d) => Number(d.value || 0)).filter((value) => Number.isFinite(value) && value > 0);
    const total = values.reduce((sum, value) => sum + value, 0);
    const average = values.length > 0
      ? total / values.length
      : Number(heartRateExpandedSummary?.current_avg_bpm || 0);
    const min = values.length > 0
      ? Math.min(...values)
      : Number(heartRateExpandedSummary?.min_bpm || 0);
    const max = values.length > 0
      ? Math.max(...values)
      : Number(heartRateExpandedSummary?.max_bpm || 0);

    const latestVal = values.length > 0 ? values[values.length - 1] : average;
    const prevVal = values.length > 1 ? values[values.length - 2] : Number(heartRateExpandedSummary?.previous_avg_bpm || 0);
    const change = prevVal > 0 ? ((latestVal - prevVal) / prevVal) * 100 : (latestVal > 0 ? 100 : 0);
    const absoluteChange = latestVal - prevVal;

    return {
      chartData,
      average,
      min,
      max,
      totalSamples: Number(heartRateExpandedSummary?.total_samples || 0),
      buckets: chartData.length,
      daysWithData: Number(heartRateExpandedSummary?.days_with_data || 0),
      change: Number.isFinite(change) ? change : 0,
      absoluteChange: Number.isFinite(absoluteChange) ? absoluteChange : 0,
    };
  }, [heartRateExpandedSeries, heartRateExpandedSummary]);

  // Get expanded data
  const getExpandedData = (habitId: string) => {
    const habit = availableHabits.find((h: HabitData) => h.habit_id === habitId);
    if (!habit) return null;
    const isMainSleepHabit = isSleepLikeHabit(habit);

    const processLogsToMap = (logsSource: any[], unitType: any, useMaxPerDay = false) => {
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
            const dailyValue = Number(log.daily_value || 0);
            total = useMaxPerDay ? Math.max(total, dailyValue) : total + dailyValue;
            return;
          }

          const duration = Number(log.duration || 0);
          const amount = Number(log.amount || 0);
          let nextValue = 0;

          if (unit.includes('hour')) {
            if (duration > 0) nextValue = duration / 3600;
            else if (amount > 0) nextValue = amount;
          } else if (unit.includes('minute')) {
            if (duration > 0) nextValue = duration / 60;
            else if (amount > 0) nextValue = amount;
          } else {
            nextValue = amount > 0 ? amount : (duration > 0 ? 1 : 0);
          }

          total = useMaxPerDay ? Math.max(total, nextValue) : total + nextValue;
        });
        valuesMap[dateStr] = total;
      });

      return { byDate: valuesMap, logs: logsMap };
    };

    const mainData = processLogsToMap(expandedLogs, habit.unit_type || (habit as any).unit, isMainSleepHabit);

    let compData = { byDate: {}, logs: {} };
    let compHabit: any = null;
    if (compareHabitId) {
      compHabit = availableHabits.find((h: HabitData) => h.habit_id === compareHabitId);
      if (compHabit) {
        compData = processLogsToMap(
          comparisonLogs,
          compHabit.unit_type || (compHabit as any).unit,
          isSleepLikeHabit(compHabit),
        );
      }
    }

    const rangeDates = hasCustomDateRange
      ? { from: dateRange!.from!, to: dateRange!.to! }
      : getRangeDates(expandedTimeRange);
    const allDatesInRange = eachDayOfInterval({ start: startOfDay(rangeDates.from), end: startOfDay(rangeDates.to) })
      .map(d => format(d, 'yyyy-MM-dd'));
    const dataDateSet = new Set([...Object.keys(mainData.byDate), ...Object.keys(compData.byDate)]);
    const allDates = isMainSleepHabit
      ? Array.from(dataDateSet).sort()
      : Array.from(new Set([...allDatesInRange, ...dataDateSet])).sort();

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

      {/* ── Category Tabs + Pagination Arrows ── */}
      <div className="mx-auto w-full max-w-[920px] mb-5">
        <div className="flex items-center gap-0 border-b border-[rgba(39,37,30,0.08)]">
            {METRIC_CATEGORY_TABS.map((tab) => {
              const isActive = activeCategoryTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => { setActiveCategoryTab(tab.id === 'all' ? null : (isActive ? null : tab.id)); setCardPage(0); }}
                  className={`px-3 py-2 text-[13px] font-medium transition-colors relative ${
                    (tab.id === 'all' && activeCategoryTab === null) || isActive
                      ? 'text-[#27251E]'
                      : 'text-[#1E2725] hover:text-[#000]'
                  }`}
                >
                  {tab.label}
                  {((tab.id === 'all' && activeCategoryTab === null) || isActive) && (
                    <span className="absolute bottom-0 left-3 right-3 h-[2px] bg-[#27251E] rounded-full" />
                  )}
                </button>
              );
            })}
        </div>
      </div>

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
      ) : selectedHabits.length > 0 || availableHabits.length > 0 || Boolean(computerActivityCard) ? (
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

            const unorderedIds = [...habitsToShow];
            if (showComputerCard) {
              unorderedIds.push(COMPUTER_ACTIVITY_CARD_ID);
            }

            const metricCardIds = appliedCardOrder.length > 0
              ? [
                  ...appliedCardOrder.filter((id: string) => unorderedIds.includes(id)),
                  ...unorderedIds.filter((id: string) => !appliedCardOrder.includes(id)),
                ]
              : unorderedIds;

            // Keep ref in sync for drag handler seeding
            visibleCardIdsRef.current = metricCardIds;

            // Filter by active category tab
            const visibleIds = activeCategoryTab
              ? metricCardIds.filter((id) => {
                  if (id === COMPUTER_ACTIVITY_CARD_ID) {
                    return activeCategoryTab === 'digital';
                  }
                  const habit = filteredHabits.find((h: HabitData) => h.habit_id === id);
                  if (!habit) return false;
                  return getMetricCategoryForHabit(habit.habit_name, habit.category) === activeCategoryTab;
                })
              : metricCardIds;

            const CARDS_PER_PAGE = 4;
            const computedTotalPages = Math.ceil(visibleIds.length / CARDS_PER_PAGE);
            if (computedTotalPages !== totalCardPages) {
              // Schedule state update for next tick to avoid render-during-render
              Promise.resolve().then(() => setTotalCardPages(computedTotalPages));
            }
            const pageIds = visibleIds.slice(clampedCardPage * CARDS_PER_PAGE, (clampedCardPage + 1) * CARDS_PER_PAGE);

            return (
                <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={pageIds} strategy={rectSortingStrategy}>
                    <div
                      className={`mx-auto relative w-full max-w-[920px] transition-opacity duration-300 ${
                        expandedHabit ? 'opacity-50 pointer-events-auto' : 'opacity-100'
                      }`}
                    >
                    <div className="grid w-full grid-cols-1 gap-[5px] sm:grid-cols-2 lg:grid-cols-4">
                      {pageIds.map((habitId: string) => {
                        const cardData = habitId === COMPUTER_ACTIVITY_CARD_ID
                          ? computerCardData
                          : getHabitCardData(habitId);
                        const habit = habitId === COMPUTER_ACTIVITY_CARD_ID
                          ? null
                          : filteredHabits.find((h: HabitData) => h.habit_id === habitId);

                        // Derive ticker card props
                        let tickerName: string;
                        let tickerUnit: string;
                        let tickerCurrentValue: number;
                        let tickerPercentChange: number;
                        let tickerAbsoluteChange: number;
                        let tickerChartData: { value: number }[];
                        let tickerHigherIsBetter: boolean | null | undefined;

                        if (habitId === COMPUTER_ACTIVITY_CARD_ID && computerCardData) {
                          tickerName = COMPUTER_HABIT_DISPLAY_NAME;
                          tickerUnit = computerCardData.unit || 'hours';
                          tickerCurrentValue = computerCardData.currentValue || 0;
                          tickerPercentChange = computerCardData.change || 0;
                          tickerAbsoluteChange = computerCardData.absoluteChange || 0;
                          tickerChartData = (computerCardData.chartData || []).map((d: ChartDataPoint) => ({ value: d.value || 0 }));
                          tickerHigherIsBetter = computerCardData.higherIsBetter;
                        } else if (cardData && habit) {
                          tickerName = cardData.habitName || habit.habit_name || 'Unknown';
                          tickerUnit = cardData.unit || habit.unit_type || 'count';
                          tickerCurrentValue = cardData.currentValue || 0;
                          tickerPercentChange = cardData.change || 0;
                          tickerAbsoluteChange = cardData.absoluteChange || 0;
                          tickerChartData = (cardData.chartData || []).map((d: ChartDataPoint) => ({ value: d.value || 0 }));
                          tickerHigherIsBetter = cardData.higherIsBetter;
                        } else if (habit) {
                          tickerName = habit.habit_name || 'Unknown';
                          tickerUnit = habit.unit_type || 'count';
                          tickerCurrentValue = 0;
                          tickerPercentChange = 0;
                          tickerAbsoluteChange = 0;
                          tickerChartData = [];
                          tickerHigherIsBetter = inferHigherIsBetter(habit.habit_name, habit.unit_type);
                        } else {
                          return null;
                        }

                        return (
                          <SortableMetricCard key={habitId} id={habitId}>
                            <HabitTickerCard
                              habitName={tickerName}
                              unit={tickerUnit}
                              currentValue={tickerCurrentValue}
                              percentChange={tickerPercentChange}
                              absoluteChange={tickerAbsoluteChange}
                              chartData={tickerChartData}
                              higherIsBetter={tickerHigherIsBetter}
                              onClick={() => setExpandedHabit(expandedHabit === habitId ? null : habitId)}
                              onRemove={() => {
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
                            />
                          </SortableMetricCard>
                        );
                      })}
                    </div>
                    </div>
                  </SortableContext>
                </DndContext>
            );
          })()}

          {/* ── Vercel-style analytics sections ── */}
          {!expandedHabit && (() => {
            if (filteredHabits.length === 0) return null;

            // ─── Compute range-filtered habit data for bar list ───
            const barRangeDates = getRangeDates(barListRange as RangeKey);
            const rangeFrom = barRangeDates.from;
            const rangeTo = barRangeDates.to;

            const shortenUnit = (u: string) => {
              const lower = u.toLowerCase();
              if (lower === 'milligrams') return 'mg';
              return u;
            };
            const formatBarValue = (v: number, unit: string) => {
              const formatted = v >= 1000
                ? Math.round(v).toLocaleString()
                : v >= 10 ? v.toFixed(1) : v.toFixed(2);
              return `${formatted} ${shortenUnit(unit)}`.trim();
            };

            const habitBarData = filteredHabits
              .map((h: HabitData) => {
                const logs = analyticsData[h.habit_id] || [];
                const unit = summaryMetrics[h.habit_id]?.unit || h.unit_type || 'count';
                const hib = inferHigherIsBetter(h.habit_name, unit);

                // Filter logs to selected range
                const rangeLogs = logs.filter((l: any) => {
                  if (!l.date) return false;
                  const d = parseISO(l.date);
                  return d >= rangeFrom && d <= rangeTo;
                });

                if (rangeLogs.length === 0) return null;

                const values = rangeLogs.map((l: any) =>
                  Number(l.daily_value ?? l.value ?? l.total_amount ?? 0)
                ).filter((v: number) => v > 0);

                if (values.length === 0) return null;

                // Use average for heart rate, total for everything else
                const useAverage = h.habit_name.toLowerCase().includes('heart rate');
                const total = values.reduce((s: number, v: number) => s + v, 0);
                const displayVal = useAverage ? total / values.length : total;

                // Compare: split range in half for change calculation
                const midPoint = new Date((rangeFrom.getTime() + rangeTo.getTime()) / 2);
                const firstHalf = rangeLogs.filter((l: any) => parseISO(l.date) < midPoint);
                const secondHalf = rangeLogs.filter((l: any) => parseISO(l.date) >= midPoint);

                const firstValues = firstHalf.map((l: any) => Number(l.daily_value ?? l.value ?? l.total_amount ?? 0)).filter((v: number) => v > 0);
                const secondValues = secondHalf.map((l: any) => Number(l.daily_value ?? l.value ?? l.total_amount ?? 0)).filter((v: number) => v > 0);

                const firstSum = firstValues.reduce((s: number, v: number) => s + v, 0);
                const secondSum = secondValues.reduce((s: number, v: number) => s + v, 0);
                const firstCompare = useAverage && firstValues.length > 0 ? firstSum / firstValues.length : firstSum;
                const secondCompare = useAverage && secondValues.length > 0 ? secondSum / secondValues.length : secondSum;

                let change = firstCompare > 0
                  ? ((secondCompare - firstCompare) / firstCompare) * 100
                  : (secondCompare > 0 ? 100 : 0);
                if (!Number.isFinite(change)) change = 0;

                return {
                  habitId: h.habit_id,
                  name: h.habit_name,
                  avg: displayVal,
                  unit,
                  change,
                  higherIsBetter: hib,
                  daysWithData: values.length,
                  category: getMetricCategoryForHabit(h.habit_name, h.category),
                };
              })
              .filter(Boolean) as any[];

            // ─── Add Computer Activity if available ───
            if (computerActivityDaily.length > 0) {
              const compLogs = computerActivityDaily.filter((row) => {
                const d = parseISO(row.day);
                return d >= rangeFrom && d <= rangeTo;
              });
              const compValues = compLogs.map((r) => Number(r.active_hours || 0)).filter((v) => v > 0);
              if (compValues.length > 0) {
                const compTotal = compValues.reduce((s, v) => s + v, 0);
                const midPoint = new Date((rangeFrom.getTime() + rangeTo.getTime()) / 2);
                const compFirst = compLogs.filter((r) => parseISO(r.day) < midPoint).map((r) => Number(r.active_hours || 0)).filter((v) => v > 0);
                const compSecond = compLogs.filter((r) => parseISO(r.day) >= midPoint).map((r) => Number(r.active_hours || 0)).filter((v) => v > 0);
                const compFirstTotal = compFirst.reduce((s, v) => s + v, 0);
                const compSecondTotal = compSecond.reduce((s, v) => s + v, 0);
                let compChange = compFirstTotal > 0 ? ((compSecondTotal - compFirstTotal) / compFirstTotal) * 100 : (compSecondTotal > 0 ? 100 : 0);
                if (!Number.isFinite(compChange)) compChange = 0;
                habitBarData.push({
                  habitId: COMPUTER_ACTIVITY_CARD_ID,
                  name: COMPUTER_HABIT_DISPLAY_NAME,
                  avg: compTotal,
                  unit: 'Hours',
                  change: compChange,
                  higherIsBetter: null,
                  daysWithData: compValues.length,
                  category: 'digital',
                });
              }
            }

            if (habitBarData.length === 0) return null;

            // ─── Habits bar list ───
            const maxVal = Math.max(...habitBarData.map((h: any) => Math.abs(h.avg)), 1);
            const habitBarItems: BarListItem[] = [...habitBarData]
              .sort((a: any, b: any) => b.avg - a.avg)
              .map((h: any) => ({
                name: h.name,
                value: formatBarValue(h.avg, h.unit),
                change: h.change,
                higherIsBetter: h.higherIsBetter,
                barPercent: Math.round((Math.abs(h.avg) / maxVal) * 100),
              }));

            // ─── Streaks bar list ───
            const streakItems = habitBarData
              .map((h: any) => {
                const logs = analyticsData[h.habitId] || [];
                let streak = 0;
                if (logs.length > 0) {
                  const sortedDates = logs
                    .map((l: any) => l.date)
                    .filter(Boolean)
                    .sort()
                    .reverse();
                  if (sortedDates.length > 0) {
                    streak = 1;
                    for (let i = 1; i < sortedDates.length; i++) {
                      const curr = parseISO(sortedDates[i - 1]);
                      const prev = parseISO(sortedDates[i]);
                      const diff = differenceInDays(curr, prev);
                      if (diff <= 1) streak++;
                      else break;
                    }
                  }
                }
                return { name: h.name, streak };
              })
              .sort((a: any, b: any) => b.streak - a.streak);
            const maxStreak = Math.max(...streakItems.map((s: any) => s.streak), 1);
            const streakBarItems: BarListItem[] = streakItems.map((s: any) => ({
              name: s.name,
              value: `${s.streak}d`,
              barPercent: Math.round((s.streak / maxStreak) * 100),
            }));

            return (
              <div className="mx-auto mt-6 w-full max-w-[920px]">
                {/* Horizontal bar list cards - 2 col */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-[5px]">
                  <VercelBarListCard
                    tabs={[
                      { id: 'habits', label: 'Habits' },
                      { id: 'streaks', label: 'Streaks' },
                    ]}
                    defaultTab="habits"
                    data={{
                      habits: habitBarItems,
                      streaks: streakBarItems,
                    }}
                    showRangeSelector
                    activeRange={barListRange}
                    onRangeChange={setBarListRange}
                  />
                  <ComputerTimeBarList activeRange={barListRange} onRangeChange={setBarListRange} />
                </div>

                {/* Habit chart cards — top 4 by data volume */}
                <div className="space-y-20 mt-24">
                  {filteredHabits
                    .filter((h: HabitData) => h.habit_id !== COMPUTER_ACTIVITY_CARD_ID)
                    .map((h: HabitData) => ({
                      habit: h,
                      dataLen: (analyticsData[h.habit_id] || []).length,
                    }))
                    .filter((h: any) => h.dataLen > 0)
                    .sort((a: any, b: any) => b.dataLen - a.dataLen)
                    .slice(0, 4)
                    .map(({ habit }: any) => {
                      const cardData = getHabitCardData(habit.habit_id);
                      return (
                        <HabitChartCard
                          key={habit.habit_id}
                          habitName={habit.habit_name}
                          unit={habit.unit_type || (habit as any).unit || ''}
                          logs={analyticsData[habit.habit_id] || []}
                          higherIsBetter={cardData?.higherIsBetter}
                          change={cardData?.change}
                        />
                      );
                    })
                  }
                </div>
              </div>
            );
          })()}

          {/* Expanded View */}
          {expandedHabit && (
            <div className="mx-auto mt-2 w-full max-w-[920px]">
              {expandedHabit === COMPUTER_ACTIVITY_CARD_ID ? (
                <ComputerActivitySection onClose={() => setExpandedHabit(null)} />
              ) : expandedHabitUsesGranularHeartRate ? (
                (() => {
                  if (loadingExpandedLogs) {
                    return (
                      <div className="flex h-[400px] items-center justify-center">
                        <div className="text-center">
                          <BrailleSpinner className="mx-auto mb-2 text-2xl text-gray-600" />
                          <p className="text-sm text-gray-500">Loading metrics...</p>
                        </div>
                      </div>
                    );
                  }

                  const expandedData = getHeartRateExpandedData();
                  if (!expandedData) return null;
                  const heartRateTitle = expandedHabitData?.habit_name || 'Heart Rate';

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
                  const deltaValueText = `${expandedData.absoluteChange >= 0 ? '+' : ''}${expandedData.absoluteChange.toFixed(1)}`;
                  const deltaPercentText = `${expandedData.change >= 0 ? '+' : ''}${expandedData.change.toFixed(2)}%`;
                  const primaryValue = lastPoint
                    ? Number(lastPoint.close).toFixed(0)
                    : '--';

                  const stats: Array<{ label: string; value: string }> = [
                    { label: 'Average', value: `${expandedData.average.toFixed(1)} bpm` },
                    { label: 'Min', value: `${expandedData.min.toFixed(0)} bpm` },
                    { label: 'Max', value: `${expandedData.max.toFixed(0)} bpm` },
                    { label: 'Samples', value: expandedData.totalSamples.toLocaleString() },
                    { label: 'Days', value: String(expandedData.daysWithData || 0) },
                  ];

                  return (
                    <div ref={exportCardRef}>
                      <ExpandedMetricCard
                        title={heartRateTitle}
                        primaryValue={primaryValue}
                        unit="bpm"
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
                            onClick={() => captureExpandedChart(heartRateTitle)}
                            disabled={isCapturing}
                            aria-label="Export chart image"
                            title="Export chart image"
                            className="inline-flex h-[30px] w-[30px] items-center justify-center border border-[rgba(39,37,30,0.07)] bg-white text-[rgba(39,37,30,0.65)] transition-colors hover:bg-[rgba(39,37,30,0.02)] hover:text-[#27251E] disabled:cursor-wait disabled:opacity-70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gray-400 focus-visible:ring-inset"
                          >
                            <Camera className="h-3.5 w-3.5" />
                          </button>
                        )}
                        onClose={() => setExpandedHabit(null)}
                      >
                        <div ref={chartRef}>
                          <PerplexityExpandedHabitChart
                            points={points}
                            range={expandedTimeRange}
                            unit="bpm"
                            chartType="bar"
                            showGrid
                            higherIsBetter={false}
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
                      higherIsBetter={expandedCardData?.higherIsBetter}
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
                          chartType="bar"
                          showGrid
                          higherIsBetter={expandedCardData?.higherIsBetter}
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
                className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-[rgba(39,37,30,0.12)] bg-white/80 text-[rgba(39,37,30,0.56)] transition-colors hover:text-[#27251E]"
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

    </>
  );
}
