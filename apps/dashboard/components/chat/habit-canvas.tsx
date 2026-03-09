'use client';

import React, { memo } from 'react';
import { X, AlertTriangle, Monitor, Clock, ExternalLink } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

// Types for trend data
interface TrendItem {
  habit_id: string;
  habit_name: string;
  unit: string;
  category?: string;
  window_days: number;
  current_avg: number;
  previous_avg: number;
  absolute_change: number;
  percent_change: number;
  days_with_data_current: number;
  days_with_data_previous: number;
  direction: 'up' | 'down' | 'flat';
  confidence: 'high' | 'medium' | 'low';
}

interface TrendsData {
  success: boolean;
  window_days: number;
  current_period: { start: string; end: string };
  previous_period: { start: string; end: string };
  trends: TrendItem[];
  summary: {
    total_habits: number;
    improving: number;
    declining: number;
    stable: number;
  };
  suggested_followups?: string[];
}

// Types for anomaly data
interface AnomalyItem {
  date: string;
  value: number;
  z_score: number;
  type: 'spike' | 'drop';
  entries_count?: number;
  deviation_from_avg: number;
}

interface AnomaliesData {
  success: boolean;
  habit: { id: string; name: string; unit: string };
  date_range: { start: string; end: string };
  days_analyzed: number;
  baseline_avg: number;
  baseline_std_dev: number;
  z_threshold: number;
  anomalies: AnomalyItem[];
  summary: {
    total_anomalies: number;
    spikes: number;
    drops: number;
  };
  suggested_followups?: string[];
}

// Types for screen recording search results
interface ScreenRecordingItem {
  timestamp: string;
  app: string;
  window: string;
  content_preview: string;
  relevance: string;
}

interface ScreenRecordingsDebug {
  enabled: boolean;
  mode_used: string;
  status: string;
  retrieval_tier?: string;
  warning?: string;
  source_counts?: {
    hybrid?: number;
    text?: number;
    activity?: number;
    unknown?: number;
  };
}

interface ScreenRecordingsData {
  success: boolean;
  query: string;
  days_searched: number;
  result_count: number;
  results: ScreenRecordingItem[];
  mode_used?: string;
  status?: string;
  warning?: string;
  debug?: ScreenRecordingsDebug;
}

interface ScreenTimeSpentCategoryItem {
  rank: number;
  category: string;
  estimated_minutes: number;
  estimated_hours: number;
  share_percent: number;
  hit_count: number;
  last_seen: string;
  sample_app?: string;
  sample_window?: string | null;
}

interface ScreenTimeSpentDailyItem {
  date: string;
  estimated_minutes: number;
  estimated_hours: number;
  hit_count: number;
}

interface ScreenTimeSpentMomentItem {
  timestamp: string;
  app: string;
  window: string;
  relevance: string;
  preview: string;
}

interface ScreenTimeSpentData {
  success: boolean;
  query: string;
  group_by: 'app' | 'window' | 'domain';
  days_searched: number;
  status?: string;
  mode_used?: string;
  retrieval_tier?: string;
  warning?: string;
  freshness?: {
    status?: 'healthy' | 'degraded_semantic' | 'degraded_ocr' | 'stale' | 'unavailable' | string;
    capture_lag_seconds?: number;
    ocr_lag_seconds?: number;
    embedding_lag_seconds?: number;
    source_mismatch?: boolean;
    source_mismatch_note?: string;
  };
  confidence?: {
    level?: 'high' | 'medium' | 'low' | string;
    score?: number;
    reason?: string;
  };
  provider_path?: {
    retrieval?: string;
    rerank?: string;
    answer?: string;
  };
  result_count: number;
  summary?: {
    estimated_total_minutes?: number;
    estimated_total_hours?: number;
    total_hits?: number;
    unique_apps?: number;
    days_with_activity?: number;
    range_start?: string;
    range_end?: string;
    metric_source?: 'matched_estimate' | 'watcher_aggregate';
    metric_label?: string;
    matched_total_minutes?: number;
    matched_total_hours?: number;
    matched_hits?: number;
    matched_days_with_activity?: number;
  };
  top_categories?: ScreenTimeSpentCategoryItem[];
  daily_breakdown?: ScreenTimeSpentDailyItem[];
  sample_moments?: ScreenTimeSpentMomentItem[];
  estimation?: {
    method?: string;
    default_chunk_seconds?: number;
    max_gap_minutes?: number;
    note?: string;
  };
  debug?: ScreenRecordingsDebug;
}

interface WeeklyOverviewHabitDailyRow {
  date: string;
  value: number;
  unit?: string;
  total_hours?: number | null;
  total_duration_seconds?: number | null;
  total_amount?: number | null;
  sleep_start?: string;
  sleep_end?: string;
  entries?: Array<{
    time?: string;
    amount?: number;
    duration_seconds?: number;
    notes?: string;
    sleep_start?: string;
    sleep_end?: string;
  }>;
}

interface WeeklyOverviewHabit {
  id: string;
  name: string;
  category?: string;
  unit?: string;
  total: number;
  average: number;
  min: number;
  max: number;
  days_with_data: number;
  total_entries: number;
  daily: WeeklyOverviewHabitDailyRow[];
}

interface WeeklyOverviewComputerActivity {
  days_with_data: number;
  total_hours: number;
  average_daily_hours: number;
  min_daily_hours: number;
  max_daily_hours: number;
  daily: Array<{
    day: string;
    active_hours: number;
    events_count: number;
    apps_count: number;
  }>;
  top_apps: Array<{
    app_name?: string;
    total_active_ms?: number;
    total_events?: number;
    days_used?: number;
    hours?: number;
  }>;
  top_domains: Array<{
    domain?: string;
    total_active_ms?: number;
    total_events?: number;
    days_used?: number;
    hours?: number;
    minutes?: number;
  }>;
}

interface WeeklyOverviewData {
  success: boolean;
  date_range: {
    start: string;
    end: string;
    days: number;
  };
  summary: {
    habits_with_data: number;
    total_habits_tracked: number;
  };
  habits: WeeklyOverviewHabit[];
  computer_activity?: WeeklyOverviewComputerActivity;
  suggested_followups?: string[];
}

export interface HabitCanvasData {
  type: 'trends' | 'stats' | 'breakdown' | 'anomalies' | 'screenRecordings' | 'weeklyOverview' | 'screenTimeSpent';
  title: string;
  habitName?: string;
  dateRange?: { start: string; end: string };
  dailyData?: Array<{
    date: string;
    hours?: number;
    amount?: number;
    value?: number;
    entries?: Array<{
      time?: string;
      amount?: number;
      duration_seconds?: number;
      notes?: string;
      sleep_start?: string;
      sleep_end?: string;
    }>;
  }>;
  stats?: {
    totalHours?: number;
    totalAmount?: number;
    daysTracked: number;
    avgPerDay?: number;
    minValue?: number;
    maxValue?: number;
    unit?: string;
  };
  insights?: string[];
  trends?: TrendsData;
  anomalies?: AnomaliesData;
  screenRecordings?: ScreenRecordingsData;
  screenTimeSpent?: ScreenTimeSpentData;
  weeklyOverview?: WeeklyOverviewData;
}

interface HabitCanvasProps {
  data: HabitCanvasData | null;
  onClose: () => void;
  onFollowUp?: (question: string) => void;
}

function formatDate(dateStr: string): string {
  try {
    const ymdMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
    const date = ymdMatch
      ? new Date(Number(ymdMatch[1]), Number(ymdMatch[2]) - 1, Number(ymdMatch[3]))
      : new Date(dateStr);
    if (isNaN(date.getTime())) {
      return dateStr;
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

function formatDateRange(start: string, end: string): string {
  return `${formatDate(start)} - ${formatDate(end)}`;
}

function formatUnit(unit?: string, isHours?: boolean): string {
  if (isHours) return 'h';
  if (!unit) return '';
  
  const unitMap: Record<string, string> = {
    'hours': 'h', 'hour': 'h', 'h': 'h',
    'minutes': 'm', 'minute': 'm', 'min': 'm', 'm': 'm',
    'milligrams': 'mg', 'milligram': 'mg', 'mg': 'mg',
    'grams': 'g', 'gram': 'g', 'g': 'g',
    'calories': ' cal', 'cal': ' cal',
    'steps': ' steps', 'miles': ' mi', 'mi': ' mi',
    'kilometers': ' km', 'km': ' km',
    'count': '', 'reps': ' reps', 'sets': ' sets',
    'oz': ' oz', 'ounces': ' oz',
    'glasses': ' glasses', 'cups': ' cups',
    'liters': 'L', 'l': 'L', 'ml': 'ml', 'milliliters': 'ml',
    'sessions': '', 'pages': ' pages',
  };
  
  const normalized = unit.toLowerCase().trim();
  return unitMap[normalized] ?? ` ${unit}`;
}

function formatValueWithUnit(value: number | undefined, unit?: string, isHours?: boolean): string {
  if (value === undefined) return '';
  const formattedValue = Number.isInteger(value) ? value.toString() : value.toFixed(1);
  return `${formattedValue}${formatUnit(unit, isHours)}`;
}

// ====================
// MIDDAY-STYLE TRENDS SECTION
// ====================
const TrendsSection = memo(function TrendsSection({ trends }: { trends: TrendsData }) {
  const improvers = trends.trends.filter(t => t.direction === 'up');
  const decliners = trends.trends.filter(t => t.direction === 'down');
  const stable = trends.trends.filter(t => t.direction === 'flat');
  
  const sortedImprovers = [...improvers].sort((a, b) => b.percent_change - a.percent_change);
  const sortedDecliners = [...decliners].sort((a, b) => a.percent_change - b.percent_change);
  
  const topImprover = sortedImprovers[0];
  
  return (
    <div className="space-y-8">
      {/* Improvers Table - Midday style with borders */}
      {sortedImprovers.length > 0 && (
        <div>
          <h4 className="text-[18px] font-normal text-black mb-4">
            Top improvements
          </h4>

          <div className="border border-[#e6e6e6] overflow-hidden">
            <table className="w-full table-fixed">
              <colgroup>
                <col className="w-[30%]" />
                <col className="w-[18%]" />
                <col className="w-[36%]" />
                <col className="w-[16%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-[#e6e6e6]">
                  <th className="px-2 py-2 text-left text-[11px] text-[#707070] font-normal border-r border-[#e6e6e6]">Habit</th>
                  <th className="px-2 py-2 text-center text-[11px] text-[#707070] font-normal border-r border-[#e6e6e6]">Conf.</th>
                  <th className="px-2 py-2 text-right text-[11px] text-[#707070] font-normal border-r border-[#e6e6e6]">Average</th>
                  <th className="px-2 py-2 text-right text-[11px] text-[#707070] font-normal">Change</th>
                </tr>
              </thead>
              <tbody>
                {sortedImprovers.slice(0, 5).map((trend, index) => (
                  <tr
                    key={trend.habit_id}
                    className={cn(
                      "hover:bg-[#F2F1EF] transition-colors",
                      index !== sortedImprovers.slice(0, 5).length - 1 && "border-b border-[#e6e6e6]"
                    )}
                  >
                    <td className="px-2 py-2 text-[11px] text-black border-r border-[#e6e6e6] truncate" title={trend.habit_name}>{trend.habit_name}</td>
                    <td className="px-2 py-2 text-center text-[10px] uppercase text-[#707070] border-r border-[#e6e6e6] whitespace-nowrap">
                      {trend.confidence}
                    </td>
                    <td className="px-2 py-2 text-right text-[11px] text-[#707070] tabular-nums border-r border-[#e6e6e6] whitespace-nowrap">
                      {trend.previous_avg.toFixed(1)} → {trend.current_avg.toFixed(1)}
                    </td>
                    <td className="px-2 py-2 text-right text-[11px] text-[#16a34a] tabular-nums whitespace-nowrap">
                      +{trend.percent_change.toFixed(0)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Decliners Table - Midday style with borders */}
      {sortedDecliners.length > 0 && (
        <div>
          <h4 className="text-[18px] font-normal text-black mb-4">
            Top decliners
          </h4>

          <div className="border border-[#e6e6e6] overflow-hidden">
            <table className="w-full table-fixed">
              <colgroup>
                <col className="w-[30%]" />
                <col className="w-[18%]" />
                <col className="w-[36%]" />
                <col className="w-[16%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-[#e6e6e6]">
                  <th className="px-2 py-2 text-left text-[11px] text-[#707070] font-normal border-r border-[#e6e6e6]">Habit</th>
                  <th className="px-2 py-2 text-center text-[11px] text-[#707070] font-normal border-r border-[#e6e6e6]">Conf.</th>
                  <th className="px-2 py-2 text-right text-[11px] text-[#707070] font-normal border-r border-[#e6e6e6]">Average</th>
                  <th className="px-2 py-2 text-right text-[11px] text-[#707070] font-normal">Change</th>
                </tr>
              </thead>
              <tbody>
                {sortedDecliners.slice(0, 5).map((trend, index) => (
                  <tr
                    key={trend.habit_id}
                    className={cn(
                      "hover:bg-[#F2F1EF] transition-colors",
                      index !== sortedDecliners.slice(0, 5).length - 1 && "border-b border-[#e6e6e6]"
                    )}
                  >
                    <td className="px-2 py-2 text-[11px] text-black border-r border-[#e6e6e6] truncate" title={trend.habit_name}>{trend.habit_name}</td>
                    <td className="px-2 py-2 text-center text-[10px] uppercase text-[#707070] border-r border-[#e6e6e6] whitespace-nowrap">
                      {trend.confidence}
                    </td>
                    <td className="px-2 py-2 text-right text-[11px] text-[#707070] tabular-nums border-r border-[#e6e6e6] whitespace-nowrap">
                      {trend.previous_avg.toFixed(1)} → {trend.current_avg.toFixed(1)}
                    </td>
                    <td className="px-2 py-2 text-right text-[11px] text-[#dc2626] tabular-nums whitespace-nowrap">
                      {trend.percent_change.toFixed(0)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Summary Cards - Exact Midday style */}
      <div className="grid grid-cols-2 gap-3">
        <div className="border border-[#e6e6e6] p-3 bg-white">
          <div className="text-[12px] text-[#707070] mb-1">
            Habits tracked
          </div>
          <div className="text-[18px] font-normal text-black mb-1">
            {trends.summary.total_habits}
          </div>
          <div className="text-[10px] text-[#707070]">
            {trends.summary.improving} improving, {trends.summary.declining} declining
          </div>
        </div>

        {topImprover && (
          <div className="border border-[#e6e6e6] p-3 bg-white">
            <div className="text-[12px] text-[#707070] mb-1">
              Biggest improvement
            </div>
            <div className="text-[18px] font-normal text-black mb-1">
              {topImprover.habit_name}
            </div>
            <div className="text-[10px] text-[#16a34a]">
              +{topImprover.percent_change.toFixed(0)}% increase
            </div>
          </div>
        )}
      </div>

      {/* Stable habits */}
      {stable.length > 0 && (
        <div className="mt-4">
          <h4 className="text-[12px] leading-normal mb-2 text-[#707070]">
            Stable habits ({stable.length})
          </h4>
          <div className="text-[12px] leading-[17px] text-black">
            {stable.map(t => t.habit_name).join(', ')}
          </div>
        </div>
      )}
    </div>
  );
});

// ====================
// MIDDAY-STYLE ANOMALIES SECTION
// ====================
const AnomaliesSection = memo(function AnomaliesSection({ anomalies }: { anomalies: AnomaliesData }) {
  return (
    <div className="space-y-6">
      {/* Anomalies Table - Midday style with borders */}
      {anomalies.anomalies.length > 0 ? (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-[18px] font-normal text-black">
              Unusual days
            </h4>
            <span className="text-[12px] text-[#707070]">
              {anomalies.summary.spikes} spikes, {anomalies.summary.drops} drops
            </span>
          </div>

          <div className="border border-[#e6e6e6]">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#e6e6e6]">
                  <th className="px-3 py-2 text-left text-[12px] text-[#707070] font-normal border-r border-[#e6e6e6]">Date</th>
                  <th className="px-3 py-2 text-right text-[12px] text-[#707070] font-normal border-r border-[#e6e6e6]">Value</th>
                  <th className="px-3 py-2 text-right text-[12px] text-[#707070] font-normal border-r border-[#e6e6e6]">Type</th>
                  <th className="px-3 py-2 text-right text-[12px] text-[#707070] font-normal">Deviation</th>
                </tr>
              </thead>
              <tbody>
                {anomalies.anomalies.map((anomaly, index) => (
                  <tr
                    key={index}
                    className={cn(
                      "hover:bg-[#F2F1EF] transition-colors",
                      index !== anomalies.anomalies.length - 1 && "border-b border-[#e6e6e6]"
                    )}
                  >
                    <td className="px-3 py-2 text-[12px] text-black border-r border-[#e6e6e6] whitespace-nowrap">{formatDate(anomaly.date)}</td>
                    <td className="px-3 py-2 text-right text-[12px] text-black tabular-nums border-r border-[#e6e6e6] whitespace-nowrap">
                      {anomaly.value.toFixed(1)}{formatUnit(anomalies.habit.unit)}
                    </td>
                    <td className="px-3 py-2 text-right border-r border-[#e6e6e6] whitespace-nowrap">
                      <span className={cn(
                        "text-[10px] uppercase",
                        anomaly.type === 'spike' ? 'text-[#dc2626]' : 'text-[#2563eb]'
                      )}>
                        {anomaly.type}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right text-[12px] text-[#707070] tabular-nums whitespace-nowrap">
                      {anomaly.z_score > 0 ? '+' : ''}{anomaly.z_score.toFixed(1)}σ
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="text-center py-8 text-[12px] text-[#707070]">
          <AlertTriangle className="w-5 h-5 mx-auto mb-2 opacity-40" />
          No anomalies detected in this period
        </div>
      )}

      {/* Summary Cards - Midday style */}
      <div className="grid grid-cols-2 gap-3">
        <div className="border border-[#e6e6e6] p-3 bg-white">
          <div className="text-[12px] text-[#707070] mb-1">
            Baseline average
          </div>
          <div className="text-[18px] font-normal text-black mb-1">
            {anomalies.baseline_avg.toFixed(1)}{formatUnit(anomalies.habit.unit)}
          </div>
          <div className="text-[10px] text-[#707070]">
            Across {anomalies.days_analyzed} days analyzed
          </div>
        </div>

        <div className="border border-[#e6e6e6] p-3 bg-white">
          <div className="text-[12px] text-[#707070] mb-1">
            Standard deviation
          </div>
          <div className="text-[18px] font-normal text-black mb-1">
            ±{anomalies.baseline_std_dev.toFixed(2)}
          </div>
          <div className="text-[10px] text-[#707070]">
            Normal variation range
          </div>
        </div>
      </div>
    </div>
  );
});

// ====================
// SCREEN RECORDINGS SECTION
// ====================
const ScreenRecordingsSection = memo(function ScreenRecordingsSection({ 
  screenRecordings 
}: { 
  screenRecordings: ScreenRecordingsData 
}) {
  // Format timestamp to readable time
  const formatTime = (timestamp: string) => {
    try {
      const date = new Date(timestamp);
      return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
    } catch {
      return timestamp;
    }
  };

  // Group results by app
  const groupedByApp = screenRecordings.results.reduce((acc, item) => {
    const app = item.app || 'Unknown';
    if (!acc[app]) {
      acc[app] = [];
    }
    acc[app].push(item);
    return acc;
  }, {} as Record<string, ScreenRecordingItem[]>);

  const appCount = Object.keys(groupedByApp).length;
  const debug = screenRecordings.debug;

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3">
        <div className="border border-[#e6e6e6] p-3 bg-white">
          <div className="text-[12px] text-[#707070] mb-1">Results found</div>
          <div className="text-[18px] font-normal text-black mb-1">
            {screenRecordings.result_count}
          </div>
          <div className="text-[10px] text-[#707070]">
            In the last {screenRecordings.days_searched} days
          </div>
        </div>
        <div className="border border-[#e6e6e6] p-3 bg-white">
          <div className="text-[12px] text-[#707070] mb-1">Apps involved</div>
          <div className="text-[18px] font-normal text-black mb-1">
            {appCount}
          </div>
          <div className="text-[10px] text-[#707070]">
            Unique applications
          </div>
        </div>
      </div>

      {/* Debug/QA metadata (enabled only when backend debug flag is on) */}
      {debug?.enabled && (
        <div className="border border-[#e6e6e6] p-3 bg-[#f9fafb]">
          <div className="text-[11px] text-[#707070] mb-1 uppercase tracking-wide">QA debug</div>
          <div className="flex flex-wrap gap-2 text-[11px] text-black">
            <span className="px-1.5 py-0.5 rounded bg-white border border-[#e6e6e6]">
              mode: {debug.mode_used}
            </span>
            <span className="px-1.5 py-0.5 rounded bg-white border border-[#e6e6e6]">
              status: {debug.status}
            </span>
            {debug.retrieval_tier && (
              <span className="px-1.5 py-0.5 rounded bg-white border border-[#e6e6e6]">
                tier: {debug.retrieval_tier}
              </span>
            )}
            {debug.source_counts && (
              <span className="px-1.5 py-0.5 rounded bg-white border border-[#e6e6e6]">
                sources h:{debug.source_counts.hybrid || 0} t:{debug.source_counts.text || 0} a:{debug.source_counts.activity || 0}
              </span>
            )}
          </div>
          {debug.warning && (
            <div className="text-[10px] text-amber-700 mt-2">
              {debug.warning}
            </div>
          )}
        </div>
      )}

      {/* Results Table */}
      {screenRecordings.results.length > 0 ? (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-[18px] font-normal text-black">
              Screen activity
            </h4>
            <span className="text-[12px] text-[#707070]">
              Sorted by relevance
            </span>
          </div>

          <div className="border border-[#e6e6e6] max-h-[400px] overflow-y-auto">
            <table className="w-full">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-[#e6e6e6]">
                  <th className="px-3 py-2 text-left text-[12px] text-[#707070] font-normal border-r border-[#e6e6e6]">Time</th>
                  <th className="px-3 py-2 text-left text-[12px] text-[#707070] font-normal border-r border-[#e6e6e6]">App</th>
                  <th className="px-3 py-2 text-left text-[12px] text-[#707070] font-normal border-r border-[#e6e6e6]">Content</th>
                  <th className="px-3 py-2 text-right text-[12px] text-[#707070] font-normal w-[60px]">Match</th>
                </tr>
              </thead>
              <tbody>
                {screenRecordings.results.map((item, index) => (
                  <tr
                    key={index}
                    className={cn(
                      "hover:bg-[#F2F1EF] transition-colors",
                      index !== screenRecordings.results.length - 1 && "border-b border-[#e6e6e6]"
                    )}
                  >
                    <td className="px-3 py-2 text-[11px] text-black border-r border-[#e6e6e6] whitespace-nowrap">
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3 text-[#707070]" />
                        {formatTime(item.timestamp)}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-[11px] text-black border-r border-[#e6e6e6]">
                      <div className="flex items-center gap-1">
                        <Monitor className="w-3 h-3 text-[#707070]" />
                        <span className="truncate max-w-[100px]" title={item.app}>{item.app}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-[11px] text-[#707070] border-r border-[#e6e6e6]">
                      <div className="max-w-[200px]">
                        <div className="font-medium text-black truncate" title={item.window}>
                          {item.window}
                        </div>
                        {item.content_preview && (
                          <div className="text-[10px] text-[#999] line-clamp-2 mt-0.5">
                            {item.content_preview.substring(0, 100)}...
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right text-[11px] tabular-nums whitespace-nowrap">
                      <span className={cn(
                        "px-1.5 py-0.5 rounded text-[10px]",
                        parseInt(item.relevance) >= 70 ? "bg-green-100 text-green-700" :
                        parseInt(item.relevance) >= 50 ? "bg-yellow-100 text-yellow-700" :
                        "bg-gray-100 text-gray-600"
                      )}>
                        {item.relevance}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="text-center py-8 text-[12px] text-[#707070]">
          <Monitor className="w-5 h-5 mx-auto mb-2 opacity-40" />
          No matching screen recordings found
        </div>
      )}

      {/* Apps breakdown */}
      {appCount > 0 && (
        <div>
          <h4 className="text-[12px] leading-normal mb-2 text-[#707070]">
            Apps found ({appCount})
          </h4>
          <div className="flex flex-wrap gap-2">
            {Object.entries(groupedByApp).map(([app, items]) => (
              <span 
                key={app}
                className="px-2 py-1 bg-gray-100 rounded text-[11px] text-gray-700"
              >
                {app} ({items.length})
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

const ScreenTimeSpentSection = memo(function ScreenTimeSpentSection({
  screenTimeSpent,
}: {
  screenTimeSpent: ScreenTimeSpentData;
}) {
  const summary = screenTimeSpent.summary || {};
  const topCategories = screenTimeSpent.top_categories || [];
  const dailyBreakdown = screenTimeSpent.daily_breakdown || [];
  const sampleMoments = screenTimeSpent.sample_moments || [];
  const isActivityOnlyMode =
    screenTimeSpent.retrieval_tier === 'activity_only'
    || screenTimeSpent.mode_used === 'activity'
    || summary.metric_source === 'watcher_aggregate';

  const rangeLabel =
    summary.range_start && summary.range_end
      ? `${formatDate(summary.range_start)} - ${formatDate(summary.range_end)}`
      : `Last ${screenTimeSpent.days_searched} days`;

  const totalHours = summary.estimated_total_hours || 0;
  const totalHits = isActivityOnlyMode
    ? (summary.total_hits ?? screenTimeSpent.result_count ?? 0)
    : (summary.matched_hits ?? summary.total_hits ?? screenTimeSpent.result_count ?? 0);
  const uniqueApps = summary.unique_apps || 0;
  const daysWithActivity = summary.days_with_activity || 0;
  const matchedDaysWithActivity = isActivityOnlyMode
    ? daysWithActivity
    : (summary.matched_days_with_activity ?? daysWithActivity);
  const metricLabel = summary.metric_label || 'Estimated matched time';
  const isWatcherAggregate = summary.metric_source === 'watcher_aggregate';

  const formatHours = (value?: number) => {
    const numeric = Number(value || 0);
    return `${numeric.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')}h`;
  };

  const groupLabel = screenTimeSpent.group_by === 'domain'
    ? 'Top domains'
    : screenTimeSpent.group_by === 'window'
      ? 'Top windows'
      : 'Top apps';
  const uniqueBucketLabel = screenTimeSpent.group_by === 'domain'
    ? 'Unique domains'
    : screenTimeSpent.group_by === 'window'
      ? 'Unique windows'
      : 'Unique apps';
  const dailyTimeLabel = isWatcherAggregate ? 'Active Time' : 'Estimated Time';

  const debug = screenTimeSpent.debug;
  const freshness = screenTimeSpent.freshness;
  const confidence = screenTimeSpent.confidence;
  const providerPath = screenTimeSpent.provider_path;

  return (
    <div className="space-y-6">
      <div className="text-[12px] text-[#707070]">
        Query: <span className="text-black">{screenTimeSpent.query}</span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="border border-[#e6e6e6] p-3 bg-white">
          <div className="text-[12px] text-[#707070] mb-1">{metricLabel}</div>
          <div className="text-[18px] font-normal text-black mb-1">
            {formatHours(totalHours)}
          </div>
          <div className="text-[10px] text-[#707070]">{rangeLabel}</div>
        </div>
        <div className="border border-[#e6e6e6] p-3 bg-white">
          <div className="text-[12px] text-[#707070] mb-1">{isActivityOnlyMode ? 'Activity events' : 'Matched moments'}</div>
          <div className="text-[18px] font-normal text-black mb-1">{totalHits}</div>
          <div className="text-[10px] text-[#707070]">
            {matchedDaysWithActivity} active day{matchedDaysWithActivity === 1 ? '' : 's'}
          </div>
        </div>
        <div className="border border-[#e6e6e6] p-3 bg-white">
          <div className="text-[12px] text-[#707070] mb-1">{uniqueBucketLabel}</div>
          <div className="text-[18px] font-normal text-black mb-1">{uniqueApps}</div>
          <div className="text-[10px] text-[#707070]">
            {isWatcherAggregate ? 'Across active-time records' : 'Across matching moments'}
          </div>
        </div>
        <div className="border border-[#e6e6e6] p-3 bg-white">
          <div className="text-[12px] text-[#707070] mb-1">Grouping</div>
          <div className="text-[18px] font-normal text-black mb-1 capitalize">
            {screenTimeSpent.group_by}
          </div>
          <div className="text-[10px] text-[#707070]">
            Search mode: {screenTimeSpent.mode_used || 'unknown'} · Tier: {screenTimeSpent.retrieval_tier || debug?.retrieval_tier || 'unknown'}
          </div>
          {providerPath && (
            <div className="text-[10px] text-[#707070] mt-1">
              Providers: {providerPath.retrieval || 'n/a'} / {providerPath.rerank || 'n/a'} / {providerPath.answer || 'n/a'}
            </div>
          )}
        </div>
      </div>

      {screenTimeSpent.warning && (
        <div className="border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          {screenTimeSpent.warning}
        </div>
      )}

      {!isActivityOnlyMode && (freshness?.status || confidence?.level) && (
        <div className={cn("gap-3", !isActivityOnlyMode ? "grid grid-cols-2" : "grid grid-cols-1")}>
          <div className="border border-[#e6e6e6] p-3 bg-white">
            <div className="text-[12px] text-[#707070] mb-1">Freshness</div>
            <div className="text-[18px] font-normal text-black mb-1 capitalize">
              {freshness?.status || 'unknown'}
            </div>
            <div className="text-[10px] text-[#707070]">
              OCR lag: {Number(freshness?.ocr_lag_seconds || 0)}s
            </div>
          </div>
          {!isActivityOnlyMode && (
            <div className="border border-[#e6e6e6] p-3 bg-white">
              <div className="text-[12px] text-[#707070] mb-1">Semantic confidence</div>
              <div className="text-[18px] font-normal text-black mb-1 capitalize">
                {confidence?.level || 'unknown'}
              </div>
              <div className="text-[10px] text-[#707070]">
                Score: {Number.isFinite(Number(confidence?.score)) ? `${Math.round(Number(confidence?.score) * 100)}%` : 'n/a'}
              </div>
            </div>
          )}
        </div>
      )}

      {debug?.enabled && (
        <div className="border border-[#e6e6e6] p-3 bg-[#f9fafb]">
          <div className="text-[11px] text-[#707070] mb-1 uppercase tracking-wide">QA debug</div>
          <div className="flex flex-wrap gap-2 text-[11px] text-black">
            <span className="px-1.5 py-0.5 rounded bg-white border border-[#e6e6e6]">
              mode: {debug.mode_used}
            </span>
            <span className="px-1.5 py-0.5 rounded bg-white border border-[#e6e6e6]">
              status: {debug.status}
            </span>
            {debug.retrieval_tier && (
              <span className="px-1.5 py-0.5 rounded bg-white border border-[#e6e6e6]">
                tier: {debug.retrieval_tier}
              </span>
            )}
            {debug.source_counts && (
              <span className="px-1.5 py-0.5 rounded bg-white border border-[#e6e6e6]">
                sources h:{debug.source_counts.hybrid || 0} t:{debug.source_counts.text || 0} a:{debug.source_counts.activity || 0}
              </span>
            )}
          </div>
          {debug.warning && (
            <div className="text-[10px] text-amber-700 mt-2">
              {debug.warning}
            </div>
          )}
        </div>
      )}

      <div className="space-y-2">
        <h4 className="text-[18px] font-normal text-black">{groupLabel}</h4>
        <div className="border border-[#e6e6e6] max-h-[280px] overflow-y-auto">
          <table className="w-full">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-[#e6e6e6]">
                <th className="px-2 py-1.5 text-left text-[11px] text-[#707070] font-normal border-r border-[#e6e6e6] w-[42px]">#</th>
                <th className="px-3 py-1.5 text-left text-[11px] text-[#707070] font-normal border-r border-[#e6e6e6]">Bucket</th>
                <th className="px-3 py-1.5 text-right text-[11px] text-[#707070] font-normal border-r border-[#e6e6e6]">Time</th>
                <th className="px-3 py-1.5 text-right text-[11px] text-[#707070] font-normal border-r border-[#e6e6e6]">Share</th>
                <th className="px-3 py-1.5 text-right text-[11px] text-[#707070] font-normal">Hits</th>
              </tr>
            </thead>
            <tbody>
              {topCategories.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-5 text-center text-[12px] text-[#707070]">
                    No grouped results available.
                  </td>
                </tr>
              ) : (
                topCategories.map((row, idx) => (
                  <tr key={`${row.category}-${idx}`} className="border-b border-[#e6e6e6] last:border-b-0 hover:bg-[#F2F1EF] transition-colors">
                    <td className="px-2 py-1.5 text-[12px] text-[#707070] border-r border-[#e6e6e6]">{row.rank || idx + 1}</td>
                    <td className="px-3 py-1.5 text-[12px] text-black border-r border-[#e6e6e6]">
                      <div className="truncate" title={row.category}>{row.category}</div>
                      <div className="text-[10px] text-[#707070] truncate" title={row.last_seen}>
                        Last seen: {row.last_seen}
                      </div>
                    </td>
                    <td className="px-3 py-1.5 text-[12px] text-black text-right tabular-nums border-r border-[#e6e6e6]">{formatHours(row.estimated_hours)}</td>
                    <td className="px-3 py-1.5 text-[12px] text-[#707070] text-right tabular-nums border-r border-[#e6e6e6]">{row.share_percent.toFixed(1)}%</td>
                    <td className="px-3 py-1.5 text-[12px] text-[#707070] text-right tabular-nums">{row.hit_count}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="text-[18px] font-normal text-black">Daily breakdown</h4>
        <div className="border border-[#e6e6e6] max-h-[220px] overflow-y-auto">
          <table className="w-full">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-[#e6e6e6]">
                <th className="px-3 py-1.5 text-left text-[11px] text-[#707070] font-normal border-r border-[#e6e6e6]">Date</th>
                <th className="px-3 py-1.5 text-right text-[11px] text-[#707070] font-normal border-r border-[#e6e6e6]">{dailyTimeLabel}</th>
                <th className="px-3 py-1.5 text-right text-[11px] text-[#707070] font-normal">Hits</th>
              </tr>
            </thead>
            <tbody>
              {dailyBreakdown.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-3 py-5 text-center text-[12px] text-[#707070]">
                    No day-level rows found.
                  </td>
                </tr>
              ) : (
                dailyBreakdown.map((row) => (
                  <tr key={row.date} className="border-b border-[#e6e6e6] last:border-b-0 hover:bg-[#F2F1EF] transition-colors">
                    <td className="px-3 py-1.5 text-[12px] text-black border-r border-[#e6e6e6]">{formatDate(row.date)}</td>
                    <td className="px-3 py-1.5 text-[12px] text-black text-right tabular-nums border-r border-[#e6e6e6]">{formatHours(row.estimated_hours)}</td>
                    <td className="px-3 py-1.5 text-[12px] text-[#707070] text-right tabular-nums">{row.hit_count}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {sampleMoments.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-[12px] leading-normal text-[#707070]">Sample moments</h4>
          <div className="space-y-2">
            {sampleMoments.slice(0, 5).map((moment, index) => (
              <div key={`${moment.timestamp}-${index}`} className="border border-[#e6e6e6] p-2 bg-white">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[11px] text-black truncate">{moment.app}</div>
                  <div className="text-[10px] text-[#707070] whitespace-nowrap">{moment.relevance}</div>
                </div>
                <div className="text-[10px] text-[#707070] truncate mt-0.5">{moment.timestamp}</div>
                <div className="text-[11px] text-[#707070] truncate mt-1">{moment.window}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {screenTimeSpent.estimation?.note && (
        <div className="text-[10px] text-[#707070]">
          {screenTimeSpent.estimation.note}
        </div>
      )}
    </div>
  );
});

const WeeklyOverviewSection = memo(function WeeklyOverviewSection({
  weeklyOverview,
}: {
  weeklyOverview: WeeklyOverviewData;
}) {
  const habits = [...(weeklyOverview.habits || [])].sort((a, b) => a.name.localeCompare(b.name));
  const computer = weeklyOverview.computer_activity;

  const formatNumber = (value: number) => {
    if (!Number.isFinite(value)) return '0';
    return value.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
  };

  const formatMetric = (value: number, unit?: string) => {
    const normalized = (unit || '').toLowerCase().trim();
    if (normalized === 'hours' || normalized === 'hour' || normalized === 'h') {
      return `${formatNumber(value)}h`;
    }
    if (normalized === 'minutes' || normalized === 'minute' || normalized === 'min' || normalized === 'm') {
      return `${formatNumber(value)}m`;
    }
    if (normalized === 'milligrams' || normalized === 'milligram' || normalized === 'mg') {
      return `${formatNumber(value)}mg`;
    }
    if (normalized === 'grams' || normalized === 'gram' || normalized === 'g') {
      return `${formatNumber(value)}g`;
    }
    return `${formatNumber(value)}${formatUnit(unit)}`;
  };

  const MetricStrip = ({
    items,
    columnsClassName = 'grid-cols-4',
  }: {
    items: Array<{ label: string; value: string | number }>;
    columnsClassName?: string;
  }) => (
    <div className={cn('grid border border-[#e6e6e6] bg-white', columnsClassName)}>
      {items.map((item, index) => (
        <div
          key={`${item.label}-${index}`}
          className={cn(
            'px-3 py-2',
            index !== items.length - 1 && 'border-r border-[#e6e6e6]',
          )}
        >
          <div className="text-[11px] text-[#707070] leading-tight mb-0.5">{item.label}</div>
          <div className="text-[16px] leading-[1.2] font-normal text-black whitespace-nowrap">{item.value}</div>
        </div>
      ))}
    </div>
  );

  const formatEvents = (value?: number) => (value || 0).toLocaleString();

  const renderDailyValueTable = (
    rows: Array<{ date: string; value: string; entries: number; sleep?: string; wake?: string }>,
    emptyText: string,
    options?: { showSleepWake?: boolean; valueLabel?: string },
  ) => (
    <div className="border border-[#e6e6e6] max-h-[220px] overflow-y-auto">
      <table className="w-full">
        <thead className="sticky top-0 bg-white">
          <tr className="border-b border-[#e6e6e6]">
            <th className="px-3 py-1.5 text-left text-[11px] text-[#707070] font-normal border-r border-[#e6e6e6]">Date</th>
            {options?.showSleepWake ? (
              <>
                <th className="px-3 py-1.5 text-left text-[11px] text-[#707070] font-normal border-r border-[#e6e6e6]">Sleep</th>
                <th className="px-3 py-1.5 text-left text-[11px] text-[#707070] font-normal border-r border-[#e6e6e6]">Wake</th>
              </>
            ) : null}
            <th className="px-3 py-1.5 text-right text-[11px] text-[#707070] font-normal border-r border-[#e6e6e6]">
              {options?.valueLabel || 'Value'}
            </th>
            <th className="px-3 py-1.5 text-right text-[11px] text-[#707070] font-normal">Entries</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={options?.showSleepWake ? 5 : 3} className="px-3 py-5 text-center text-[12px] text-[#707070]">
                {emptyText}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.date} className="border-b border-[#e6e6e6] last:border-b-0 hover:bg-[#F2F1EF] transition-colors">
                <td className="px-3 py-1.5 text-[12px] text-black border-r border-[#e6e6e6]">{formatDate(row.date)}</td>
                {options?.showSleepWake ? (
                  <>
                    <td className="px-3 py-1.5 text-[12px] text-[#707070] border-r border-[#e6e6e6] whitespace-nowrap">{row.sleep || '—'}</td>
                    <td className="px-3 py-1.5 text-[12px] text-[#707070] border-r border-[#e6e6e6] whitespace-nowrap">{row.wake || '—'}</td>
                  </>
                ) : null}
                <td className="px-3 py-1.5 text-[12px] text-black text-right tabular-nums border-r border-[#e6e6e6]">{row.value}</td>
                <td className="px-3 py-1.5 text-[12px] text-[#707070] text-right tabular-nums">{row.entries}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );

  const renderRankedUsageTable = (
    title: string,
    emptyText: string,
    rows: Array<{ name: string; hours: number; events: number }>,
    nameHeader: string,
  ) => (
    <div className="space-y-2">
      <div className="text-[12px] text-[#707070]">{title}</div>
      <div className="border border-[#e6e6e6] max-h-[240px] overflow-y-auto">
        <table className="w-full">
          <thead className="sticky top-0 bg-white">
            <tr className="border-b border-[#e6e6e6]">
              <th className="px-2 py-1.5 w-[44px] text-left text-[11px] text-[#707070] font-normal border-r border-[#e6e6e6]">#</th>
              <th className="px-3 py-1.5 text-left text-[11px] text-[#707070] font-normal border-r border-[#e6e6e6]">{nameHeader}</th>
              <th className="px-3 py-1.5 text-right text-[11px] text-[#707070] font-normal border-r border-[#e6e6e6]">Hours</th>
              <th className="px-3 py-1.5 text-right text-[11px] text-[#707070] font-normal">Events</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-5 text-center text-[12px] text-[#707070]">
                  {emptyText}
                </td>
              </tr>
            ) : (
              rows.map((row, idx) => (
                <tr key={`${row.name}-${idx}`} className="border-b border-[#e6e6e6] last:border-b-0 hover:bg-[#F2F1EF] transition-colors">
                  <td className="px-2 py-1.5 text-[12px] text-[#707070] border-r border-[#e6e6e6]">{idx + 1}</td>
                  <td className="px-3 py-1.5 text-[12px] text-black border-r border-[#e6e6e6] truncate" title={row.name}>{row.name}</td>
                  <td className="px-3 py-1.5 text-[12px] text-black text-right tabular-nums border-r border-[#e6e6e6]">{formatNumber(row.hours)}h</td>
                  <td className="px-3 py-1.5 text-[12px] text-[#707070] text-right tabular-nums">{formatEvents(row.events)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  const computerDailyRows = [...(computer?.daily || [])].sort((a, b) => String(a.day).localeCompare(String(b.day)));
  const computerDailyTableRows = computerDailyRows.map((row) => ({
    date: row.day,
    value: `${formatNumber(row.active_hours)}h`,
    entries: row.events_count || 0,
  }));
  const appTableRows = (computer?.top_apps || []).slice(0, 10).map((app) => ({
    name: app.app_name || 'Unknown',
    hours: app.hours || 0,
    events: app.total_events || 0,
  }));
  const domainTableRows = (computer?.top_domains || []).slice(0, 10).map((domain) => ({
    name: domain.domain || 'Unknown',
    hours: domain.hours || 0,
    events: domain.total_events || 0,
  }));

  return (
    <div className="space-y-8">
      <MetricStrip
        columnsClassName="grid-cols-3"
        items={[
          { label: 'Habits with data', value: weeklyOverview.summary.habits_with_data },
          { label: 'Habits tracked', value: weeklyOverview.summary.total_habits_tracked },
          { label: 'Range length', value: `${weeklyOverview.date_range.days} days` },
        ]}
      />

      {habits.map((habit) => (
        <div key={habit.id} className="space-y-3">
          <div>
            <h4 className="text-[18px] font-normal text-black">{habit.name}</h4>
            <div className="text-[11px] text-[#707070] mt-0.5">
              {habit.days_with_data} days with data{habit.total_entries ? ` • ${habit.total_entries} entries` : ''}
            </div>
          </div>

          <MetricStrip
            items={[
              { label: 'Total', value: formatMetric(habit.total, habit.unit) },
              { label: 'Average', value: formatMetric(habit.average, habit.unit) },
              { label: 'Minimum', value: formatMetric(habit.min, habit.unit) },
              { label: 'Maximum', value: formatMetric(habit.max, habit.unit) },
            ]}
          />

          {(() => {
            const isSleepHabit = habit.name.toLowerCase().includes('sleep');
            const dailyRows = [...(habit.daily || [])].sort((a, b) => a.date.localeCompare(b.date));
            return renderDailyValueTable(
              dailyRows.map((row) => {
                const sleepEntry = (row.entries || []).find((entry) => entry.sleep_start || entry.sleep_end);
                return {
                  date: row.date,
                  value: formatMetric(row.value || 0, habit.unit),
                  entries: row.entries?.length || 0,
                  sleep: row.sleep_start || sleepEntry?.sleep_start || '—',
                  wake: row.sleep_end || sleepEntry?.sleep_end || sleepEntry?.time || '—',
                };
              }),
              'No daily rows available for this habit in the selected range.',
              isSleepHabit ? { showSleepWake: true, valueLabel: 'Duration' } : undefined,
            );
          })()}
        </div>
      ))}

      {computer && (
        <div className="space-y-4">
          <h4 className="text-[18px] font-normal text-black">Computer Time</h4>
          <MetricStrip
            items={[
              { label: 'Total', value: `${formatNumber(computer.total_hours)}h` },
              { label: 'Average', value: `${formatNumber(computer.average_daily_hours)}h` },
              { label: 'Minimum', value: `${formatNumber(computer.min_daily_hours)}h` },
              { label: 'Maximum', value: `${formatNumber(computer.max_daily_hours)}h` },
            ]}
          />

          {renderDailyValueTable(
            computerDailyTableRows,
            'No computer time rows found for this date range.',
          )}

          {renderRankedUsageTable(
            'Top apps/websites by active time',
            'No application activity found for this date range.',
            appTableRows,
            'App',
          )}

          {renderRankedUsageTable(
            'Top domains',
            'No domain activity found for this date range.',
            domainTableRows,
            'Domain',
          )}
        </div>
      )}
    </div>
  );
});

// ====================
// MAIN CANVAS COMPONENT - MIDDAY STYLE
// ====================
export const HabitCanvas = memo(function HabitCanvas({ data, onClose }: HabitCanvasProps) {
  if (!data) return null;

  const hasTrends = data.trends && data.trends.success;
  const hasAnomalies = data.anomalies && data.anomalies.success;
  const hasScreenRecordings = data.screenRecordings && data.screenRecordings.success;
  const hasScreenTimeSpent = data.screenTimeSpent && data.screenTimeSpent.success;
  const hasWeeklyOverview = data.weeklyOverview && data.weeklyOverview.success;
  const hasStats = data.stats;
  const hasDailyData = data.dailyData && data.dailyData.length > 0;

  const isHoursBased = data.stats?.totalHours !== undefined && data.stats.totalHours > 0;
  const unit = data.stats?.unit;
  const totalValue = isHoursBased ? data.stats?.totalHours : data.stats?.totalAmount;
  
  return (
    <div className="w-full h-full bg-white flex flex-col overflow-hidden border-l border-gray-200">
      {/* Header - Midday style gray bar */}
      <div className="flex items-center justify-between bg-[#f5f5f3] border-b border-[#e6e6e6] px-4 py-2">
        <div className="text-[12px] text-black font-medium">
          {data.title}
        </div>
        <button
          onClick={onClose}
          className="p-1 text-[#707070] hover:text-black transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Subheader with date range */}
      {(data.dateRange || (hasTrends && data.trends)) && (
        <div className="px-6 pt-4 pb-2">
          <h2 className="text-[18px] font-normal text-black">
            {data.title}
          </h2>
          {data.dateRange && (
            <p className="text-[12px] text-[#707070] mt-0.5">
              {formatDateRange(data.dateRange.start, data.dateRange.end)}
            </p>
          )}
          {hasTrends && data.trends && (
            <p className="text-[12px] text-[#707070] mt-0.5">
              Last {data.trends.window_days} days vs prior {data.trends.window_days} days
            </p>
          )}
        </div>
      )}

      {/* Main content - scrollable, Midday padding */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {/* Trends Section */}
        {hasTrends && data.trends && (
          <TrendsSection trends={data.trends} />
        )}

        {/* Anomalies Section */}
        {hasAnomalies && data.anomalies && (
          <AnomaliesSection anomalies={data.anomalies} />
        )}

        {/* Screen Recordings Section */}
        {hasScreenRecordings && data.screenRecordings && (
          <ScreenRecordingsSection screenRecordings={data.screenRecordings} />
        )}

        {/* Screen Time Spent Section */}
        {hasScreenTimeSpent && data.screenTimeSpent && (
          <ScreenTimeSpentSection screenTimeSpent={data.screenTimeSpent} />
        )}

        {/* Weekly Overview Section */}
        {hasWeeklyOverview && data.weeklyOverview && (
          <WeeklyOverviewSection weeklyOverview={data.weeklyOverview} />
        )}

        {/* Stats Summary - Midday style */}
        {hasStats && !hasTrends && !hasAnomalies && !hasWeeklyOverview && !hasScreenTimeSpent && (
          <div className="grid grid-cols-2 gap-3 mb-6">
            {totalValue !== undefined && (
              <div className="border border-[#e6e6e6] p-3 bg-white">
                <div className="text-[12px] text-[#707070] mb-1">Total</div>
                <div className="text-[18px] font-normal text-black">
                  {formatValueWithUnit(totalValue, unit, isHoursBased)}
                </div>
              </div>
            )}
            {data.stats && data.stats.avgPerDay !== undefined && (
              <div className="border border-[#e6e6e6] p-3 bg-white">
                <div className="text-[12px] text-[#707070] mb-1">Average per day</div>
                <div className="text-[18px] font-normal text-black">
                  {formatValueWithUnit(data.stats.avgPerDay, unit, isHoursBased)}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Daily Data Table - Midday style with borders */}
        {hasDailyData && data.dailyData && !hasWeeklyOverview && !hasScreenTimeSpent && (() => {
          const isSleepData = data.dailyData.some(day => 
            day.entries?.some(entry => entry.sleep_start || entry.sleep_end)
          );
          
          return (
            <div className="mb-6">
              <h4 className="text-[18px] font-normal text-black mb-4">
                Daily breakdown
              </h4>

              <div className="border border-[#e6e6e6] max-h-[400px] overflow-y-auto">
                <table className="w-full">
                  <thead className="sticky top-0 bg-white">
                    <tr className="border-b border-[#e6e6e6]">
                      <th className="px-3 py-2 text-left text-[12px] text-[#707070] font-normal border-r border-[#e6e6e6]">Date</th>
                      {isSleepData ? (
                        <>
                          <th className="px-3 py-2 text-left text-[12px] text-[#707070] font-normal border-r border-[#e6e6e6]">Sleep</th>
                          <th className="px-3 py-2 text-left text-[12px] text-[#707070] font-normal border-r border-[#e6e6e6]">Wake</th>
                        </>
                      ) : (
                        <th className="px-3 py-2 text-left text-[12px] text-[#707070] font-normal border-r border-[#e6e6e6]">Time</th>
                      )}
                      <th className="px-3 py-2 text-right text-[12px] text-[#707070] font-normal">
                        {isHoursBased ? 'Duration' : 'Amount'}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.dailyData.flatMap((day, dayIndex) => {
                      const hasEntries = day.entries && day.entries.length > 0;
                      const isMinuteUnit = unit && ['minutes', 'minute', 'min', 'm'].includes(unit.toLowerCase());
                      
                      if (hasEntries && day.entries!.length > 0) {
                        return day.entries!.map((entry, entryIndex) => {
                          let entryValue: string;
                          if (isHoursBased && !isMinuteUnit) {
                            entryValue = entry.duration_seconds 
                              ? formatValueWithUnit(entry.duration_seconds / 3600, unit, true)
                              : '—';
                          } else if (isMinuteUnit && entry.duration_seconds != null) {
                            entryValue = formatValueWithUnit(entry.duration_seconds / 60, unit, false);
                          } else if (entry.amount != null) {
                            entryValue = formatValueWithUnit(entry.amount, unit, false);
                          } else {
                            entryValue = '—';
                          }
                          
                          return (
                            <tr 
                              key={`${day.date}-${dayIndex}-${entryIndex}`} 
                              className={cn(
                                "hover:bg-[#F2F1EF] transition-colors",
                                (entryIndex !== day.entries!.length - 1 || dayIndex !== data.dailyData!.length - 1) && "border-b border-[#e6e6e6]"
                              )}
                            >
                              <td className="px-3 py-2 text-[12px] text-black border-r border-[#e6e6e6] whitespace-nowrap">
                                {formatDate(day.date)}
                              </td>
                              {isSleepData ? (
                                <>
                                  <td className="px-3 py-2 text-[12px] text-[#707070] border-r border-[#e6e6e6] whitespace-nowrap">
                                    {entry.sleep_start || '—'}
                                  </td>
                                  <td className="px-3 py-2 text-[12px] text-[#707070] border-r border-[#e6e6e6] whitespace-nowrap">
                                    {entry.sleep_end || entry.time || '—'}
                                  </td>
                                </>
                              ) : (
                                <td className="px-3 py-2 text-[12px] text-[#707070] border-r border-[#e6e6e6] whitespace-nowrap">
                                  {entry.time || '—'}
                                </td>
                              )}
                              <td className="px-3 py-2 text-right text-[12px] text-black tabular-nums whitespace-nowrap">
                                {entryValue}
                              </td>
                            </tr>
                          );
                        });
                      } else {
                        const displayValue = day.hours !== undefined 
                          ? formatValueWithUnit(day.hours, unit, true)
                          : day.amount !== undefined 
                            ? formatValueWithUnit(day.amount, unit, false)
                            : day.value !== undefined
                              ? formatValueWithUnit(day.value, unit, isHoursBased)
                              : '—';
                        
                        return [(
                          <tr 
                            key={`${day.date}-${dayIndex}`} 
                            className={cn(
                              "hover:bg-[#F2F1EF] transition-colors",
                              dayIndex !== data.dailyData!.length - 1 && "border-b border-[#e6e6e6]"
                            )}
                          >
                            <td className="px-3 py-2 text-[12px] text-black border-r border-[#e6e6e6] whitespace-nowrap">
                              {formatDate(day.date)}
                            </td>
                            {isSleepData ? (
                              <>
                                <td className="px-3 py-2 text-[12px] text-[#707070] border-r border-[#e6e6e6] whitespace-nowrap">—</td>
                                <td className="px-3 py-2 text-[12px] text-[#707070] border-r border-[#e6e6e6] whitespace-nowrap">—</td>
                              </>
                            ) : (
                              <td className="px-3 py-2 text-[12px] text-[#707070] border-r border-[#e6e6e6] whitespace-nowrap">—</td>
                            )}
                            <td className="px-3 py-2 text-right text-[12px] text-black tabular-nums whitespace-nowrap">
                              {displayValue}
                            </td>
                          </tr>
                        )];
                      }
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
});

export default HabitCanvas;
