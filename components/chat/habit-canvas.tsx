'use client';

import React, { memo } from 'react';
import { X } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

export interface HabitCanvasData {
  type: 'trends' | 'stats' | 'breakdown';
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
}

interface HabitCanvasProps {
  data: HabitCanvasData | null;
  onClose: () => void;
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
  // If it's hours-based (duration), use 'h'
  if (isHours) return 'h';
  
  // If no unit specified, return empty
  if (!unit) return '';
  
  // Map common units to their display format
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
  };
  
  const normalized = unit.toLowerCase().trim();
  return unitMap[normalized] ?? ` ${unit}`;
}

// Format a value with its unit
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

export const HabitCanvas = memo(function HabitCanvas({ data, onClose }: HabitCanvasProps) {
  if (!data) return null;

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
        </div>
        <button
          onClick={onClose}
          className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-all"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Stats Summary - AT TOP */}
      {data.stats && (
        <div className="px-5 pb-4">
          <div className="border border-gray-200 p-4">
            <div className="grid grid-cols-3 gap-4">
              {totalValue !== undefined && (
                <StatPill 
                  label="Total" 
                  value={formatValueWithUnit(totalValue, unit, isHoursBased)} 
                />
              )}
              {data.stats.avgPerDay !== undefined && (
                <StatPill 
                  label="Average" 
                  value={formatValueWithUnit(data.stats.avgPerDay, unit, isHoursBased)} 
                />
              )}
              <StatPill label="Days" value={`${data.stats.daysTracked}`} />
            </div>
            {(data.stats.minValue !== undefined || data.stats.maxValue !== undefined) && (
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

      {/* Daily Data Table - Dynamic columns based on data type */}
      <div className="flex-1 overflow-y-auto px-5 pb-5">
        {data.dailyData && data.dailyData.length > 0 && (() => {
          // Check if this is sleep data (has sleep_start/sleep_end in any entry)
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
                      // Check if we have individual entries
                      const hasEntries = day.entries && day.entries.length > 0;
                      
                      if (hasEntries && day.entries!.length > 0) {
                        // Show each entry as its own row
                        // Check if unit indicates minutes (don't convert to hours)
                        const isMinuteUnit = unit && ['minutes', 'minute', 'min', 'm'].includes(unit.toLowerCase());
                        
                        return day.entries!.map((entry, entryIndex) => {
                          let entryValue: string;
                          if (isHoursBased && !isMinuteUnit) {
                            // Hours-based: convert seconds to hours
                            entryValue = entry.duration_seconds 
                              ? formatValueWithUnit(entry.duration_seconds / 3600, unit, true)
                              : '—';
                          } else if (isMinuteUnit && entry.duration_seconds != null) {
                            // Minutes-based: convert seconds to minutes
                            entryValue = formatValueWithUnit(entry.duration_seconds / 60, unit, false);
                          } else if (entry.amount != null) {
                            // Amount-based
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
                        // Fallback: show aggregated row without time
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
