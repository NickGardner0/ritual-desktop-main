'use client'

import React, { startTransition, useDeferredValue, useEffect, useRef, useState, useCallback, memo, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuth, useUser } from '@clerk/nextjs';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowUp, ArrowUpRight, AudioLines, BookOpen, Check, FilePenLine, ListTodo, MemoryStick, Plus, X } from 'lucide-react';
import { VoiceWaveform, VoiceWaveformMini } from '@/components/voice-waveform';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { motion, AnimatePresence } from 'framer-motion';
import { Streamdown } from 'streamdown';
import { toast } from 'sonner';
import { HabitCanvas, type HabitCanvasData } from '@/components/chat/habit-canvas';
import { useHabits } from '@/contexts/HabitsContext';
import { ViewModeToggle, type ViewMode } from '@/components/analytics/view-mode-toggle';
import { buildInstantSuggestions, mergeSuggestions, type ChatSuggestion } from '@/lib/ai/chat-suggestions';
import { BrailleSpinner } from '@/components/ui/braille-spinner';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { ensureMicrophonePermission, isTauri } from '@/lib/tauri-utils';
import { useDeepgramDictation } from '@/lib/voice/use-deepgram-dictation';
import { useOverviewActivityQuery } from '@/hooks/use-overview-activity-query';
import {
  getOverviewActivityBundle,
  hasMeaningfulOverviewActivity,
  getOverviewActivityRangeKeysForText,
  overviewActivityKeys,
  type LocalOverviewActivityBundle,
  type OverviewActivityRangeKey,
} from '@/lib/ai/overview-activity/overview-activity-query';
import {
  clearNativeDesktopSpeechState,
  formatNativeSpeechError,
  getNativeSpeechErrorMessage,
  getNativeDesktopSpeechState,
  startNativeDesktopSpeechRecognition,
  stopNativeDesktopSpeechRecognition,
} from '@/lib/native-voice';
import type {
  AiFact,
  AiFactListResponse,
  ArtifactDetail,
  ArtifactKind,
  ConversationQueueItem,
  ConversationQueueListResponse,
  ConversationQueueRunResponse,
} from '@/lib/workflows/types';

export function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

export function SidebarToggleIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <g fill="none" stroke="currentColor" strokeWidth="2">
        <rect width="20" height="18" x="2" y="3" rx="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M9 3v18" />
      </g>
    </svg>
  );
}

export const MAX_VISIBLE_CHAT_SUGGESTIONS = 2;

// TextShimmer component
export const TextShimmer = memo(function TextShimmer({ 
  children, 
  className,
  duration = 2,
  spread = 2,
}: { 
  children: string;
  className?: string;
  duration?: number;
  spread?: number;
}) {
  const dynamicSpread = useMemo(() => children.length * spread, [children, spread]);

  return (
    <motion.p
      className={cn(
        "relative inline-block bg-[length:250%_100%,auto] bg-clip-text",
        "text-transparent [--base-color:#a1a1aa] [--base-gradient-color:#000]",
        "[background-repeat:no-repeat,padding-box] [--bg:linear-gradient(90deg,#0000_calc(50%-var(--spread)),var(--base-gradient-color),#0000_calc(50%+var(--spread)))]",
        className,
      )}
      initial={{ backgroundPosition: "100% center" }}
      animate={{ backgroundPosition: "0% center" }}
      transition={{
        repeat: Infinity,
        duration,
        ease: "linear",
      }}
      style={{
        '--spread': `${dynamicSpread}px`,
        backgroundImage: 'var(--bg), linear-gradient(var(--base-color), var(--base-color))',
      } as React.CSSProperties}
    >
      {children}
    </motion.p>
  );
});

// Streamdown Response component
export const Response = memo(function Response({ 
  children, 
  className 
}: { 
  children: string; 
  className?: string;
}) {
  return (
    <div
      className="select-text cursor-text [&_*]:select-text"
      style={{
        userSelect: 'text',
        WebkitUserSelect: 'text',
      }}
    >
      <Streamdown
        className={cn(
          "w-full min-w-0 break-words [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
          "[&>p]:my-0 [&>p+p]:mt-3",
          "[&>h2]:mt-5 [&>h3]:mt-4 [&>h4]:mt-4 [&>h2]:mb-2 [&>h3]:mb-2 [&>h4]:mb-2",
          "[&>ul]:my-3 [&>ol]:my-3 [&>ul+*]:mt-3 [&>ol+*]:mt-3",
          className,
        )}
        components={{
        ul: ({ children, ...props }) => (
          <ul className="list-disc pl-5 m-0 leading-[1.6] text-[#535353]" {...props}>
            {children}
          </ul>
        ),
        ol: ({ children, ...props }) => (
          <ol className="list-decimal pl-5 m-0 leading-[1.6] text-[#535353]" data-streamdown="ordered-list" {...props}>
            {children}
          </ol>
        ),
        li: ({ children, ...props }) => (
          <li className="my-1 leading-[1.6] text-[#535353] break-words" data-streamdown="list-item" {...props}>
            {children}
          </li>
        ),
        h2: ({ children, ...props }) => (
          <h2 className="font-medium text-[13px] text-gray-900 tracking-wide mt-4 mb-1" {...props}>
            {children}
          </h2>
        ),
        h3: ({ children, ...props }) => (
          <h3 className="font-medium text-[13px] text-gray-900 tracking-wide mt-3 mb-1" {...props}>
            {children}
          </h3>
        ),
        h4: ({ children, ...props }) => (
          <h4 className="font-medium text-[13px] text-gray-900 tracking-wide mt-3 mb-1" {...props}>
            {children}
          </h4>
        ),
        p: ({ children, ...props }) => (
          <p className="leading-[1.55] text-[#535353] break-words" {...props}>
            {children}
          </p>
        ),
        strong: ({ children, ...props }) => (
          <strong className="font-medium text-gray-900" {...props}>
            {children}
          </strong>
        ),
        code: ({ children, ...props }) => (
          <code className="px-1 py-0.5 rounded bg-[#f0ede8] text-[#535353] font-mono text-[13px]" {...props}>
            {children}
          </code>
        ),
        // Hide tables in the main response - they'll show in canvas
        table: () => null,
        thead: () => null,
        tbody: () => null,
        tr: () => null,
        th: () => null,
        td: () => null,
        }}
      >
        {children}
      </Streamdown>
    </div>
  );
});

export type ChatActionReceiptData = {
  receipt_id: string;
  action_kind: string;
  habit_id?: string | null;
  habit_name?: string | null;
  was_inserted?: boolean;
  undoable?: boolean;
  log_id?: string | null;
  amount?: number | null;
  date?: string | null;
};

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  canvasData?: HabitCanvasData;
  replyChips?: string[];  // Phase 4A: Voice mode reply suggestions
  actionReceipts?: ChatActionReceiptData[];
}

export type ConversationContextMenuState = {
  conversationId: string;
  x: number;
  y: number;
} | null;

export function getToolLabel(text: string): string {
  const normalized = (text || '').toLowerCase().trim();
  if (!normalized) return 'Thinking...';
  if (/monthly|last month|this month|last 30/.test(normalized)) return 'Fetching monthly overview...';
  if (/weekly|last week|this week/.test(normalized)) return 'Fetching weekly overview...';
  if (/daily|today|yesterday/.test(normalized)) return 'Fetching daily overview...';
  if (/how was my (week|month|day)/.test(normalized)) {
    if (/month/.test(normalized)) return 'Fetching monthly overview...';
    if (/week/.test(normalized)) return 'Fetching weekly overview...';
    return 'Fetching daily overview...';
  }
  if (/correlat/.test(normalized)) return 'Analyzing correlations...';
  if (/trend/.test(normalized)) return 'Analyzing trends...';
  if (/screen|computer|app usage/.test(normalized)) return 'Fetching activity data...';
  return 'Analyzing your habits...';
}

// Smarter canvas data extraction - looks for patterns in the response
export function extractCanvasData(content: string, question: string): HabitCanvasData | undefined {
  // Strip markdown formatting for easier parsing
  const cleanContent = content.replace(/\*\*/g, '').replace(/\*/g, '');
  
  // Look for date-value patterns (YYYY-MM-DD followed by a number)
  const dateValuePattern = /(\d{4}-\d{2}-\d{2})[:\s]+(\d+\.?\d*)/g;
  const matches = [...cleanContent.matchAll(dateValuePattern)];
  
  // Match full month names like "November 26: 8.3 hours" or "November 26: 8.3"
  const fullMonthPattern = /((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:,?\s*\d{4})?)[:\s]+(\d+\.?\d*)/gi;
  const fullMonthMatches = [...cleanContent.matchAll(fullMonthPattern)];
  
  // Also try to match abbreviated "Month Day: value" patterns  
  const monthDayPattern = /((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:,?\s*\d{4})?)[:\s]+(\d+\.?\d*)/gi;
  const monthMatches = [...cleanContent.matchAll(monthDayPattern)];
  
  // Combine matches - prefer ISO dates, then full months, then abbreviated
  const allMatches = matches.length > 0 ? matches : 
                     fullMonthMatches.length > 0 ? fullMonthMatches : 
                     monthMatches;
  
  if (allMatches.length >= 3) {
    const dailyData = allMatches.map(match => ({
      date: match[1],
      hours: parseFloat(match[2]),
    }));
    
    // Extract habit name from question or content
    const habitPatterns = /(?:sleep|workout|meditation|reading|coding|walk|exercise|running|gym|deep work|technical skills)/i;
    const habitMatch = question.match(habitPatterns) || content.match(habitPatterns);
    const habitName = habitMatch ? habitMatch[0].charAt(0).toUpperCase() + habitMatch[0].slice(1).toLowerCase() : 'Activity';
    
    const totalHours = Math.round(dailyData.reduce((sum, d) => sum + d.hours, 0) * 10) / 10;
    const avgPerDay = Math.round((totalHours / dailyData.length) * 10) / 10;
    
    return {
      type: 'trends',
      title: `${habitName} Trends`,
      habitName,
      dailyData,
      dateRange: {
        start: dailyData[0].date,
        end: dailyData[dailyData.length - 1].date,
      },
      stats: {
        daysTracked: dailyData.length,
        totalHours,
        avgPerDay,
      },
    };
  }
  
  // Look for stats-based responses (totals, averages) - more flexible patterns
  // Note: cleanContent is already defined above with markdown stripped
  
  const totalPatterns = [
    /total\s*(?:sleep|time|duration)?[:\s]+(\d+\.?\d*)\s*(hours?|h|minutes?|min)/i,
    /total of\s+(\d+\.?\d*)\s*(hours?|h|minutes?|min)/i,
    /(\d+\.?\d*)\s*hours?\s*(?:total|in total)/i,
    /tracked[:\s]+(\d+\.?\d*)\s*(hours?|h)/i,
  ];
  
  const avgPatterns = [
    /average\s*(?:sleep|time|duration)?(?:\s*per\s*(?:day|night))?[:\s]+(\d+\.?\d*)\s*(hours?|h|minutes?|min)/i,
    /averaging[:\s]+(?:about\s+)?(\d+\.?\d*)\s*(hours?|h)/i,
    /avg[:\s]+(\d+\.?\d*)\s*(hours?|h)/i,
    /(\d+\.?\d*)\s*hours?\s*per\s*(?:night|day|session)/i,
    /(\d+\.?\d*)\s*(?:hours?|h)\s*(?:on\s+)?average/i,
  ];
  
  const daysPatterns = [
    /(\d+)\s*days?\s*(?:tracked|during|with data)/i,
    /days\s*(?:tracked|with data)[:\s]+(\d+)/i,
    /tracked\s*(?:your\s+\w+\s+)?(?:for\s+)?(\d+)\s*days?/i,
    /over\s*(?:the\s*past\s+)?(\d+)\s*days?/i,
    /(?:past|last)\s+(\d+)\s*days?/i,
    /for\s+(\d+)\s*days?/i,
  ];
  
  const minPatterns = [
    /minimum\s*(?:sleep|time|duration)?[:\s]+(\d+\.?\d*)\s*(hours?|h|minutes?|min)/i,
    /min[:\s]+(\d+\.?\d*)\s*(hours?|h)/i,
    /low(?:est)?[:\s]+(\d+\.?\d*)\s*(hours?|h)/i,
  ];
  
  const maxPatterns = [
    /maximum\s*(?:sleep|time|duration)?[:\s]+(\d+\.?\d*)\s*(hours?|h|minutes?|min)/i,
    /max[:\s]+(\d+\.?\d*)\s*(hours?|h)/i,
    /high(?:est)?[:\s]+(\d+\.?\d*)\s*(hours?|h)/i,
  ];
  
  let totalHours: number | undefined;
  let avgPerDay: number | undefined;
  let daysTracked: number | undefined;
  let minValue: number | undefined;
  let maxValue: number | undefined;
  
  for (const pattern of totalPatterns) {
    const match = cleanContent.match(pattern);
    if (match) { totalHours = parseFloat(match[1]); break; }
  }
  
  for (const pattern of avgPatterns) {
    const match = cleanContent.match(pattern);
    if (match) { avgPerDay = parseFloat(match[1]); break; }
  }
  
  for (const pattern of daysPatterns) {
    const match = cleanContent.match(pattern);
    if (match) { daysTracked = parseInt(match[1]); break; }
  }
  
  for (const pattern of minPatterns) {
    const match = cleanContent.match(pattern);
    if (match) { minValue = parseFloat(match[1]); break; }
  }
  
  for (const pattern of maxPatterns) {
    const match = cleanContent.match(pattern);
    if (match) { maxValue = parseFloat(match[1]); break; }
  }
  
  // Show canvas if we have meaningful stats (total, avg, or min/max with days)
  const hasStats = totalHours || avgPerDay || (minValue && maxValue);
  if (hasStats) {
    const habitPatterns = /(?:sleep|workout|meditation|reading|coding|walk|daily walk|exercise|running|gym|deep work|technical skills|caffeine|water)/i;
    const habitMatch = question.match(habitPatterns) || cleanContent.match(habitPatterns);
    const habitName = habitMatch ? habitMatch[0].charAt(0).toUpperCase() + habitMatch[0].slice(1).toLowerCase() : 'Activity';
    
    return {
      type: 'stats',
      title: `${habitName} Overview`,
      habitName,
      stats: {
        daysTracked: daysTracked || 7,
        totalHours,
        avgPerDay,
        minValue,
        maxValue,
      },
    };
  }
  
  return undefined;
}

// Build canvas data directly from tool results (more reliable than text parsing)
export function buildCanvasFromToolData(
  toolData: { 
    stats?: any; 
    dailyBreakdown?: any; 
    dailyBreakdownHabit?: any; 
    correlation?: any;
    trends?: any;
    anomalies?: any;
    screenTimeSpent?: any;
    weeklyOverview?: any;
    dailyOverview?: any;
    monthlyOverview?: any;
    suggested_followups?: string[];
  } | null,
  question: string
): HabitCanvasData | undefined {
  if (!toolData) return undefined;
  
  // Extract habit name from question
  const habitPatterns = /(?:sleep|workout|meditation|reading|coding|walk|exercise|running|gym|deep work|technical skills|caffeine)/i;
  const habitMatch = question.match(habitPatterns);
  const habitName = habitMatch 
    ? habitMatch[0].charAt(0).toUpperCase() + habitMatch[0].slice(1).toLowerCase() 
    : 'Activity';

  // Handle comprehensive overview canvases
  if (toolData.dailyOverview && toolData.dailyOverview.success) {
    return {
      type: 'weeklyOverview',
      title: 'Daily Activity Overview',
      dateRange: {
        start: toolData.dailyOverview.date_range?.start || '',
        end: toolData.dailyOverview.date_range?.end || '',
      },
      weeklyOverview: toolData.dailyOverview,
    };
  }

  if (toolData.monthlyOverview && toolData.monthlyOverview.success) {
    return {
      type: 'weeklyOverview',
      title: 'Monthly Activity Overview',
      dateRange: {
        start: toolData.monthlyOverview.date_range?.start || '',
        end: toolData.monthlyOverview.date_range?.end || '',
      },
      weeklyOverview: toolData.monthlyOverview,
    };
  }

  if (toolData.weeklyOverview && toolData.weeklyOverview.success) {
    const start = toolData.weeklyOverview.date_range?.start || '';
    const end = toolData.weeklyOverview.date_range?.end || '';
    const title = /last week/i.test(question)
      ? 'Last Week Overview'
      : 'Weekly Activity Overview';
    return {
      type: 'weeklyOverview',
      title,
      dateRange: {
        start,
        end,
      },
      weeklyOverview: toolData.weeklyOverview,
    };
  }

  // Phase 3: Handle trends data
  if (toolData.trends && toolData.trends.success) {
    return {
      type: 'trends',
      title: 'Habit Trends',
      dateRange: {
        start: toolData.trends.current_period?.start || '',
        end: toolData.trends.current_period?.end || '',
      },
      trends: toolData.trends,
    };
  }
  
  // Phase 3: Handle anomalies data
  if (toolData.anomalies && toolData.anomalies.success) {
    return {
      type: 'anomalies',
      title: `${toolData.anomalies.habit?.name || habitName} Anomalies`,
      habitName: toolData.anomalies.habit?.name || habitName,
      dateRange: {
        start: toolData.anomalies.date_range?.start || '',
        end: toolData.anomalies.date_range?.end || '',
      },
      anomalies: toolData.anomalies,
    };
  }
  
  // If we have daily breakdown data, build trends canvas (with table)
  if (toolData.dailyBreakdown && Array.isArray(toolData.dailyBreakdown) && toolData.dailyBreakdown.length > 0) {
    // Get habit name and unit from tool data if available
    const actualHabitName = toolData.dailyBreakdownHabit?.name || habitName;
    const habitUnit = toolData.dailyBreakdownHabit?.unit;
    
    // Determine if this is a duration-based or amount-based habit
    // Check the first data item - API returns null (not undefined) for non-applicable fields
    const firstItem = toolData.dailyBreakdown[0];
    const isDuration = (firstItem.total_hours != null && firstItem.total_hours > 0) || 
                       (firstItem.total_duration_seconds != null && firstItem.total_duration_seconds > 0);
    
    // Check if the habit's unit is minutes (user chose to track in minutes, not hours)
    const isMinutesBased = habitUnit && ['minutes', 'minute', 'min', 'm'].includes(habitUnit.toLowerCase());
    
    // Build daily data with proper field - respect the user's chosen unit
    // The API always provides 'value' as a fallback, but also specific fields
    const dailyData = toolData.dailyBreakdown.map((item: any) => {
      if (isDuration) {
        // For duration habits, convert to the user's chosen unit (minutes or hours)
        let durationValue: number;
        if (isMinutesBased) {
          // User wants minutes - convert seconds to minutes
          durationValue = item.total_duration_seconds != null
            ? item.total_duration_seconds / 60
            : item.total_hours != null
              ? item.total_hours * 60
              : item.value ?? 0;
          return { date: item.date, amount: durationValue, entries: item.entries };
        } else {
          // User wants hours (default for duration)
          durationValue = item.total_hours != null 
            ? item.total_hours 
            : item.total_duration_seconds 
              ? item.total_duration_seconds / 3600 
              : item.value ?? 0;
          return { date: item.date, hours: durationValue, entries: item.entries };
        }
      } else {
        // For amount habits, use total_amount or value (API always provides value)
        const amountValue = item.total_amount ?? item.value ?? 0;
        return { date: item.date, amount: amountValue, entries: item.entries };
      }
    });
    
    // Calculate totals - use amount for minutes-based or non-duration, hours for hour-based duration
    const useAmount = isMinutesBased || !isDuration;
    const totalValue = dailyData.reduce((sum: number, d: any) => 
      sum + (useAmount ? (d.amount || 0) : (d.hours || 0)), 0
    );
    const roundedTotal = Math.round(totalValue * 100) / 100;
    const avgPerDay = Math.round((totalValue / dailyData.length) * 100) / 100;
    
    // Also grab min/max and unit from stats if available
    let minValue: number | undefined;
    let maxValue: number | undefined;
    let unit: string | undefined = habitUnit;
    
    if (toolData.stats && Array.isArray(toolData.stats) && toolData.stats.length > 0) {
      const stat = toolData.stats[0];
      // API returns generic 'min' and 'max' fields
      minValue = stat.min;
      maxValue = stat.max;
      unit = stat.unit || habitUnit;
    }
    
    // For minutes-based habits, treat as amount (not hours) so the canvas displays correctly
    const useHoursDisplay = isDuration && !isMinutesBased;
    
    return {
      type: 'trends',
      title: `${actualHabitName} Trends`,
      habitName: actualHabitName,
      dailyData,
      dateRange: {
        start: dailyData[0]?.date || '',
        end: dailyData[dailyData.length - 1]?.date || '',
      },
      stats: {
        daysTracked: dailyData.length,
        totalHours: useHoursDisplay ? roundedTotal : undefined,
        totalAmount: !useHoursDisplay ? roundedTotal : undefined,
        avgPerDay,
        minValue,
        maxValue,
        unit,
      },
    };
  }
  
  // If we have stats data, build stats canvas
  if (toolData.stats && Array.isArray(toolData.stats) && toolData.stats.length > 0) {
    const stat = toolData.stats[0];
    // Check if unit indicates duration (hours, minutes)
    const isDuration = stat.unit && ['hours', 'hour', 'h', 'minutes', 'minute', 'min'].includes(stat.unit.toLowerCase());
    
    return {
      type: 'stats',
      title: `${stat.name || habitName} Overview`,
      habitName: stat.name || habitName,
      stats: {
        daysTracked: stat.days_with_data || 0,
        // Use generic 'total' field from API - it contains the right value regardless of type
        totalHours: isDuration ? stat.total : undefined,
        totalAmount: !isDuration ? stat.total : undefined,
        avgPerDay: stat.average,
        minValue: stat.min,
        maxValue: stat.max,
        unit: stat.unit,
      },
    };
  }
  
  // If we have correlation data
  if (toolData.correlation) {
    return {
      type: 'stats',
      title: 'Correlation Analysis',
      habitName: `${toolData.correlation.habit1_name} vs ${toolData.correlation.habit2_name}`,
      stats: {
        daysTracked: toolData.correlation.data_points || 0,
        avgPerDay: toolData.correlation.correlation_coefficient,
      },
      insights: [toolData.correlation.interpretation || ''],
    };
  }
  
  return undefined;
}

// Remove table and daily breakdown from content when canvas is showing
export function cleanContentForDisplay(content: string): string {
  let cleaned = content;
  
  // Remove markdown tables
  const tablePattern = /\|[\s\S]*?\|[\s\S]*?(?=\n\n|\n[^|]|$)/g;
  cleaned = cleaned.replace(tablePattern, '');
  
  // Remove "Daily Breakdown" section with bullet points
  // Matches "Daily Breakdown" header followed by bullet list items with dates
  const dailyBreakdownPattern = /(?:Daily Breakdown|Here's a breakdown)[:\s]*\n(?:\s*[-•*]\s*\*{0,2}(?:January|February|March|April|May|June|July|August|September|October|November|December|\d{4}-\d{2}-\d{2})[^•\n]*\n?)+/gi;
  cleaned = cleaned.replace(dailyBreakdownPattern, '');
  
  // Also remove standalone date lists (bullet points starting with dates)
  const dateListPattern = /(?:\s*[-•*]\s*\*{0,2}(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}\*{0,2}[:\s]+[\d.]+\s*hours?\s*\n?)+/gi;
  cleaned = cleaned.replace(dateListPattern, '');

  // Remove screen-time specific sections when dedicated canvas is present
  const screenTimeSectionsPattern = /(?:Top time buckets|Top apps|Top windows|Top domains|Daily breakdown|Sample moments|Estimation method:)[\s\S]*?(?=\n\n[A-Z][^\n]*:|\n\n[A-Z][a-z]+\s|\s*$)/g;
  cleaned = cleaned.replace(screenTimeSectionsPattern, '');
  
  // Remove multiple consecutive newlines
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  
  // Remove leading/trailing whitespace
  cleaned = cleaned.trim();
  
  return cleaned;
}

// Canvas layout constants
export const DEFAULT_CANVAS_WIDTH = 560;
export const MIN_CANVAS_WIDTH = 360;
export const MAX_CANVAS_WIDTH = 860;
// Pure white so the chat card pops cleanly against the page.
export const CHAT_PAGE_CARD_BG = '#ffffff';
// Neutral strip just slightly darker than the card so the Connect-apps bar
// reads as a flush extension rather than a stark grey footer.
export const CHAT_PAGE_CONNECT_BAR_BG = '#ebebea';
export const CHAT_PAGE_CONNECT_BAR_DISMISS_KEY = 'ritual:chat:apps-bar-dismissed';

// Curated from the Integrations page. Icons render inside a shared fixed
// row-height cell for clean vertical alignment, but each logo gets its own
// height tuned by visual weight — portrait silhouettes (Apple) and thin
// marks (Whoop ring) need more height to read at the same optical size as
// dense icons (Google Calendar block).
export const CONNECT_APPS_BAR_CELL_HEIGHT = 16;
export const CONNECT_APPS_BAR_ICONS: Array<{
  id: string;
  alt: string;
  src: string;
  height: number;
}> = [
  { id: 'apple', alt: 'Apple', src: '/images/apple-logo.svg', height: 15 },
  { id: 'whoop', alt: 'Whoop', src: '/images/whoop.svg', height: 15 },
  { id: 'fitbit', alt: 'Fitbit', src: '/images/fitbit.svg', height: 13 },
  { id: 'google-calendar', alt: 'Google Calendar', src: '/images/Google_Calendar_Logo.svg', height: 12 },
  { id: 'plaid', alt: 'Plaid', src: '/images/plaid-mark.svg', height: 13 },
  { id: 'tesla', alt: 'Tesla', src: '/images/Tesla_T_symbol.svg', height: 13 },
];

export interface ConnectAppsBarProps {
  onOpenIntegrations: () => void;
  onDismiss: () => void;
}

export function ConnectAppsBar({ onOpenIntegrations, onDismiss }: ConnectAppsBarProps) {
  return (
    <div
      className="flex items-center justify-between gap-3 border-t border-gray-200/30 px-4 py-2"
      style={{ backgroundColor: CHAT_PAGE_CONNECT_BAR_BG }}
    >
      <button
        type="button"
        onClick={onOpenIntegrations}
        className="text-[12px] font-normal text-gray-500 transition-colors hover:text-gray-700"
      >
        Connect your devices to get better answers
      </button>
      <div className="flex items-center gap-2.5">
        <div
          className="flex items-center gap-2.5"
          style={{ height: CONNECT_APPS_BAR_CELL_HEIGHT }}
        >
          {CONNECT_APPS_BAR_ICONS.map((app) => (
            <span
              key={app.id}
              className="inline-flex shrink-0 items-center justify-center"
              style={{ height: CONNECT_APPS_BAR_CELL_HEIGHT }}
            >
              <img
                src={app.src}
                alt={app.alt}
                className="object-contain opacity-85"
                style={{ height: app.height, width: 'auto' }}
              />
            </span>
          ))}
        </div>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onDismiss();
          }}
          className="flex h-4 w-4 items-center justify-center text-gray-400 transition-colors hover:text-gray-600"
          aria-label="Dismiss connect apps bar"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

// Persisted conversation types
export interface PersistedMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  tool_payload?: Record<string, unknown> | null;
  created_at: string;
}

export interface PersistedConversation {
  id: string;
  user_id: string;
  title: string | null;
  response_mode?: 'text' | 'voice';
  auto_run_queued?: boolean;
  created_at: string;
  updated_at: string;
  messages: PersistedMessage[];
}

// Sidebar conversation item (without full messages)
export interface ConversationListItem {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  first_message?: string;
}

export function buildConversationArtifactBody(message: Message, title: string) {
  return {
    schemaVersion: 1,
    blocks: [
      {
        type: 'hero',
        title,
        periodLabel: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        intro: 'Saved from Ritual chat.',
      },
      { type: 'summary', text: message.content },
    ],
  };
}

export function getPersistedAfterMessageId(messageId: string | undefined): string | null {
  if (!messageId) return null;
  if (
    messageId.startsWith('user-')
    || messageId.startsWith('assistant-')
    || messageId.startsWith('error-')
  ) {
    return null;
  }
  return messageId;
}
