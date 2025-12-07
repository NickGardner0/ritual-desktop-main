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

  return (
    <div className="w-full h-full bg-[#fbfbf9] flex flex-col overflow-hidden">
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
              {data.stats.totalHours !== undefined && (
                <StatPill label="Total" value={`${data.stats.totalHours}h`} />
              )}
              {data.stats.totalAmount !== undefined && !data.stats.totalHours && (
                <StatPill label="Total" value={`${data.stats.totalAmount}`} />
              )}
              {data.stats.avgPerDay !== undefined && (
                <StatPill label="Average" value={`${data.stats.avgPerDay}h`} />
              )}
              <StatPill label="Days" value={`${data.stats.daysTracked}`} />
            </div>
            {(data.stats.minValue !== undefined || data.stats.maxValue !== undefined) && (
              <div className="flex gap-4 mt-3 pt-3 border-t border-gray-100">
                {data.stats.minValue !== undefined && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] uppercase tracking-wide text-gray-400">Min</span>
                    <span className="text-xs font-medium text-gray-700">{data.stats.minValue}h</span>
                  </div>
                )}
                {data.stats.maxValue !== undefined && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] uppercase tracking-wide text-gray-400">Max</span>
                    <span className="text-xs font-medium text-gray-700">{data.stats.maxValue}h</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Daily Data Table */}
      <div className="flex-1 overflow-y-auto px-5 pb-5">
        {data.dailyData && data.dailyData.length > 0 && (
          <div className="border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide">Daily Breakdown</h4>
            </div>
            <div className="max-h-[400px] overflow-y-auto">
              <table className="w-full">
                <tbody className="divide-y divide-gray-50">
                  {data.dailyData.map((day, index) => (
                    <tr 
                      key={`${day.date}-${index}`} 
                      className="hover:bg-gray-50/50 transition-colors"
                    >
                      <td className="px-4 py-2.5 text-sm text-gray-600">
                        {formatDate(day.date)}
                      </td>
                      <td className="px-4 py-2.5 text-right text-sm text-gray-900 font-medium tabular-nums">
                        {day.hours !== undefined ? `${day.hours.toFixed(2)}h` : day.amount}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

export default HabitCanvas;
