'use client';

import React, { memo } from 'react';
import { X, TrendingUp, TrendingDown, Minus, AlertTriangle, ArrowUp, ArrowDown } from 'lucide-react';
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
  // Phase 3: Trends and Anomalies
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

// Helper to format unit suffix based on data type
function formatUnit(unit?: string, isHours?: boolean): string {
  if (isHours) return 'h';
  if (!unit) return '';
  
  const unitMap: Record<string, string> = {
    'hours': 'h',
    'hour': 'h',
    'h': 'h',
    'minutes': 'm',
    'minute': 'm',
    'min': 'm',
    'm': 'm',
    'milligrams': 'mg',
    'milligram': 'mg',
    'mg': 'mg',
    'grams': 'g',
    'gram': 'g',
    'g': 'g',
    'calories': ' cal',
    'cal': ' cal',
    'steps': ' steps',
    'miles': ' mi',
    'mi': ' mi',
    'kilometers': ' km',
    'km': ' km',
    'count': '',
    'reps': ' reps',
    'sets': ' sets',
    'oz': ' oz',
    'ounces': ' oz',
    'glasses': ' glasses',
    'cups': ' cups',
    'liters': 'L',
    'l': 'L',
    'ml': 'ml',
    'milliliters': 'ml',
    'sessions': '',
  };
  
  const normalized = unit.toLowerCase().trim();
  return unitMap[normalized] ?? ` ${unit}`;
}

function formatValueWithUnit(value: number | undefined, unit?: string, isHours?: boolean): string {
  if (value === undefined) return '';
  const formattedValue = Number.isInteger(value) ? value.toString() : value.toFixed(2);
  return `${formattedValue}${formatUnit(unit, isHours)}`;
}

// Compact stat display for header
const StatPill = memo(function StatPill({ 
  label, 
  value 
}: { 
  label: string; 
  value: string; 
}) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wide text-gray-400">{label}</span>
      <span className="text-sm font-medium text-gray-900">{value}</span>
    </div>
  );
});

// Confidence badge component
const ConfidenceBadge = memo(function ConfidenceBadge({ confidence }: { confidence: 'high' | 'medium' | 'low' }) {
  const colors = {
    high: 'bg-green-100 text-green-700',
    medium: 'bg-yellow-100 text-yellow-700',
    low: 'bg-gray-100 text-gray-500',
  };
  
  return (
    <span className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded font-medium', colors[confidence])}>
      {confidence}
    </span>
  );
});

// Direction indicator
const DirectionIndicator = memo(function DirectionIndicator({ 
  direction, 
  percentChange 
}: { 
  direction: 'up' | 'down' | 'flat';
  percentChange: number;
}) {
  if (direction === 'up') {
    return (
      <span className="flex items-center gap-0.5 text-green-600">
        <TrendingUp className="w-3.5 h-3.5" />
        <span className="text-xs font-medium">+{percentChange}%</span>
      </span>
    );
  }
  if (direction === 'down') {
    return (
      <span className="flex items-center gap-0.5 text-red-500">
        <TrendingDown className="w-3.5 h-3.5" />
        <span className="text-xs font-medium">{percentChange}%</span>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-0.5 text-gray-400">
      <Minus className="w-3.5 h-3.5" />
      <span className="text-xs font-medium">0%</span>
    </span>
  );
});

// Trends section component
const TrendsSection = memo(function TrendsSection({ trends }: { trends: TrendsData }) {
  const improvers = trends.trends.filter(t => t.direction === 'up').slice(0, 3);
  const decliners = trends.trends.filter(t => t.direction === 'down').slice(0, 3);
  const stable = trends.trends.filter(t => t.direction === 'flat');
  
  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="text-center p-2 bg-green-50 rounded">
          <div className="text-lg font-semibold text-green-600">{trends.summary.improving}</div>
          <div className="text-[10px] text-green-600 uppercase">Improving</div>
        </div>
        <div className="text-center p-2 bg-red-50 rounded">
          <div className="text-lg font-semibold text-red-500">{trends.summary.declining}</div>
          <div className="text-[10px] text-red-500 uppercase">Declining</div>
        </div>
        <div className="text-center p-2 bg-gray-50 rounded">
          <div className="text-lg font-semibold text-gray-500">{trends.summary.stable}</div>
          <div className="text-[10px] text-gray-500 uppercase">Stable</div>
        </div>
      </div>

      {/* Improvers */}
      {improvers.length > 0 && (
        <div>
          <h4 className="text-[10px] uppercase tracking-wide text-gray-400 mb-2 flex items-center gap-1">
            <ArrowUp className="w-3 h-3 text-green-500" /> Top Improvers
          </h4>
          <div className="space-y-1">
            {improvers.map(trend => (
              <div key={trend.habit_id} className="flex items-center justify-between py-1.5 px-2 hover:bg-gray-50 rounded">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-700">{trend.habit_name}</span>
                  <ConfidenceBadge confidence={trend.confidence} />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">
                    {trend.previous_avg.toFixed(1)} → {trend.current_avg.toFixed(1)}
                  </span>
                  <DirectionIndicator direction={trend.direction} percentChange={trend.percent_change} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Decliners */}
      {decliners.length > 0 && (
        <div>
          <h4 className="text-[10px] uppercase tracking-wide text-gray-400 mb-2 flex items-center gap-1">
            <ArrowDown className="w-3 h-3 text-red-500" /> Top Decliners
          </h4>
          <div className="space-y-1">
            {decliners.map(trend => (
              <div key={trend.habit_id} className="flex items-center justify-between py-1.5 px-2 hover:bg-gray-50 rounded">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-700">{trend.habit_name}</span>
                  <ConfidenceBadge confidence={trend.confidence} />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">
                    {trend.previous_avg.toFixed(1)} → {trend.current_avg.toFixed(1)}
                  </span>
                  <DirectionIndicator direction={trend.direction} percentChange={trend.percent_change} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stable habits (collapsed) */}
      {stable.length > 0 && (
        <div>
          <h4 className="text-[10px] uppercase tracking-wide text-gray-400 mb-2 flex items-center gap-1">
            <Minus className="w-3 h-3 text-gray-400" /> Stable ({stable.length})
          </h4>
          <div className="text-xs text-gray-500 px-2">
            {stable.map(t => t.habit_name).join(', ')}
          </div>
        </div>
      )}
    </div>
  );
});

// Anomalies section component
const AnomaliesSection = memo(function AnomaliesSection({ anomalies }: { anomalies: AnomaliesData }) {
  return (
    <div className="space-y-4">
      {/* Baseline info */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="p-2 bg-gray-50 rounded">
          <div className="text-[10px] text-gray-500 uppercase">Baseline Avg</div>
          <div className="text-sm font-medium text-gray-700">
            {anomalies.baseline_avg.toFixed(2)} {formatUnit(anomalies.habit.unit)}
          </div>
        </div>
        <div className="p-2 bg-gray-50 rounded">
          <div className="text-[10px] text-gray-500 uppercase">Std Dev</div>
          <div className="text-sm font-medium text-gray-700">
            ±{anomalies.baseline_std_dev.toFixed(2)}
          </div>
        </div>
      </div>

      {/* Summary */}
      {anomalies.summary.total_anomalies > 0 && (
        <div className="flex gap-4 mb-2">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-red-400" />
            <span className="text-xs text-gray-600">{anomalies.summary.spikes} spikes</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-blue-400" />
            <span className="text-xs text-gray-600">{anomalies.summary.drops} drops</span>
          </div>
        </div>
      )}

      {/* Anomalies list */}
      {anomalies.anomalies.length > 0 ? (
        <div className="border border-gray-200 overflow-hidden rounded">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left text-[10px] font-medium text-gray-500 uppercase">Date</th>
                <th className="px-3 py-2 text-right text-[10px] font-medium text-gray-500 uppercase">Value</th>
                <th className="px-3 py-2 text-right text-[10px] font-medium text-gray-500 uppercase">Type</th>
                <th className="px-3 py-2 text-right text-[10px] font-medium text-gray-500 uppercase">Z-Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {anomalies.anomalies.map((anomaly, idx) => (
                <tr key={idx} className="hover:bg-gray-50/50">
                  <td className="px-3 py-2 text-sm text-gray-600">{formatDate(anomaly.date)}</td>
                  <td className="px-3 py-2 text-right text-sm text-gray-900 font-medium tabular-nums">
                    {anomaly.value.toFixed(2)}{formatUnit(anomalies.habit.unit)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span className={cn(
                      'text-[10px] uppercase px-1.5 py-0.5 rounded font-medium',
                      anomaly.type === 'spike' ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'
                    )}>
                      {anomaly.type}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right text-xs text-gray-500 tabular-nums">
                    {anomaly.z_score > 0 ? '+' : ''}{anomaly.z_score.toFixed(1)}σ
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-center py-6 text-sm text-gray-500">
          <AlertTriangle className="w-5 h-5 mx-auto mb-2 text-gray-300" />
          No anomalies detected in this period
        </div>
      )}
    </div>
  );
});

export const HabitCanvas = memo(function HabitCanvas({ data, onClose, onFollowUp }: HabitCanvasProps) {
  if (!data) return null;

  // Determine content type
  const hasTrends = data.trends && data.trends.success;
  const hasAnomalies = data.anomalies && data.anomalies.success;
  const hasStats = data.stats;
  const hasDailyData = data.dailyData && data.dailyData.length > 0;

  // Determine if this is hours-based (duration) or amount-based
  const isHoursBased = data.stats?.totalHours !== undefined && data.stats.totalHours > 0;
  const unit = data.stats?.unit;
  
  // Get the appropriate total value
  const totalValue = isHoursBased ? data.stats?.totalHours : data.stats?.totalAmount;
  
  return (
    <div className="w-full h-full bg-[#fafaf8] flex flex-col overflow-hidden">
      {/* Header with title and close button */}
      <div className="flex items-start justify-between px-5 pt-5 pb-4">
        <div>
          <h3 className="text-base font-medium text-gray-900">{data.title}</h3>
          {data.dateRange && (
            <p className="text-xs text-gray-500 mt-0.5">
              {formatDateRange(data.dateRange.start, data.dateRange.end)}
            </p>
          )}
          {hasTrends && data.trends && (
            <p className="text-xs text-gray-500 mt-0.5">
              Last {data.trends.window_days} days vs prior {data.trends.window_days} days
            </p>
          )}
        </div>
        <button
          onClick={onClose}
          className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-all"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Main content - scrollable */}
      <div className="flex-1 overflow-y-auto px-5 pb-5">
        {/* Trends Section */}
        {hasTrends && data.trends && (
          <div className="mb-6">
            <TrendsSection trends={data.trends} />
          </div>
        )}

        {/* Anomalies Section */}
        {hasAnomalies && data.anomalies && (
          <div className="mb-6">
            <AnomaliesSection anomalies={data.anomalies} />
          </div>
        )}

        {/* Stats Summary */}
        {hasStats && !hasTrends && !hasAnomalies && (
          <div className="mb-4">
            <div className="border border-gray-200 p-4">
              <div className="grid grid-cols-3 gap-4">
                {totalValue !== undefined && (
                  <StatPill 
                    label="Total" 
                    value={formatValueWithUnit(totalValue, unit, isHoursBased)} 
                  />
                )}
                {data.stats && data.stats.avgPerDay !== undefined && (
                  <StatPill 
                    label="Average" 
                    value={formatValueWithUnit(data.stats.avgPerDay, unit, isHoursBased)} 
                  />
                )}
                {data.stats && <StatPill label="Days" value={`${data.stats.daysTracked}`} />}
              </div>
              {data.stats && (data.stats.minValue !== undefined || data.stats.maxValue !== undefined) && (
                <div className="flex gap-4 mt-3 pt-3 border-t border-gray-100">
                  {data.stats.minValue !== undefined && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] uppercase tracking-wide text-gray-400">Min</span>
                      <span className="text-xs font-medium text-gray-700">
                        {formatValueWithUnit(data.stats.minValue, unit, isHoursBased)}
                      </span>
                    </div>
                  )}
                  {data.stats.maxValue !== undefined && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] uppercase tracking-wide text-gray-400">Max</span>
                      <span className="text-xs font-medium text-gray-700">
                        {formatValueWithUnit(data.stats.maxValue, unit, isHoursBased)}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Daily Data Table */}
        {hasDailyData && data.dailyData && (() => {
          const isSleepData = data.dailyData.some(day => 
            day.entries?.some(entry => entry.sleep_start || entry.sleep_end)
          );
          
          return (
            <div className="border border-gray-200 overflow-hidden">
              <div className="max-h-[400px] overflow-y-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-3 py-2.5 text-left text-[10px] font-medium text-gray-500 uppercase tracking-wide">Date</th>
                      {isSleepData ? (
                        <>
                          <th className="px-3 py-2.5 text-left text-[10px] font-medium text-gray-500 uppercase tracking-wide">Sleep</th>
                          <th className="px-3 py-2.5 text-left text-[10px] font-medium text-gray-500 uppercase tracking-wide">Wake</th>
                        </>
                      ) : (
                        <th className="px-3 py-2.5 text-left text-[10px] font-medium text-gray-500 uppercase tracking-wide">Time</th>
                      )}
                      <th className="px-3 py-2.5 text-right text-[10px] font-medium text-gray-500 uppercase tracking-wide">
                        {isHoursBased ? 'Duration' : 'Amount'}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {data.dailyData.flatMap((day, dayIndex) => {
                      const hasEntries = day.entries && day.entries.length > 0;
                      
                      if (hasEntries && day.entries!.length > 0) {
                        const isMinuteUnit = unit && ['minutes', 'minute', 'min', 'm'].includes(unit.toLowerCase());
                        
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
                              className="hover:bg-gray-50/50 transition-colors"
                            >
                              <td className="px-3 py-2.5 text-sm text-gray-600">
                                {formatDate(day.date)}
                              </td>
                              {isSleepData ? (
                                <>
                                  <td className="px-3 py-2.5 text-sm text-gray-500">
                                    {entry.sleep_start || '—'}
                                  </td>
                                  <td className="px-3 py-2.5 text-sm text-gray-500">
                                    {entry.sleep_end || entry.time || '—'}
                                  </td>
                                </>
                              ) : (
                                <td className="px-3 py-2.5 text-sm text-gray-500">
                                  {entry.time || '—'}
                                </td>
                              )}
                              <td className="px-3 py-2.5 text-right text-sm text-gray-900 font-medium tabular-nums">
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
                            className="hover:bg-gray-50/50 transition-colors"
                          >
                            <td className="px-3 py-2.5 text-sm text-gray-600">
                              {formatDate(day.date)}
                            </td>
                            {isSleepData ? (
                              <>
                                <td className="px-3 py-2.5 text-sm text-gray-500">—</td>
                                <td className="px-3 py-2.5 text-sm text-gray-500">—</td>
                              </>
                            ) : (
                              <td className="px-3 py-2.5 text-sm text-gray-500">—</td>
                            )}
                            <td className="px-3 py-2.5 text-right text-sm text-gray-900 font-medium tabular-nums">
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
