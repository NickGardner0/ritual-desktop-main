'use client';

import React, { memo } from 'react';
import { X, AlertTriangle } from 'lucide-react';
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

export interface HabitCanvasData {
  type: 'trends' | 'stats' | 'breakdown' | 'anomalies';
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
}

interface HabitCanvasProps {
  data: HabitCanvasData | null;
  onClose: () => void;
  onFollowUp?: (question: string) => void;
}

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
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
// MAIN CANVAS COMPONENT - MIDDAY STYLE
// ====================
export const HabitCanvas = memo(function HabitCanvas({ data, onClose }: HabitCanvasProps) {
  if (!data) return null;

  const hasTrends = data.trends && data.trends.success;
  const hasAnomalies = data.anomalies && data.anomalies.success;
  const hasStats = data.stats;
  const hasDailyData = data.dailyData && data.dailyData.length > 0;

  const isHoursBased = data.stats?.totalHours !== undefined && data.stats.totalHours > 0;
  const unit = data.stats?.unit;
  const totalValue = isHoursBased ? data.stats?.totalHours : data.stats?.totalAmount;
  
  return (
    <div className="w-full h-full bg-[#fafaf8] flex flex-col overflow-hidden border-l border-[#e6e6e6]">
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

        {/* Stats Summary - Midday style */}
        {hasStats && !hasTrends && !hasAnomalies && (
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
        {hasDailyData && data.dailyData && (() => {
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
                  <thead className="sticky top-0 bg-[#fafaf8]">
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
