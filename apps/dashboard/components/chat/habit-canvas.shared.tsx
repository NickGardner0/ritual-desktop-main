'use client';

import React, { memo } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

export const CANVAS_TABLE_BORDER = 'border-[#e6e6e6]';
export const CANVAS_TABLE_WRAPPER = `overflow-hidden border bg-white ${CANVAS_TABLE_BORDER}`;
export const CANVAS_TABLE = 'w-full table-fixed text-xs font-sans border-separate border-spacing-0';
export const CANVAS_HEADER_ROW = 'bg-white';
export const CANVAS_HEADER_CELL = `h-10 px-4 align-middle bg-white text-[12px] font-medium text-[#666] border-b ${CANVAS_TABLE_BORDER}`;
export const CANVAS_BODY_CELL = 'px-4 py-2 align-middle font-normal';

export function TableCols({ widths }: { widths: string[] }) {
  return (
    <colgroup>
      {widths.map((width, index) => (
        <col key={`${width}-${index}`} style={{ width }} />
      ))}
    </colgroup>
  );
}

// Types for trend data
export interface TrendItem {
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

export interface TrendsData {
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
export interface AnomalyItem {
  date: string;
  value: number;
  z_score: number;
  type: 'spike' | 'drop';
  entries_count?: number;
  deviation_from_avg: number;
}

export interface AnomaliesData {
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

export interface WeeklyOverviewHabitDailyRow {
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

export interface WeeklyOverviewHabit {
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

export interface WeeklyOverviewComputerActivity {
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

export interface WeeklyOverviewData {
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
  type: 'trends' | 'stats' | 'breakdown' | 'anomalies' | 'weeklyOverview';
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
  weeklyOverview?: WeeklyOverviewData;
}

interface HabitCanvasProps {
  data: HabitCanvasData | null;
  onClose: () => void;
  onFollowUp?: (question: string) => void;
}

export function formatDate(dateStr: string): string {
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

export function formatDateRange(start: string, end: string): string {
  return `${formatDate(start)} - ${formatDate(end)}`;
}

export function formatUnit(unit?: string, isHours?: boolean): string {
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

export function formatValueWithUnit(value: number | undefined, unit?: string, isHours?: boolean): string {
  if (value === undefined) return '';
  const formattedValue = Number.isInteger(value) ? value.toString() : value.toFixed(1);
  return `${formattedValue}${formatUnit(unit, isHours)}`;
}

export function isSleepDurationHabit(name?: string): boolean {
  return String(name || '').trim().toLowerCase() === 'sleep duration';
}

export function formatTimeList(values: Array<string | undefined | null>): string {
  const uniqueValues = Array.from(
    new Set(
      values
        .map((value) => String(value || '').trim())
        .filter(Boolean),
    ),
  );

  return uniqueValues.length > 0 ? uniqueValues.join(', ') : '—';
}

export interface HabitDailyTableRow {
  date: string;
  value: string;
  entries: string;
  time?: string;
  sleepTime?: string;
  wakeTime?: string;
}

