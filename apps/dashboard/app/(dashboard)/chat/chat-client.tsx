'use client'

import React, { startTransition, useDeferredValue, useEffect, useRef, useState, useCallback, memo, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuth, useUser } from '@clerk/nextjs';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowUp, ArrowUpRight, AudioLines, BookOpen, Check, FilePenLine, ListTodo, MemoryStick, Plus, PanelRight, X } from 'lucide-react';
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
} from '@/lib/ai/chat-stream/overview-activity-query';
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

function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

function SidebarToggleIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect x="2.75" y="4" width="18.5" height="16" rx="3.25" stroke="currentColor" strokeWidth="1.75" />
      <path d="M9.6 5.5V18.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <rect x="5.1" y="7.05" width="2.55" height="1.75" rx="0.875" fill="currentColor" />
      <rect x="5.1" y="11.1" width="2.55" height="1.75" rx="0.875" fill="currentColor" />
      <rect x="5.1" y="15.15" width="2.55" height="1.75" rx="0.875" fill="currentColor" />
    </svg>
  );
}

const MAX_VISIBLE_CHAT_SUGGESTIONS = 2;

// TextShimmer component
const TextShimmer = memo(function TextShimmer({ 
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
const Response = memo(function Response({ 
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

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  canvasData?: HabitCanvasData;
  replyChips?: string[];  // Phase 4A: Voice mode reply suggestions
}

type ConversationContextMenuState = {
  conversationId: string;
  x: number;
  y: number;
} | null;

function getToolLabel(text: string): string {
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
function extractCanvasData(content: string, question: string): HabitCanvasData | undefined {
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
function buildCanvasFromToolData(
  toolData: { 
    stats?: any; 
    dailyBreakdown?: any; 
    dailyBreakdownHabit?: any; 
    correlation?: any;
    trends?: any;
    anomalies?: any;
    screenRecordings?: any;
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

  if (toolData.screenTimeSpent && toolData.screenTimeSpent.success) {
    const groupBy = toolData.screenTimeSpent.group_by || 'app';
    const title = groupBy === 'domain'
      ? 'Computer Time by Domain'
      : groupBy === 'window'
        ? 'Computer Time by Window'
        : 'Computer Time by App';
    return {
      type: 'screenTimeSpent',
      title,
      dateRange: {
        start: toolData.screenTimeSpent.summary?.range_start || '',
        end: toolData.screenTimeSpent.summary?.range_end || '',
      },
      screenTimeSpent: toolData.screenTimeSpent,
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
function cleanContentForDisplay(content: string): string {
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

// Python API base URL
const PYTHON_API_BASE = process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';
const DEFAULT_CANVAS_WIDTH = 560;
const MIN_CANVAS_WIDTH = 360;
const MAX_CANVAS_WIDTH = 860;
// Pure white so the chat card pops cleanly against the page.
const CHAT_PAGE_CARD_BG = '#ffffff';
// Neutral strip just slightly darker than the card so the Connect-apps bar
// reads as a flush extension rather than a stark grey footer.
const CHAT_PAGE_CONNECT_BAR_BG = '#ebebea';
const CHAT_PAGE_CONNECT_BAR_DISMISS_KEY = 'ritual:chat:apps-bar-dismissed';

// Curated from the Integrations page. Icons render inside a shared fixed
// row-height cell for clean vertical alignment, but each logo gets its own
// height tuned by visual weight — portrait silhouettes (Apple) and thin
// marks (Whoop ring) need more height to read at the same optical size as
// dense icons (Google Calendar block).
const CONNECT_APPS_BAR_CELL_HEIGHT = 16;
const CONNECT_APPS_BAR_ICONS: Array<{
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

interface ConnectAppsBarProps {
  onOpenIntegrations: () => void;
  onDismiss: () => void;
}

function ConnectAppsBar({ onOpenIntegrations, onDismiss }: ConnectAppsBarProps) {
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
interface PersistedMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  tool_payload?: Record<string, unknown> | null;
  created_at: string;
}

interface PersistedConversation {
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
interface ConversationListItem {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  first_message?: string;
}

function buildConversationArtifactBody(message: Message, title: string) {
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

function getPersistedAfterMessageId(messageId: string | undefined): string | null {
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

export function ChatClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialQuestion = searchParams.get('q');
  const initialConversationId = searchParams.get('conversation');
  const { getToken } = useAuth();
  const { user } = useUser();
  const queryClient = useQueryClient();
  const { habits, habitLogs } = useHabits();

  // Time-of-day greeting
  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return 'Good morning';
    if (hour >= 12 && hour < 17) return 'Good afternoon';
    return 'Good evening';
  }, []);

  // Connect-apps strip under the chat input. Dismissable; persists per user.
  const [showConnectAppsBar, setShowConnectAppsBar] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    try {
      return window.localStorage.getItem(CHAT_PAGE_CONNECT_BAR_DISMISS_KEY) !== '1';
    } catch {
      return true;
    }
  });

  const dismissConnectAppsBar = useCallback(() => {
    setShowConnectAppsBar(false);
    try {
      window.localStorage.setItem(CHAT_PAGE_CONNECT_BAR_DISMISS_KEY, '1');
    } catch {
      // ignore storage failures
    }
  }, []);

  const openIntegrationsPage = useCallback(() => {
    router.push('/integrations');
  }, [router]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestionsAbortRef = useRef<AbortController | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [canvasData, setCanvasData] = useState<HabitCanvasData | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState('');
  const initialQuestionSubmissionRef = useRef<string | null>(null);
  
  // Conversation persistence state
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isLoadingConversation, setIsLoadingConversation] = useState(false);
  
  // Sidebar state
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true);  // Collapsed by default
  const [isLoadingConversations, setIsLoadingConversations] = useState(false);
  const [conversationContextMenu, setConversationContextMenu] = useState<ConversationContextMenuState>(null);
  const [queueItems, setQueueItems] = useState<ConversationQueueItem[]>([]);
  const [queueAutoRun, setQueueAutoRun] = useState(false);
  const [isQueueOpen, setIsQueueOpen] = useState(false);
  const [isMemoryOpen, setIsMemoryOpen] = useState(false);
  const [linkedArtifacts, setLinkedArtifacts] = useState<ArtifactDetail[]>([]);
  const [memoryFacts, setMemoryFacts] = useState<AiFact[]>([]);
  
  // Voice mode state (transcription)
  const [isListening, setIsListening] = useState(false);
  const [isProcessingVoice, setIsProcessingVoice] = useState(false);
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [partialTranscript, setPartialTranscript] = useState<string | null>(null);
  // Mirror of partialTranscript readable from stale closures (poll loop, auto-stop).
  const partialTranscriptRef = useRef<string | null>(null);
  const nativeVoicePollRef = useRef<number | null>(null);
  const nativeVoiceAutoStopRef = useRef<number | null>(null);
  const nativeVoiceFinalizeTimeoutRef = useRef<number | null>(null);
  const nativeVoiceTimestampRef = useRef(0);
  // Audio-level silence detector (independent of Swift's partial cadence).
  const nativeVoiceSilenceAudioCtxRef = useRef<AudioContext | null>(null);
  const nativeVoiceSilenceRafRef = useRef<number | null>(null);
  const nativeVoiceSilenceTimerRef = useRef<number | null>(null);
  const nativeVoiceHadSpeechRef = useRef(false);
  // Transcript-stability auto-stop tracking.
  const nativeVoicePartialLastChangeRef = useRef<number>(0);
  const nativeVoicePartialLastValueRef = useRef<string>('');
  const voiceInputModeRef = useRef<'native' | 'whisper' | 'deepgram' | null>(null);

  // Voice style mode (Phase 4A - conversational responses)
  const [voiceStyleEnabled, setVoiceStyleEnabled] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<ChatSuggestion[]>([]);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const [keyboardSuggestionActive, setKeyboardSuggestionActive] = useState(false);
  
  // Tool execution status for shimmer → checkmark UI
  const [toolStatus, setToolStatus] = useState<{ label: string; done: boolean } | null>(null);

  // Scroll refs
  const scrollRef = useRef<HTMLDivElement>(null);
  const latestUserMessageRef = useRef<HTMLDivElement>(null);

  // Resizable side panel state
  const [canvasWidth, setCanvasWidth] = useState(DEFAULT_CANVAS_WIDTH);
  const [isResizingCanvas, setIsResizingCanvas] = useState(false);
  const [viewportWidth, setViewportWidth] = useState<number>(() => (
    typeof window !== 'undefined' ? window.innerWidth : 1400
  ));
  const [headerLeftSlot, setHeaderLeftSlot] = useState<HTMLElement | null>(null);
  const [headerCenterSlot, setHeaderCenterSlot] = useState<HTMLElement | null>(null);
  const resizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const maxCanvasWidthForViewport = Math.min(
    MAX_CANVAS_WIDTH,
    Math.max(MIN_CANVAS_WIDTH, Math.floor(viewportWidth * 0.48)),
  );
  const effectiveCanvasWidth = Math.min(canvasWidth, maxCanvasWidthForViewport);
  const deferredInput = useDeferredValue(input.trim());
  const timezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    [],
  );
  const overviewIntentRangeKeys = useMemo(
    () => getOverviewActivityRangeKeysForText(deferredInput),
    [deferredInput],
  );
  const primaryOverviewRangeKey = overviewIntentRangeKeys[0] ?? 'rolling-week';

  useOverviewActivityQuery({
    userId: user?.id,
    timezone,
    rangeKey: primaryOverviewRangeKey,
    enabled: isTauri() && overviewIntentRangeKeys.length > 0,
  });

  useEffect(() => {
    setHeaderLeftSlot(document.getElementById('header-left-slot'));
    setHeaderCenterSlot(document.getElementById('header-center-slot'));
  }, []);

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    setCanvasWidth((prev) => Math.min(prev, maxCanvasWidthForViewport));
  }, [maxCanvasWidthForViewport]);

  // Warm dashboard route so header controls don't pop in late on return.
  useEffect(() => {
    router.prefetch('/dashboard');
  }, [router]);

  const handleViewChange = useCallback((newView: ViewMode) => {
    if (newView === 'chat') return;
    router.push(`/dashboard?view=${newView}`);
  }, [router]);

  const prefetchOverviewActivityRange = useCallback((rangeKey: OverviewActivityRangeKey) => {
    if (!user?.id || !isTauri()) return;
    void queryClient.prefetchQuery({
      queryKey: overviewActivityKeys.detail(user.id, timezone, rangeKey),
      queryFn: () => getOverviewActivityBundle(rangeKey, timezone),
      staleTime: 1000 * 60 * 5,
    });
  }, [queryClient, timezone, user?.id]);

  useEffect(() => {
    if (!user?.id || !isTauri()) return;
    (['today', 'rolling-week', 'this-week', 'last-week', 'month'] as OverviewActivityRangeKey[])
      .forEach(prefetchOverviewActivityRange);
  }, [prefetchOverviewActivityRange, user?.id]);

  useEffect(() => {
    if (!user?.id || !isTauri() || overviewIntentRangeKeys.length === 0) return;
    overviewIntentRangeKeys.forEach(prefetchOverviewActivityRange);
  }, [overviewIntentRangeKeys, prefetchOverviewActivityRange, user?.id]);

  const fetchSuggestions = useCallback(async (
    query: string,
    signal?: AbortSignal,
  ): Promise<ChatSuggestion[]> => {
    try {
      const token = await getToken();
      const params = new URLSearchParams({ mode: 'chat', q: query });
      const response = await fetch(`/api/suggestions?${params.toString()}`, {
        cache: 'no-store',
        signal,
        headers: {
          Authorization: token ? `Bearer ${token}` : '',
        },
      });

      if (!response.ok) {
        return [];
      }

      const data = await response.json();
      return (data.suggestions || []).slice(0, 5).map((suggestion: ChatSuggestion) => ({
        ...suggestion,
        score: suggestion.score || 0,
        source: 'server',
      }));
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        return [];
      }
      console.error('Suggestions fetch error:', error);
      return [];
    }
  }, [getToken]);

  useEffect(() => {
    const localSuggestions = buildInstantSuggestions({
      mode: 'chat',
      query: deferredInput,
      habits,
      habitLogs,
      limit: 4,
    });

    startTransition(() => {
      setSuggestions(localSuggestions);
      setSelectedSuggestionIndex(0);
      setKeyboardSuggestionActive(false);
    });
  }, [deferredInput, habits, habitLogs]);

  useEffect(() => {
    const localSuggestions = buildInstantSuggestions({
      mode: 'chat',
      query: deferredInput,
      habits,
      habitLogs,
      limit: 4,
    });

    suggestionsAbortRef.current?.abort();
    const controller = new AbortController();
    suggestionsAbortRef.current = controller;

    const timer = window.setTimeout(async () => {
      const remoteSuggestions = await fetchSuggestions(deferredInput, controller.signal);
      if (controller.signal.aborted) return;

      startTransition(() => {
        setSuggestions(mergeSuggestions(localSuggestions, remoteSuggestions, 4));
      });
    }, deferredInput ? 120 : 0);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [deferredInput, habits, habitLogs, fetchSuggestions]);
  
  // Start in a clean empty state unless an explicit saved conversation is requested.
  useEffect(() => {
    if (initialQuestion || initialConversationId) return;
    setIsLoadingConversation(false);
  }, [initialConversationId, initialQuestion]);

  // Load conversations list for sidebar
  const loadConversationsList = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return;
      
      setIsLoadingConversations(true);
      const response = await fetch(`${PYTHON_API_BASE}/api/conversations?limit=10`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.conversations) {
          setConversations(data.conversations);
        }
      }
    } catch (error) {
      console.error('Failed to load conversations list:', error);
    } finally {
      setIsLoadingConversations(false);
    }
  }, [getToken]);

  const loadQueueItems = useCallback(async (targetConversationId: string) => {
    try {
      const response = await fetch(`/api/conversations/${targetConversationId}/queue`, {
        cache: 'no-store',
      });
      if (!response.ok) return;
      const data: ConversationQueueListResponse = await response.json();
      setQueueItems(data.items || []);
      setQueueAutoRun(Boolean(data.auto_run_queued));
    } catch (error) {
      console.error('Failed to load queue items:', error);
    }
  }, []);

  const loadLinkedArtifacts = useCallback(async (targetConversationId: string) => {
    try {
      const response = await fetch(`/api/artifacts?linked_to=${encodeURIComponent(targetConversationId)}&limit=12`, {
        cache: 'no-store',
      });
      if (!response.ok) return;
      const data = await response.json() as { items?: Array<{ id: string }> };
      const artifactIds = (data.items || []).map((item) => item.id).slice(0, 6);
      if (artifactIds.length === 0) {
        setLinkedArtifacts([]);
        return;
      }
      const details = await Promise.all(
        artifactIds.map(async (artifactId) => {
          const detailResponse = await fetch(`/api/artifacts/${artifactId}`, { cache: 'no-store' });
          if (!detailResponse.ok) return null;
          return detailResponse.json() as Promise<ArtifactDetail>;
        }),
      );
      setLinkedArtifacts(details.filter(Boolean) as ArtifactDetail[]);
    } catch (error) {
      console.error('Failed to load linked artifacts:', error);
    }
  }, []);

  const loadMemoryFacts = useCallback(async () => {
    try {
      const response = await fetch('/api/ai-facts', { cache: 'no-store' });
      if (!response.ok) return;
      const data: AiFactListResponse = await response.json();
      setMemoryFacts(data.items || []);
    } catch (error) {
      console.error('Failed to load AI facts:', error);
    }
  }, []);

  // Load conversations list on mount
  useEffect(() => {
    loadConversationsList();
  }, [loadConversationsList]);

  useEffect(() => {
    loadMemoryFacts();
  }, [loadMemoryFacts]);

  useEffect(() => {
    if (!conversationId) {
      setQueueItems([]);
      setLinkedArtifacts([]);
      return;
    }
    void loadQueueItems(conversationId);
    void loadLinkedArtifacts(conversationId);
  }, [conversationId, loadLinkedArtifacts, loadQueueItems]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.body.dataset.chatSidebarCollapsed = String(isSidebarCollapsed);
    return () => {
      delete document.body.dataset.chatSidebarCollapsed;
    };
  }, [isSidebarCollapsed]);

  // Switch to a different conversation
  const switchConversation = useCallback(async (targetConversationId: string) => {
    if (targetConversationId === conversationId) return;
    
    try {
      const token = await getToken();
      if (!token) return;
      
      setIsLoadingConversation(true);
      setMessages([]);
      setCanvasData(null);
      setStreamingContent('');
      
      const response = await fetch(`${PYTHON_API_BASE}/api/conversations/${targetConversationId}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      
      if (response.ok) {
        const conversation: PersistedConversation = await response.json();
        
        if (conversation && conversation.messages && conversation.messages.length > 0) {
          const loadedMessages: Message[] = conversation.messages.map((m) => {
            let messageCanvasData: HabitCanvasData | undefined;
            if (m.tool_payload && m.role === 'assistant') {
              const toolData = m.tool_payload as { stats?: unknown; dailyBreakdown?: unknown; dailyBreakdownHabit?: unknown; correlation?: unknown; screenTimeSpent?: unknown; weeklyOverview?: unknown; dailyOverview?: unknown; monthlyOverview?: unknown };
              const messageIndex = conversation.messages.findIndex(msg => msg.id === m.id);
              const previousUserMessage = messageIndex > 0 ? conversation.messages[messageIndex - 1] : null;
              const question = previousUserMessage?.role === 'user' ? previousUserMessage.content : '';
              messageCanvasData = buildCanvasFromToolData(toolData, question);
            }
            
            return {
              id: m.id,
              role: m.role,
              content: m.content,
              canvasData: messageCanvasData,
            };
          });
          
          setMessages(loadedMessages);
          setConversationId(conversation.id);
          
          // Initialize voice style from conversation's response_mode
          setVoiceStyleEnabled(conversation.response_mode === 'voice');
          setQueueAutoRun(Boolean(conversation.auto_run_queued));
          
          const lastMessageWithCanvas = [...loadedMessages].reverse().find(m => m.canvasData);
          if (lastMessageWithCanvas?.canvasData) {
            setCanvasData(lastMessageWithCanvas.canvasData);
          }
        }
      }
    } catch (error) {
      console.error('Failed to switch conversation:', error);
    } finally {
      setIsLoadingConversation(false);
    }
  }, [getToken, conversationId]);

  useEffect(() => {
    if (!initialConversationId || initialQuestion) {
      return;
    }
    void switchConversation(initialConversationId);
  }, [initialConversationId, initialQuestion, switchConversation]);

  // Start a new conversation
  const startNewConversation = useCallback(() => {
    setConversationId(null);
    setMessages([]);
    setCanvasData(null);
    setStreamingContent('');
    setInput('');
    setVoiceStyleEnabled(false); // Reset voice style for new conversations
    setQueueItems([]);
    setLinkedArtifacts([]);
  }, []);

  // Delete a conversation
  const deleteConversation = useCallback(async (targetConversationId: string) => {
    try {
      const token = await getToken();
      if (!token) return;
      
      const response = await fetch(`${PYTHON_API_BASE}/api/conversations/${targetConversationId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      
      if (response.ok) {
        setConversationContextMenu((current) => (
          current?.conversationId === targetConversationId ? null : current
        ));
        // Remove from local list
        setConversations(prev => prev.filter(c => c.id !== targetConversationId));
        
        // If the deleted conversation was the active one, start a new conversation
        if (targetConversationId === conversationId) {
          startNewConversation();
        }
      }
    } catch (error) {
      console.error('Failed to delete conversation:', error);
    }
  }, [getToken, conversationId, startNewConversation]);

  const showConversationContextMenu = useCallback((targetConversationId: string, e: React.MouseEvent) => {
    e.preventDefault();
    setConversationContextMenu({
      conversationId: targetConversationId,
      x: e.clientX,
      y: e.clientY,
    });
  }, []);

  useEffect(() => {
    if (!conversationContextMenu) return;

    const closeMenu = () => setConversationContextMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMenu();
      }
    };

    window.addEventListener('mousedown', closeMenu);
    window.addEventListener('resize', closeMenu);
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('keydown', closeOnEscape);

    return () => {
      window.removeEventListener('mousedown', closeMenu);
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [conversationContextMenu]);

  const handleConversationContextDelete = useCallback(() => {
    if (!conversationContextMenu) return;
    void deleteConversation(conversationContextMenu.conversationId);
  }, [conversationContextMenu, deleteConversation]);

  const saveConversationArtifact = useCallback(async (kind: ArtifactKind, message: Message) => {
    if (!conversationId) {
      toast.error('Save this after the conversation has been created.');
      return;
    }

    const titleBase = message.content.split('\n')[0]?.trim() || (kind === 'plan' ? 'New plan' : 'New notebook');
    const payload = {
      title: titleBase.slice(0, 80),
      summary: message.content.slice(0, 280),
      body: buildConversationArtifactBody(message, titleBase.slice(0, 80)),
      kind,
    };

    const response = await fetch(`/api/conversations/${conversationId}/artifacts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      toast.error('Failed to save artifact.');
      return;
    }

    toast.success(kind === 'plan' ? 'Plan saved.' : 'Notebook saved.');
    void loadLinkedArtifacts(conversationId);
  }, [conversationId, loadLinkedArtifacts]);

  const appendToLatestNotebook = useCallback(async (message: Message) => {
    const latestNotebook = linkedArtifacts.find((artifact) => artifact.kind === 'notebook');
    if (!latestNotebook) {
      await saveConversationArtifact('notebook', message);
      return;
    }

    const currentBlocks = Array.isArray(latestNotebook.body?.blocks) ? latestNotebook.body.blocks : [];
    const nextBlocks = [
      ...currentBlocks,
      { type: 'summary', text: message.content },
    ];

    const response = await fetch(`/api/artifacts/${latestNotebook.id}/revisions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        base_version: latestNotebook.revision_count,
        editor_type: 'user',
        summary: latestNotebook.summary || message.content.slice(0, 160),
        change_note: 'Appended from chat response',
        body: {
          schemaVersion: 1,
          blocks: nextBlocks,
        },
      }),
    });

    if (!response.ok) {
      toast.error('Failed to append to notebook.');
      return;
    }

    toast.success('Appended to notebook.');
    void loadLinkedArtifacts(conversationId!);
  }, [conversationId, linkedArtifacts, loadLinkedArtifacts, saveConversationArtifact]);

  const queuePrompt = useCallback(async (promptText: string, source: ConversationQueueItem['source'] = 'manual') => {
    if (!conversationId) {
      toast.error('Queueing starts after the conversation is created.');
      return;
    }
    const anchorId = getPersistedAfterMessageId(messages[messages.length - 1]?.id);
    const response = await fetch(`/api/conversations/${conversationId}/queue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt_text: promptText,
        source,
        auto_run: queueAutoRun,
        after_message_id: anchorId,
      }),
    });
    if (!response.ok) {
      toast.error('Failed to queue prompt.');
      return;
    }
    setInput('');
    toast.success('Queued for later.');
    await loadQueueItems(conversationId);
  }, [conversationId, loadQueueItems, messages, queueAutoRun]);

  const sendMessage = useCallback(async (text: string): Promise<boolean> => {
    if (isLoading || !text.trim()) return false;
    
    setIsLoading(true);
    setStreamingContent('');
    setCurrentQuestion(text);
    setToolStatus({ label: getToolLabel(text), done: false });
    
    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text.trim(),
    };
    
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    
    const overviewRangeKeys = [...new Set(getOverviewActivityRangeKeysForText(text))];
    let localOverviewActivity: LocalOverviewActivityBundle[] | null = null;

    if (isTauri() && user?.id && overviewRangeKeys.length > 0) {
      const resolvedOverviewBundles = await Promise.all(
        overviewRangeKeys.map(async (rangeKey) => {
          const queryKey = overviewActivityKeys.detail(user.id, timezone, rangeKey);
          const cached = queryClient.getQueryData<LocalOverviewActivityBundle | null>(queryKey);

          if (hasMeaningfulOverviewActivity(cached)) {
            return cached;
          }

          try {
            return await queryClient.fetchQuery({
              queryKey,
              queryFn: () => getOverviewActivityBundle(rangeKey, timezone),
              staleTime: 1000 * 60 * 5,
            });
          } catch (error) {
            console.warn('Failed to resolve overview activity bundle for chat request', {
              rangeKey,
              error: error instanceof Error ? error.message : String(error),
            });
            return null;
          }
        }),
      );

      const meaningfulOverviewBundles = resolvedOverviewBundles.filter(
        (bundle): bundle is LocalOverviewActivityBundle => hasMeaningfulOverviewActivity(bundle),
      );

      localOverviewActivity = meaningfulOverviewBundles.length > 0
        ? meaningfulOverviewBundles
        : null;
    }
    
    try {
      const token = await getToken();
      
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: {
          'Authorization': token ? `Bearer ${token}` : '',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
          timezone,
          conversationId: conversationId, // Include conversation ID for persistence
          responseMode: voiceStyleEnabled ? 'voice' : 'text', // Phase 4A: Voice style mode
          screenSearchResults: null,
          localOverviewActivity,
        }),
      });
      
      if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
      if (!response.body) throw new Error('No response body');
      
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullResponse = '';
      let toolData: { stats?: any; dailyBreakdown?: any; dailyBreakdownHabit?: any; correlation?: any; trends?: any; anomalies?: any; screenRecordings?: any; screenTimeSpent?: any; weeklyOverview?: any; dailyOverview?: any; monthlyOverview?: any; suggested_followups?: string[]; reply_chips?: string[] } | null = null;
      let streamBuffer = '';
      let toolMarkedDone = false;

      const processStreamLine = (rawLine: string) => {
        const line = rawLine.replace(/\r$/, '');
        if (!line.trim()) return;

        // Check for conversation ID (sent first by server)
        if (line.includes('__CONVERSATION_ID__')) {
          const match = line.match(/__CONVERSATION_ID__(.+?)__END_CONVERSATION_ID__/);
          if (match) {
            const newConversationId = match[1];
            console.log('💬 Received conversation ID:', newConversationId);
            setConversationId(newConversationId);
            // Refresh conversations list to include the new conversation
            loadConversationsList();
          }
          return;
        }

        // Check for tool data
        if (line.includes('__TOOL_DATA__')) {
          const match = line.match(/__TOOL_DATA__(.+?)__END_TOOL_DATA__/);
          if (match) {
            try {
              toolData = JSON.parse(match[1]);
              console.log('📦 Received tool data:', toolData);
            } catch (e) {
              console.error('Failed to parse tool data:', e);
            }
          }
          return;
        }

        if (line.startsWith('0:')) {
          if (!toolMarkedDone) {
            toolMarkedDone = true;
            setToolStatus((prev) => prev ? { ...prev, done: true } : null);
          }
          try {
            const data = JSON.parse(line.substring(2).trim());
            if (typeof data === 'string') {
              fullResponse += data;
              setStreamingContent(fullResponse);
            }
          } catch {
            const lineText = line.substring(2).trim();
            if (lineText && !lineText.startsWith('{')) {
              fullResponse += lineText;
              setStreamingContent(fullResponse);
            }
          }
        } else if (line.startsWith('data:')) {
          try {
            const data = JSON.parse(line.substring(5).trim());
            if (data.type === 'text-delta' && data.delta) {
              fullResponse += data.delta;
              setStreamingContent(fullResponse);
            }
          } catch {}
        }
      };
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        streamBuffer += decoder.decode(value, { stream: true });
        const lines = streamBuffer.split('\n');
        streamBuffer = lines.pop() ?? '';

        for (const line of lines) {
          processStreamLine(line);
        }
      }

      streamBuffer += decoder.decode();
      if (streamBuffer) {
        for (const line of streamBuffer.split('\n')) {
          processStreamLine(line);
        }
      }
      
      const isScreenQuery = false;

      // Build canvas data - prefer tool data, then optional text extraction fallback.
      // For screen/vector queries, avoid text-based fallback so we keep a clean prose-only answer.
      let extractedCanvas = buildCanvasFromToolData(toolData, text);
      if (!extractedCanvas && !isScreenQuery) {
        extractedCanvas = extractCanvasData(fullResponse, text);
      }
      
      if (extractedCanvas) {
        setCanvasData(extractedCanvas);
      }
      
      // Clean content if canvas is showing
      const displayContent = extractedCanvas 
        ? cleanContentForDisplay(fullResponse)
        : fullResponse;
      
      // Show follow-up suggestion chips for all modes
      const toolReplyChips = (toolData as any)?.reply_chips as string[] | undefined;
      const td = toolData as any;
      const replyChips = toolReplyChips && toolReplyChips.length > 0
        ? toolReplyChips
        : td?.weeklyOverview ? ['Show my trends', 'Any unusual days?', 'How does this compare to last month?']
        : td?.dailyOverview ? ['What did I work on today?', 'Show my weekly recap', 'Any anomalies this week?']
        : td?.monthlyOverview ? ['Compare to last month', 'Show my trends', 'What were my best days?']
        : td?.trends ? ['Show weekly recap', 'Any anomalies?', 'What habits are improving?']
        : td?.stats ? ['Show daily breakdown', 'Compare with another habit', 'Any unusual days?']
        : td?.screenRecordings ? ['Summarize my day', 'What else did I work on?', 'Show weekly recap']
        : undefined;

      const assistantMessage: Message = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: displayContent || 'I was unable to process your request.',
        canvasData: extractedCanvas,
        replyChips: replyChips,  // Phase 4A
      };
      
      setMessages([...newMessages, assistantMessage]);
      setStreamingContent('');
      void loadMemoryFacts();
      return true;
    } catch (error) {
      console.error('Chat error:', error);
      setMessages([...newMessages, {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: 'Sorry, there was an error processing your request. Please try again.',
      }]);
      return false;
    } finally {
      setIsLoading(false);
      setCurrentQuestion('');
      setToolStatus(null);
    }
  }, [messages, isLoading, getToken, conversationId, loadConversationsList, loadMemoryFacts, voiceStyleEnabled, queryClient, timezone, user?.id]);

  const runQueuedItem = useCallback(async (itemId: string) => {
    if (!conversationId || isLoading) return;
    const response = await fetch(`/api/conversations/${conversationId}/queue/${itemId}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      toast.error('Failed to start queued prompt.');
      return;
    }
    const data: ConversationQueueRunResponse = await response.json();
    if (data.stale) {
      toast.error('Queued prompt is stale because the conversation moved on.');
      await loadQueueItems(conversationId);
      return;
    }

    const success = await sendMessage(data.item.prompt_text);
    await fetch(`/api/conversations/${conversationId}/queue/${itemId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: success ? 'completed' : 'failed',
        error: success ? null : { message: 'Queued prompt failed during execution.' },
        auto_run: queueAutoRun,
      }),
    });
    await loadQueueItems(conversationId);
  }, [conversationId, isLoading, loadQueueItems, queueAutoRun, sendMessage]);

  useEffect(() => {
    if (!queueAutoRun || isLoading || !conversationId) return;
    const nextItem = queueItems.find((item) => item.status === 'pending');
    if (!nextItem) return;
    void runQueuedItem(nextItem.id);
  }, [conversationId, isLoading, queueAutoRun, queueItems, runQueuedItem]);

  const latestNotebook = useMemo(
    () => linkedArtifacts.find((artifact) => artifact.kind === 'notebook') || null,
    [linkedArtifacts],
  );
  const pendingFacts = useMemo(
    () => memoryFacts.filter((fact) => fact.status === 'pending'),
    [memoryFacts],
  );
  const activeFacts = useMemo(
    () => memoryFacts.filter((fact) => fact.status === 'active'),
    [memoryFacts],
  );

  const approveFact = useCallback(async (factId: string) => {
    const response = await fetch(`/api/ai-facts/${factId}/approve`, { method: 'POST' });
    if (!response.ok) {
      toast.error('Failed to approve fact.');
      return;
    }
    toast.success('Fact approved.');
    await loadMemoryFacts();
  }, [loadMemoryFacts]);

  const dismissFact = useCallback(async (factId: string) => {
    const response = await fetch(`/api/ai-facts/${factId}/dismiss`, { method: 'POST' });
    if (!response.ok) {
      toast.error('Failed to dismiss fact.');
      return;
    }
    toast.success('Fact dismissed.');
    await loadMemoryFacts();
  }, [loadMemoryFacts]);

  useEffect(() => {
    if (!initialQuestion) {
      initialQuestionSubmissionRef.current = null;
      return;
    }

    // Wait for explicit conversation loading to finish before processing ?q=
    if (isLoadingConversation) return;

    const normalizedQuestion = initialQuestion.trim();
    if (!normalizedQuestion) return;

    // StrictMode / Suspense remounts in dev can re-run this effect before
    // state updates settle. Guard with a ref keyed to the current question.
    if (initialQuestionSubmissionRef.current === normalizedQuestion) {
      return;
    }
    initialQuestionSubmissionRef.current = normalizedQuestion;

    // Clear the ?q= param first so route transitions and remounts don't
    // resubmit the same question while the first request is in flight.
    window.history.replaceState(null, '', '/chat');

    // Start a new conversation when coming from ?q= query param.
    setConversationId(null);
    setMessages([]);

    void sendMessage(normalizedQuestion);
  }, [initialQuestion, isLoadingConversation, sendMessage]);

  // Scroll the latest user message into view when a new query is sent
  useEffect(() => {
    if (messages.length > 0 && isLoading) {
      latestUserMessageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [messages.length, isLoading]);

  useEffect(() => {
    if (!textareaRef.current) return;
    textareaRef.current.style.height = 'auto';
    textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
  }, [input]);

  useEffect(() => () => {
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
    }
    suggestionsAbortRef.current?.abort();
  }, []);

  const handleCanvasResizeStart = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsResizingCanvas(true);
    resizeStateRef.current = {
      startX: e.clientX,
      startWidth: canvasWidth,
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (moveEvent: MouseEvent) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState) return;
      const delta = resizeState.startX - moveEvent.clientX;
      const nextWidth = Math.min(
        maxCanvasWidthForViewport,
        Math.max(MIN_CANVAS_WIDTH, resizeState.startWidth + delta),
      );
      setCanvasWidth(nextWidth);
    };

    const onMouseUp = () => {
      setIsResizingCanvas(false);
      resizeStateRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [canvasWidth, maxCanvasWidthForViewport]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    sendMessage(input.trim());
    setInput('');
  };

  const handleInputFocus = useCallback(() => {
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
    }
    setIsFocused(true);
    setSelectedSuggestionIndex(0);
    setKeyboardSuggestionActive(false);
  }, []);

  const handleInputBlur = useCallback(() => {
    blurTimeoutRef.current = setTimeout(() => {
      setIsFocused(false);
    }, 200);
  }, []);

  const handleSuggestionSelect = useCallback((suggestion: ChatSuggestion) => {
    const question = suggestion.text.trim();
    if (!question || isLoading) return;
    setInput('');
    setIsFocused(false);
    setKeyboardSuggestionActive(false);
    void sendMessage(question);
  }, [isLoading, sendMessage]);

  const visibleSuggestions = useMemo(
    () => suggestions.slice(0, MAX_VISIBLE_CHAT_SUGGESTIONS),
    [suggestions],
  );

  useEffect(() => {
    if (visibleSuggestions.length === 0) {
      if (selectedSuggestionIndex !== 0) setSelectedSuggestionIndex(0);
      return;
    }
    if (selectedSuggestionIndex >= visibleSuggestions.length) {
      setSelectedSuggestionIndex(0);
    }
  }, [selectedSuggestionIndex, visibleSuggestions]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const canUseSuggestions =
      isFocused &&
      visibleSuggestions.length > 0 &&
      input.trim().length > 0 &&
      !isLoading &&
      !isListening &&
      !isProcessingVoice;

    if (canUseSuggestions && e.key === 'ArrowDown') {
      e.preventDefault();
      setKeyboardSuggestionActive(true);
      setSelectedSuggestionIndex((prev) => (prev + 1) % visibleSuggestions.length);
      return;
    }

    if (canUseSuggestions && e.key === 'ArrowUp') {
      e.preventDefault();
      setKeyboardSuggestionActive(true);
      setSelectedSuggestionIndex((prev) => (prev - 1 + visibleSuggestions.length) % visibleSuggestions.length);
      return;
    }

    if (canUseSuggestions && e.key === 'Tab' && visibleSuggestions[selectedSuggestionIndex]) {
      e.preventDefault();
      handleSuggestionSelect(visibleSuggestions[selectedSuggestionIndex]);
      return;
    }

    if (
      canUseSuggestions &&
      e.key === 'Enter' &&
      !e.shiftKey &&
      keyboardSuggestionActive &&
      visibleSuggestions[selectedSuggestionIndex]
    ) {
      e.preventDefault();
      handleSuggestionSelect(visibleSuggestions[selectedSuggestionIndex]);
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const showSuggestions =
    isFocused &&
    input.trim().length > 0 &&
    visibleSuggestions.length > 0 &&
    !isLoading &&
    !isListening &&
    !isProcessingVoice;

  const suggestionList = (
    <div
      className={cn(
        "overflow-hidden transition-all duration-150 ease-out",
        showSuggestions ? "max-h-[104px] opacity-100 pt-1 pb-0" : "max-h-0 opacity-0",
      )}
    >
      <div className="max-h-[98px] overflow-y-auto border-t border-gray-200/70 pt-0.5">
        {visibleSuggestions.map((suggestion, idx) => (
          <button
            key={`${suggestion.type}-${idx}-${suggestion.text.slice(0, 24)}`}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => handleSuggestionSelect(suggestion)}
            onMouseEnter={() => {
              setSelectedSuggestionIndex(idx);
              setKeyboardSuggestionActive(true);
            }}
            className={cn(
              "group flex w-full items-center justify-between gap-3 px-0 py-[7px] text-left text-[13px] transition-colors",
              idx === selectedSuggestionIndex
                ? "text-gray-950"
                : "text-gray-500 hover:text-gray-900",
            )}
          >
            <span className="truncate leading-snug">{suggestion.text}</span>
            <ArrowUpRight
              className={cn(
                "h-3 w-3 flex-shrink-0 transition-colors",
                idx === selectedSuggestionIndex
                  ? "text-gray-500"
                  : "text-gray-300 group-hover:text-gray-500",
              )}
            />
          </button>
        ))}
      </div>
    </div>
  );

  const clearNativeVoiceTimers = useCallback(() => {
    if (nativeVoicePollRef.current) {
      clearInterval(nativeVoicePollRef.current);
      nativeVoicePollRef.current = null;
    }
    if (nativeVoiceAutoStopRef.current) {
      clearTimeout(nativeVoiceAutoStopRef.current);
      nativeVoiceAutoStopRef.current = null;
    }
    if (nativeVoiceFinalizeTimeoutRef.current) {
      clearTimeout(nativeVoiceFinalizeTimeoutRef.current);
      nativeVoiceFinalizeTimeoutRef.current = null;
    }
    if (nativeVoiceSilenceRafRef.current) {
      cancelAnimationFrame(nativeVoiceSilenceRafRef.current);
      nativeVoiceSilenceRafRef.current = null;
    }
    if (nativeVoiceSilenceTimerRef.current) {
      clearTimeout(nativeVoiceSilenceTimerRef.current);
      nativeVoiceSilenceTimerRef.current = null;
    }
    if (nativeVoiceSilenceAudioCtxRef.current) {
      nativeVoiceSilenceAudioCtxRef.current.close().catch(() => undefined);
      nativeVoiceSilenceAudioCtxRef.current = null;
    }
    nativeVoiceHadSpeechRef.current = false;
  }, []);

  const resetNativeVoiceSession = useCallback(async () => {
    clearNativeVoiceTimers();
    nativeVoiceTimestampRef.current = 0;
    setPartialTranscript(null);
    // Stop visualization mic stream
    setAudioStream((prev) => {
      if (prev) prev.getTracks().forEach((t) => t.stop());
      return null;
    });
    await clearNativeDesktopSpeechState().catch(() => undefined);
  }, [clearNativeVoiceTimers]);

  useEffect(() => {
    return () => {
      clearNativeVoiceTimers();
      if (voiceInputModeRef.current === 'native') {
        void stopNativeDesktopSpeechRecognition().catch(() => undefined);
      }
    };
  }, [clearNativeVoiceTimers]);

  const startNativeVoiceRecognition = useCallback(async () => {
    setVoiceError(null);
    setIsProcessingVoice(false);
    await resetNativeVoiceSession();
    if (!(await ensureMicrophonePermission())) {
      throw new Error('microphone-permission-denied');
    }

    // Parallel mic stream used purely to power the waveform. (Audio-level silence
    // detection is unreliable because Swift's AVAudioEngine effectively captures
    // the mic and WebKit's getUserMedia returns a near-silent duplicate.) We
    // detect end-of-speech via transcript stability in the poll loop below.
    nativeVoicePartialLastChangeRef.current = 0;
    nativeVoicePartialLastValueRef.current = '';
    let vizStream: MediaStream | null = null;
    try {
      vizStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      setAudioStream(vizStream);
    } catch {
      // Non-critical — waveform just won't animate.
    }

    try {
      await startNativeDesktopSpeechRecognition();
    } catch (error) {
      if (vizStream) {
        vizStream.getTracks().forEach((track) => track.stop());
        setAudioStream(null);
      }
      throw error;
    }

    voiceInputModeRef.current = 'native';
    setIsListening(true);

    const PARTIAL_STABLE_MS = 700;

    nativeVoicePollRef.current = window.setInterval(() => {
      void (async () => {
        try {
          const state = await getNativeDesktopSpeechState();

          // Transcript-stability auto-stop: fires on every tick regardless of
          // whether a new event arrived from Swift.
          if (
            voiceInputModeRef.current === 'native' &&
            nativeVoicePartialLastValueRef.current &&
            nativeVoicePartialLastChangeRef.current &&
            performance.now() - nativeVoicePartialLastChangeRef.current > PARTIAL_STABLE_MS
          ) {
            stopVoiceRecording();
            return;
          }

          if (!state.timestamp || state.timestamp <= nativeVoiceTimestampRef.current) {
            return;
          }
          nativeVoiceTimestampRef.current = state.timestamp;

          if (state.event === 'ritual:speech:partial') {
            if (state.transcript?.trim()) {
              partialTranscriptRef.current = state.transcript;
              setPartialTranscript(state.transcript);
              if (state.transcript !== nativeVoicePartialLastValueRef.current) {
                nativeVoicePartialLastValueRef.current = state.transcript;
                nativeVoicePartialLastChangeRef.current = performance.now();
              }
            }
            return;
          }

          if (state.event === 'ritual:speech:final') {
            await resetNativeVoiceSession();
            partialTranscriptRef.current = null;
            setPartialTranscript(null);
            setIsListening(false);
            setIsProcessingVoice(false);
            if (state.transcript?.trim()) {
              setInput(state.transcript);
              setTimeout(() => textareaRef.current?.focus(), 100);
            } else {
              setVoiceError('No speech detected. Please try again.');
            }
            return;
          }

          if (state.event === 'ritual:speech:error') {
            await resetNativeVoiceSession();
            setPartialTranscript(null);
            setIsListening(false);
            setIsProcessingVoice(false);
            setVoiceError(formatNativeSpeechError(state.transcript));
            return;
          }

          if (state.event === 'ritual:speech:status' && state.transcript === 'stopped') {
            await resetNativeVoiceSession();
            setPartialTranscript(null);
            setIsListening(false);
            setIsProcessingVoice(false);
            setVoiceError('No speech detected. Please try again.');
          }
        } catch (pollError: any) {
          await resetNativeVoiceSession();
          setIsListening(false);
          setIsProcessingVoice(false);
          setVoiceError(`Voice error: ${pollError?.message || 'Unknown native speech error'}`);
        }
      })();
    }, 75);

    nativeVoiceAutoStopRef.current = window.setTimeout(() => {
      stopVoiceRecording();
    }, 10000);
  }, [resetNativeVoiceSession]);

  const whisperVoiceEnabled =
    (process.env.NEXT_PUBLIC_VOICE_USE_WHISPER ?? '1') !== '0';
  const deepgramVoicePreferred = false;

  const normalizeVoiceTranscript = (text: string): string => {
    return text.trim().replace(/[.?!]\s*$/, '');
  };

  const { start: startDeepgramDictation, stop: stopDeepgramDictation, isSupported: deepgramSupported } =
    useDeepgramDictation({
      language: 'en-US',
      model: 'nova-3',
      punctuate: false,
      smartFormat: false,
      numerals: true,
      endpointingMs: 900,
      utteranceEndMs: 1600,
      maxDurationMs: 15000,
      keyterms: [
        'Ritual',
        'coding',
        'computer time',
        'screen time',
        'caffeine',
        'nicotine',
        'sleep',
        'workout',
        'reading',
        'spending',
        'heart rate',
        'steps',
        'car miles',
        'pages',
        'miles',
      ],
      onAudioStreamChange: setAudioStream,
      onListeningChange: setIsListening,
      onProcessingChange: setIsProcessingVoice,
      onInterimTranscriptChange: (text) => {
        partialTranscriptRef.current = text;
        setPartialTranscript(text);
      },
      onFinalTranscript: (text) => {
        partialTranscriptRef.current = null;
        setPartialTranscript(null);
        setInput(normalizeVoiceTranscript(text));
        setTimeout(() => textareaRef.current?.focus(), 100);
      },
      onError: setVoiceError,
    });

  const startWhisperRecording = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    voiceInputModeRef.current = 'whisper';
    setAudioStream(stream);
    setIsListening(true);
    setIsProcessingVoice(false);

    let mimeType = '';
    const supportedTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/wav'];
    for (const type of supportedTypes) {
      if (MediaRecorder.isTypeSupported(type)) {
        mimeType = type;
        break;
      }
    }

    const mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    const audioChunks: Blob[] = [];

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) audioChunks.push(event.data);
    };

    mediaRecorder.onstop = async () => {
      setIsListening(false);
      setIsProcessingVoice(true);
      stream.getTracks().forEach(track => track.stop());
      setAudioStream(null);

      if (audioChunks.length === 0) {
        setVoiceError('No audio recorded. Please try again.');
        setIsProcessingVoice(false);
        return;
      }

      const audioBlob = new Blob(audioChunks, { type: mimeType || 'audio/wav' });

      try {
        const formData = new FormData();
        const ext = mimeType.includes('webm') ? 'webm' : mimeType.includes('mp4') ? 'mp4' : 'wav';
        formData.append('file', audioBlob, `audio.${ext}`);

        const response = await fetch('/api/whisper', { method: 'POST', body: formData });

        if (response.ok) {
          const result = await response.json();
          if (result.text?.trim()) {
            setInput(normalizeVoiceTranscript(result.text));
            setTimeout(() => textareaRef.current?.focus(), 100);
          } else {
            setVoiceError('No speech detected. Please try again.');
          }
        } else {
          setVoiceError('Failed to transcribe audio. Please try again.');
        }
      } catch {
        setVoiceError('Failed to process voice input. Please try again.');
      }
      setIsProcessingVoice(false);
    };

    mediaRecorder.start(100);

    const autoStopTimer = window.setTimeout(() => {
      if (mediaRecorder.state === 'recording') mediaRecorder.stop();
    }, 10000);

    (window as any).__mediaRecorder = mediaRecorder;
    (window as any).__autoStopTimer = autoStopTimer;

    let vadRaf = 0;
    let vadCtx: AudioContext | null = null;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      vadCtx = new AudioCtx();
      const source = vadCtx.createMediaStreamSource(stream);
      const analyser = vadCtx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.2;
      source.connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);

      const ARM_RMS = 0.02;
      const SPEECH_RMS = 0.01;
      const SILENCE_MS = 900;
      const MIN_RECORDING_MS = 1200;
      const recordingStartedAt = performance.now();
      let armed = false;
      let lastLoudAt = 0;
      let triggered = false;

      const tick = () => {
        if (triggered || mediaRecorder.state !== 'recording') return;
        analyser.getByteTimeDomainData(buf);
        let sumSq = 0;
        for (let i = 0; i < buf.length; i++) {
          const n = (buf[i] - 128) / 128;
          sumSq += n * n;
        }
        const rms = Math.sqrt(sumSq / buf.length);
        const now = performance.now();

        if (!armed) {
          if (rms > ARM_RMS) {
            armed = true;
            lastLoudAt = now;
          }
        } else if (rms > SPEECH_RMS) {
          lastLoudAt = now;
        } else if (
          now - lastLoudAt > SILENCE_MS &&
          now - recordingStartedAt > MIN_RECORDING_MS
        ) {
          triggered = true;
          if (mediaRecorder.state === 'recording') mediaRecorder.stop();
          return;
        }
        vadRaf = requestAnimationFrame(tick);
      };
      vadRaf = requestAnimationFrame(tick);
    } catch {
      // VAD is best-effort only.
    }

    (window as any).__vadCleanup = () => {
      if (vadRaf) cancelAnimationFrame(vadRaf);
      if (vadCtx && vadCtx.state !== 'closed') vadCtx.close().catch(() => undefined);
    };
  };

  // Voice recording
  const startVoiceRecognition = async () => {
    if (isListening) {
      stopVoiceRecording();
      return;
    }
    if (isProcessingVoice) {
      return;
    }

    setVoiceError(null);
    if (deepgramVoicePreferred && deepgramSupported) {
      try {
        voiceInputModeRef.current = 'deepgram';
        await startDeepgramDictation();
        return;
      } catch {
        voiceInputModeRef.current = null;
        setIsListening(false);
        setIsProcessingVoice(false);
      }
    }
    if (isTauri() && whisperVoiceEnabled && typeof MediaRecorder !== 'undefined') {
      try {
        await startWhisperRecording();
        return;
      } catch {
        voiceInputModeRef.current = null;
        setIsListening(false);
        setIsProcessingVoice(false);
      }
    }

    if (isTauri()) {
      try {
        await startNativeVoiceRecognition();
        return;
      } catch {
        await resetNativeVoiceSession().catch(() => undefined);
        setIsListening(false);
        setIsProcessingVoice(false);
        voiceInputModeRef.current = null;
      }
    }

    try {
      await startWhisperRecording();
    } catch (err: any) {
      voiceInputModeRef.current = null;
      const nativeMessage = getNativeSpeechErrorMessage(err);
      setVoiceError(
        err?.name === 'NotAllowedError'
          ? 'Microphone access denied. Enable it in System Settings > Privacy & Security > Microphone.'
          : formatNativeSpeechError(nativeMessage),
      );
      setIsListening(false);
      setIsProcessingVoice(false);
    }
  };

  const stopVoiceRecording = () => {
    if (voiceInputModeRef.current === 'deepgram') {
      stopDeepgramDictation();
      voiceInputModeRef.current = null;
      return;
    }

    if (voiceInputModeRef.current === 'native') {
      if (nativeVoiceAutoStopRef.current) {
        clearTimeout(nativeVoiceAutoStopRef.current);
        nativeVoiceAutoStopRef.current = null;
      }
      if (nativeVoiceFinalizeTimeoutRef.current) {
        clearTimeout(nativeVoiceFinalizeTimeoutRef.current);
      }

      // Commit whatever partial transcript we already have *immediately* so the
      // user sees their text without waiting for Swift's final-event round trip.
      // Read from the ref so callers from stale closures (poll loop, auto-stop)
      // see the latest value.
      const liveTranscript = partialTranscriptRef.current?.trim();
      partialTranscriptRef.current = null;
      setIsListening(false);
      if (liveTranscript) {
        setInput(liveTranscript);
        setPartialTranscript(null);
        setIsProcessingVoice(false);
        setTimeout(() => textareaRef.current?.focus(), 0);
      } else {
        setIsProcessingVoice(true);
      }

      void stopNativeDesktopSpeechRecognition()
        .catch((error: any) => {
          if (!liveTranscript) {
            setVoiceError(`Voice error: ${error?.message || 'Failed to stop native speech recognition.'}`);
          }
          return Promise.resolve();
        })
        .finally(() => {
          // If we already committed a live transcript, just tear down quietly
          // and ignore the lagging final event.
          if (liveTranscript) {
            void resetNativeVoiceSession();
            voiceInputModeRef.current = null;
            return;
          }
          nativeVoiceFinalizeTimeoutRef.current = window.setTimeout(() => {
            void resetNativeVoiceSession();
            setIsProcessingVoice(false);
            voiceInputModeRef.current = null;
            setVoiceError('No speech detected. Please try again.');
          }, 800);
        });
      return;
    }

    const mediaRecorder = (window as any).__mediaRecorder;
    const autoStopTimer = (window as any).__autoStopTimer;
    const vadCleanup = (window as any).__vadCleanup;
    if (autoStopTimer) clearTimeout(autoStopTimer);
    if (typeof vadCleanup === 'function') {
      vadCleanup();
      (window as any).__vadCleanup = null;
    }
    if (mediaRecorder?.state === 'recording') mediaRecorder.stop();
    voiceInputModeRef.current = null;
    if (audioStream) {
      audioStream.getTracks().forEach(track => track.stop());
      setAudioStream(null);
    }
    setIsListening(false);
  };

  // Loading conversation state
  if (isLoadingConversation) {
    return (
      <div className="h-full flex flex-col bg-[var(--content-bg)] relative">
        <div className="flex-1 flex items-center justify-center">
          <div className="flex items-center gap-2">
            <BrailleSpinner className="text-base text-gray-400" />
            <span className="text-gray-500 text-sm">Loading conversation...</span>
          </div>
        </div>
      </div>
    );
  }

  // Pending first message state: show the query immediately while the stream boots.
  if (messages.length === 0 && isLoading && currentQuestion.trim()) {
    return (
      <div className="h-full w-full min-w-0 flex bg-[var(--content-bg)] relative overflow-hidden">
        {renderCollapsedSidebarToggle()}

        <div className="flex-1 min-w-0 overflow-x-hidden flex flex-col">
          <div className="flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="max-w-[680px] mx-auto px-8 pt-8 pb-32">
              <h1 className="text-2xl font-medium text-gray-900 leading-snug mb-6">
                {currentQuestion}
              </h1>
              {toolStatus && (
                <div className="flex items-center gap-2 py-2">
                  {toolStatus.done ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-500" />
                      <span className="text-sm text-neutral-500">{toolStatus.label.replace('...', '')}</span>
                    </>
                  ) : (
                    <TextShimmer className="text-sm" duration={0.75}>
                      {toolStatus.label}
                    </TextShimmer>
                  )}
                </div>
              )}
              {!toolStatus && isLoading && (
                <div className="flex items-center gap-2 py-2">
                  <TextShimmer className="text-sm" duration={1.5}>
                    {'Thinking...'}
                  </TextShimmer>
                </div>
              )}
            </div>
          </div>

          <div className="sticky bottom-0 left-0 right-0 pb-6 pt-4 bg-gradient-to-t from-[rgba(252,252,252,0.86)] to-transparent backdrop-blur-lg">
            <div className="max-w-[680px] mx-auto px-8">
              <form onSubmit={handleSubmit}>
                <div className="bg-[rgba(247,247,247,0.85)] backdrop-blur-lg border border-gray-200/80 shadow-sm overflow-hidden transition-shadow">
                  <div className="px-4 py-2.5">
                    <textarea
                      ref={textareaRef}
                      value={isListening && partialTranscript ? partialTranscript : input}
                      onChange={(e) => {
                        setInput(e.target.value);
                        setSelectedSuggestionIndex(0);
                        setKeyboardSuggestionActive(false);
                      }}
                      onKeyDown={handleKeyDown}
                      onFocus={handleInputFocus}
                      onBlur={handleInputBlur}
                      placeholder={isListening ? 'Listening...' : 'Ask a follow-up question...'}
                      className="w-full resize-none border-0 outline-none text-[15px] text-gray-900 placeholder-gray-400 bg-transparent min-h-[22px] max-h-[96px]"
                      rows={1}
                      disabled={isLoading}
                      readOnly={isListening}
                    />
                  </div>
                  <div className="px-4">
                    {suggestionList}
                  </div>
                  {isListening && (
                    <div className="px-4 pb-1 flex flex-col items-center gap-1">
                      <div className="h-8 w-full max-w-[280px]">
                        <VoiceWaveform isActive={isListening} audioStream={audioStream} sensitivity={2.9} barWidth={4} barGap={2} />
                      </div>
                    </div>
                  )}
                  <div className="flex justify-between items-center px-3 pb-2.5">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2 group">
                        <button
                          type="button"
                          onClick={startVoiceRecognition}
                          disabled={isLoading}
                          className={cn(
                            "w-8 h-8 flex items-center justify-center transition-all duration-200",
                            isListening || isProcessingVoice
                              ? "text-gray-900"
                              : "text-gray-400 hover:text-gray-600",
                            "disabled:opacity-50"
                          )}
                          aria-label={isListening ? 'Stop recording' : 'Start voice recording'}
                        >
                          {isListening ? (
                            <VoiceWaveformMini isActive={isListening} />
                          ) : isProcessingVoice ? (
                            <BrailleSpinner className="text-sm text-gray-900" />
                          ) : (
                            <AudioLines className="w-[18px] h-[18px] stroke-[1.5]" />
                          )}
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          if (input.trim()) {
                            void queuePrompt(input.trim(), 'manual');
                          } else {
                            setIsQueueOpen((current) => !current);
                          }
                        }}
                        disabled={!conversationId}
                        className="rounded-md border border-gray-200 px-2.5 py-1.5 text-xs text-gray-500 transition-colors hover:border-gray-300 hover:text-gray-700 disabled:opacity-40"
                      >
                        {input.trim() ? 'Queue prompt' : `Queue (${queueItems.filter((item) => item.status === 'pending').length})`}
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsMemoryOpen(true)}
                        className="rounded-md border border-gray-200 px-2.5 py-1.5 text-xs text-gray-500 transition-colors hover:border-gray-300 hover:text-gray-700"
                      >
                        Memory ({pendingFacts.length})
                      </button>
                    </div>

                    <button
                      type="submit"
                      disabled={!input.trim() || isLoading}
                      className="w-8 h-8 flex items-center justify-center bg-black text-white rounded-sm transition-colors hover:bg-[#27251E] disabled:cursor-not-allowed"
                    >
                      <ArrowUp className={cn("w-4 h-4", isLoading && "opacity-70")} />
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const headerNavigation = headerCenterSlot
    ? createPortal(
        <ViewModeToggle currentView="chat" onViewChange={handleViewChange} />,
        headerCenterSlot,
      )
    : null;

  const renderConversationSidebar = () => (
    <AnimatePresence>
      {!isSidebarCollapsed && (
        <motion.aside
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 272, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
          className="h-full shrink-0 border-r border-[rgba(15,23,42,0.045)] flex flex-col overflow-hidden bg-[#f4f4f3] shadow-[inset_-1px_0_0_rgba(15,23,42,0.02)]"
        >
          <div className="px-3 pt-1.5 pb-2">
            <div className="flex items-center justify-between">
              <button
                onClick={() => router.push('/dashboard')}
                className="flex items-center gap-2 text-[#2f2c25] transition-opacity hover:opacity-75"
                title="Go to Dashboard"
              >
                <img src="/images/eclipse.svg" alt="Ritual" className="h-5 w-5 opacity-90" />
              </button>
              <button
                onClick={() => setIsSidebarCollapsed(true)}
                className="flex h-8 w-8 items-center justify-center text-gray-500 transition-colors hover:text-gray-700"
                title="Collapse sidebar"
              >
                <PanelRight className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-2">
              <button
                onClick={startNewConversation}
                className="flex w-full items-center justify-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-[13px] font-medium text-[#3d392f] transition-colors hover:border-gray-300"
                title="New Chat"
                aria-label="New Chat"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>New chat</span>
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-2.5 pb-3">
            <div className="mb-1.5 px-2 text-[10px] font-medium uppercase tracking-[0.12em] text-gray-400">
              Recent chats
            </div>
            <div className="flex flex-col gap-px">
              {isLoadingConversations ? (
                <div className="flex items-center justify-center py-6">
                  <BrailleSpinner className="text-sm text-gray-400" />
                </div>
              ) : conversations.length === 0 ? (
                <div className="rounded-md border border-dashed border-gray-300 px-4 py-6 text-center text-xs text-gray-400">
                  No conversations yet
                </div>
              ) : (
                conversations.slice(0, 10).map((conv) => {
                  const displayTitle = conv.first_message || conv.title || 'New conversation';
                  const truncatedTitle =
                    displayTitle.length > 36 ? `${displayTitle.substring(0, 36)}...` : displayTitle;

                  return (
                    <div
                      key={conv.id}
                      className="group flex items-center gap-1 rounded-md"
                      onContextMenu={(e) => showConversationContextMenu(conv.id, e)}
                    >
                      <button
                        onClick={() => switchConversation(conv.id)}
                        className={cn(
                          "flex-1 min-w-0 rounded-md px-2.5 py-1.5 text-left text-[13px] leading-[1.25rem] transition-colors",
                          conv.id === conversationId
                            ? "bg-white text-[#232119] shadow-[0_0_0_1px_rgba(15,23,42,0.03)]"
                            : "text-[#605b51] hover:bg-[#e5e5e5] hover:text-[#2f2c25]"
                        )}
                        title={displayTitle}
                      >
                        <span className="block truncate">{truncatedTitle}</span>
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteConversation(conv.id);
                        }}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 opacity-0 transition-all group-hover:opacity-100 hover:bg-[#e5e5e5] hover:text-gray-600"
                        title="Delete conversation"
                        aria-label="Delete conversation"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );

  function renderCollapsedSidebarToggle() {
    return isSidebarCollapsed && headerLeftSlot
      ? createPortal(
        <button
          onClick={() => setIsSidebarCollapsed(false)}
          className="flex h-8 w-8 items-center justify-center -ml-1 text-[rgb(87,88,89)] transition-colors hover:text-[#2f2c25]"
          title="Expand sidebar"
        >
          <SidebarToggleIcon className="h-[22px] w-[22px]" />
        </button>
        ,
        headerLeftSlot,
      )
      : null;
  }

  function renderConversationContextMenu() {
    if (!conversationContextMenu || typeof document === 'undefined') {
      return null;
    }

    const left = Math.min(conversationContextMenu.x, Math.max(12, window.innerWidth - 172));
    const top = Math.min(conversationContextMenu.y, Math.max(12, window.innerHeight - 72));

    return createPortal(
      <div className="fixed inset-0 z-[120]">
        <div className="absolute inset-0" />
        <div
          className="absolute min-w-[160px] rounded-md border border-[rgba(15,23,42,0.08)] bg-white p-1 shadow-[0_12px_30px_rgba(15,23,42,0.12)]"
          style={{ left, top }}
          onMouseDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button
            type="button"
            onClick={handleConversationContextDelete}
            className="flex w-full items-center rounded-md px-3 py-2 text-left text-[13px] text-[#2f2c25] transition-colors hover:bg-[#f3f2ef]"
          >
            Delete conversation
          </button>
        </div>
      </div>,
      document.body,
    );
  }

  // Empty state
  if (messages.length === 0 && !isLoading) {
    return (
      <>
        {headerNavigation}
        {renderConversationContextMenu()}
        <div className="h-full flex bg-white relative overflow-x-hidden">
        {renderConversationSidebar()}
        {renderCollapsedSidebarToggle()}

        {/* Main Content */}
        <div className="flex-1 flex flex-col min-w-0">

          <div className="flex-1 flex flex-col items-center justify-center p-6 pb-24">
            <div className="max-w-2xl w-full space-y-4">
              {/* Logo + Greeting */}
              <div className="flex flex-col items-center gap-2 mb-1">
                <div className="relative flex h-12 w-12 items-center justify-center">
                  <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle,rgba(15,23,42,0.08)_0%,rgba(15,23,42,0)_72%)] blur-sm" />
                  <img
                    src="/images/eclipse.svg"
                    alt="Ritual"
                    className="relative h-8 w-8 opacity-70 saturate-[0.8]"
                  />
                </div>
                <h1 className="text-[26px] font-normal text-gray-900 tracking-tight">
                  Welcome to Ritual
                </h1>
              </div>

              {/* Input — clean rounded card */}
              <form onSubmit={handleSubmit} className="relative">
                <div
                  className="border border-gray-300 rounded-sm overflow-hidden transition-shadow focus-within:shadow-md focus-within:border-gray-400/80"
                  style={{ backgroundColor: CHAT_PAGE_CARD_BG }}
                >
                  <textarea
                    ref={textareaRef}
                    value={isListening && partialTranscript ? partialTranscript : input}
                    onChange={(e) => {
                      setInput(e.target.value);
                      setSelectedSuggestionIndex(0);
                      setKeyboardSuggestionActive(false);
                    }}
                    onKeyDown={handleKeyDown}
                    onFocus={handleInputFocus}
                    onBlur={handleInputBlur}
                    placeholder={isListening ? 'Listening...' : 'Ask about your personal data'}
                    className="w-full resize-none border-0 outline-none text-[15px] text-gray-900 placeholder-gray-400 bg-transparent px-5 pt-3 pb-1.5 min-h-[48px] max-h-[96px]"
                    rows={1}
                    readOnly={isListening}
                  />
                  <div className="px-5">
                    {suggestionList}
                  </div>
                  {isListening && (
                    <div className="px-5 pb-1 flex justify-center">
                      <div className="h-8 w-full max-w-[280px]">
                        <VoiceWaveform isActive={isListening} audioStream={audioStream} sensitivity={2.9} barWidth={4} barGap={2} />
                      </div>
                    </div>
                  )}
                  <div className="flex justify-between items-center px-4 pb-2.5">
                    {/* Voice Input */}
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={startVoiceRecognition}
                        className={cn(
                          "w-8 h-8 flex items-center justify-center rounded-lg transition-all duration-200",
                          isListening || isProcessingVoice
                            ? "text-gray-900"
                            : "text-gray-400 hover:text-gray-600 hover:bg-gray-200/50"
                        )}
                      aria-label={isListening ? 'Stop recording' : 'Start voice recording'}
                    >
                      {isListening ? (
                        <VoiceWaveformMini isActive={isListening} />
                      ) : isProcessingVoice ? (
                        <BrailleSpinner className="text-sm text-gray-900" />
                      ) : (
                          <AudioLines className="w-[18px] h-[18px] stroke-[1.5]" />
                        )}
                      </button>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setIsMemoryOpen(true)}
                        className="rounded-md border border-gray-200 px-2.5 py-1.5 text-xs text-gray-500 transition-colors hover:border-gray-300 hover:text-gray-700"
                      >
                        Memory
                      </button>
                    </div>

                    {/* Submit Button */}
                    <button
                      type="submit"
                      disabled={!input.trim()}
                      className="w-8 h-8 flex items-center justify-center bg-black text-white rounded-sm transition-colors hover:bg-[#27251E] disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <ArrowUp className="w-4 h-4" />
                    </button>
                  </div>
                  {showConnectAppsBar ? (
                    <ConnectAppsBar
                      onOpenIntegrations={openIntegrationsPage}
                      onDismiss={dismissConnectAppsBar}
                    />
                  ) : null}
                </div>
              </form>

            </div>
          </div>
        </div>
        </div>
      </>
    );
  }

  // Chat view
  return (
    <>
      {headerNavigation}
      {renderConversationContextMenu()}
      <div className="h-full w-full min-w-0 flex bg-white relative overflow-hidden">
      {renderConversationSidebar()}
      {renderCollapsedSidebarToggle()}

      {/* Chat Area */}
      <div className={cn(
        "flex-1 min-w-0 overflow-x-hidden flex flex-col transition-all duration-300 ease-out",
        canvasData ? "pr-0" : ""
      )}>
        <div ref={scrollRef} className="flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">

          {/* Chat content - centered in available space */}
          <div className={cn(
            "pb-32 min-w-0 transition-all duration-300 mx-auto px-8 pt-8",
            canvasData ? "w-full max-w-none" : "max-w-[680px]"
          )}>
            {messages.map((message, messageIndex) => {
              // Find if this is the last user message
              const isLastUserMessage = message.role === 'user' && !messages.slice(messageIndex + 1).some(m => m.role === 'user');
              return (
              <div key={message.id} ref={isLastUserMessage ? latestUserMessageRef : undefined}>
                {message.role === 'user' ? (
                  <h1 className="text-2xl font-medium text-gray-900 leading-snug mb-6">
                    {message.content}
                  </h1>
                ) : (
                  <div className="mb-8">
                    <Response className="text-[14px] leading-[1.55] text-[#535353]">
                      {message.content}
                    </Response>
                    {/* Reply Chips (Phase 4A) - Only show for last assistant message in voice mode */}
                    {voiceStyleEnabled && 
                     message.replyChips && 
                     message.replyChips.length > 0 && 
                     messageIndex === messages.length - 1 && (
                      <div className="flex flex-wrap gap-2 mt-4">
                        {message.replyChips.map((chip, chipIndex) => (
                          <div key={chipIndex} className="flex items-center overflow-hidden rounded-full bg-gray-100">
                            <button
                              onClick={() => {
                                setInput(chip);
                                sendMessage(chip);
                              }}
                              disabled={isLoading}
                              className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-200 hover:text-gray-800 transition-colors disabled:opacity-50"
                            >
                              {chip}
                            </button>
                            <button
                              onClick={() => void queuePrompt(chip, 'reply_chip')}
                              disabled={!conversationId}
                              className="border-l border-gray-200 px-2 py-1.5 text-[11px] text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-700 disabled:opacity-40"
                            >
                              Queue
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    {messageIndex === messages.length - 1 ? (
                      <div className="mt-4 flex flex-wrap gap-2">
                        <Button variant="outline" onClick={() => void saveConversationArtifact('notebook', message)} disabled={!conversationId}>
                          <BookOpen className="h-3.5 w-3.5" />
                          Save as notebook
                        </Button>
                        <Button variant="outline" onClick={() => void appendToLatestNotebook(message)} disabled={!conversationId}>
                          <FilePenLine className="h-3.5 w-3.5" />
                          {latestNotebook ? 'Append to notebook' : 'Start notebook'}
                        </Button>
                        <Button variant="outline" onClick={() => void saveConversationArtifact('plan', message)} disabled={!conversationId}>
                          <ListTodo className="h-3.5 w-3.5" />
                          Turn into plan
                        </Button>
                        {latestNotebook ? (
                          <Button variant="outline" onClick={() => router.push(`/reports?artifactId=${latestNotebook.id}`)}>
                            Open linked notebook
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            );
            })}

            {streamingContent && (
              <div className="mb-8">
                <Response className="text-[14px] leading-[1.55] text-[#535353]">
                  {canvasData ? cleanContentForDisplay(streamingContent) : streamingContent}
                </Response>
              </div>
            )}
            
            {isLoading && !streamingContent && (
              <div className="flex items-center gap-2 py-2">
                {toolStatus ? (
                  toolStatus.done ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-500" />
                      <span className="text-sm text-neutral-500">{toolStatus.label.replace('...', '')}</span>
                    </>
                  ) : (
                    <TextShimmer className="text-sm" duration={0.75}>
                      {toolStatus.label}
                    </TextShimmer>
                  )
                ) : (
                  <TextShimmer className="text-sm" duration={1.5}>
                    {'Thinking...'}
                  </TextShimmer>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Input */}
        <div className="sticky bottom-0 left-0 right-0 pb-6 pt-4 bg-gradient-to-t from-white/80 to-transparent backdrop-blur-lg">
          <div className={cn(
            "mx-auto px-8 transition-all duration-300",
            canvasData ? "w-full max-w-none" : "max-w-[680px]"
          )}>
            <form onSubmit={handleSubmit}>
                <div className="bg-[rgba(247,247,247,0.85)] backdrop-blur-lg border border-gray-200/80 shadow-sm overflow-hidden transition-shadow">
                  <div className="px-4 py-3">
                    <textarea
                      ref={textareaRef}
                      value={isListening && partialTranscript ? partialTranscript : input}
                      onChange={(e) => {
                        setInput(e.target.value);
                        setSelectedSuggestionIndex(0);
                        setKeyboardSuggestionActive(false);
                      }}
                      onKeyDown={handleKeyDown}
                      onFocus={handleInputFocus}
                      onBlur={handleInputBlur}
                      placeholder={isListening ? 'Listening...' : 'Ask a follow-up question...'}
                      className="w-full resize-none border-0 outline-none text-[15px] text-gray-900 placeholder-gray-400 bg-transparent min-h-[22px] max-h-[96px]"
                      rows={1}
                      disabled={isLoading}
                      readOnly={isListening}
                    />
                  </div>
                  <div className="px-4">
                    {suggestionList}
                  </div>
                  {isListening && (
                    <div className="px-4 pb-1 flex flex-col items-center gap-1">
                      <div className="h-8 w-full max-w-[280px]">
                        <VoiceWaveform isActive={isListening} audioStream={audioStream} sensitivity={2.9} barWidth={4} barGap={2} />
                      </div>
                    </div>
                  )}
                  <div className="flex justify-between items-center px-3 pb-2.5">
                  {/* Voice Input */}
                  <div className="flex items-center gap-3">
                    {/* Voice Recording Button */}
                    <div className="flex items-center gap-2 group">
                      <button
                        type="button"
                        onClick={startVoiceRecognition}
                        disabled={isLoading}
                        className={cn(
                          "w-8 h-8 flex items-center justify-center transition-all duration-200",
                          isListening || isProcessingVoice
                            ? "text-gray-900"
                            : "text-gray-400 hover:text-gray-600",
                          "disabled:opacity-50"
                        )}
                      aria-label={isListening ? 'Stop recording' : 'Start voice recording'}
                    >
                      {isListening ? (
                        <VoiceWaveformMini isActive={isListening} />
                      ) : isProcessingVoice ? (
                        <BrailleSpinner className="text-sm text-gray-900" />
                      ) : (
                          <AudioLines className="w-[18px] h-[18px] stroke-[1.5]" />
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (input.trim()) {
                          void queuePrompt(input.trim(), 'manual');
                        } else {
                          setIsQueueOpen((current) => !current);
                        }
                      }}
                      disabled={!conversationId}
                      className="rounded-md border border-gray-200 px-2.5 py-1.5 text-xs text-gray-500 transition-colors hover:border-gray-300 hover:text-gray-700 disabled:opacity-40"
                    >
                      {input.trim() ? 'Queue prompt' : `Queue (${queueItems.filter((item) => item.status === 'pending').length})`}
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsMemoryOpen(true)}
                      className="rounded-md border border-gray-200 px-2.5 py-1.5 text-xs text-gray-500 transition-colors hover:border-gray-300 hover:text-gray-700"
                    >
                      Memory ({pendingFacts.length})
                    </button>
                    <button
                      type="submit"
                      disabled={!input.trim() || isLoading}
                      className="w-8 h-8 flex items-center justify-center bg-black text-white rounded-sm transition-colors hover:bg-[#27251E] disabled:cursor-not-allowed"
                    >
                      <ArrowUp className={cn("w-4 h-4", isLoading && "opacity-70")} />
                    </button>
                  </div>
                </div>
              </div>
            </form>
            {conversationId ? (
              <div className="mt-3 rounded-sm border border-gray-200/80 bg-[rgba(247,247,247,0.72)] px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[12px] font-medium text-[#2f2c25]">Queued next steps</div>
                    <div className="text-[11px] text-gray-500">Persisted follow-ups for this conversation.</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 text-[11px] text-gray-500">
                      <span>Auto-run</span>
                      <Switch checked={queueAutoRun} onCheckedChange={setQueueAutoRun} />
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsQueueOpen((current) => !current)}
                      className="text-[11px] text-gray-500 underline-offset-2 hover:text-gray-700 hover:underline"
                    >
                      {isQueueOpen ? 'Hide queue' : 'Show queue'}
                    </button>
                  </div>
                </div>
                {isQueueOpen ? (
                  <div className="mt-3 space-y-2">
                    {queueItems.length ? queueItems.map((item) => (
                      <div key={item.id} className="flex items-start justify-between gap-3 rounded-md border border-gray-200 bg-white px-3 py-3">
                        <div className="min-w-0">
                          <div className="truncate text-[13px] text-[#2f2c25]">{item.prompt_text}</div>
                          <div className="mt-1 text-[11px] uppercase tracking-[0.08em] text-gray-400">{item.status}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          {item.status === 'pending' ? (
                            <button
                              type="button"
                              onClick={() => void runQueuedItem(item.id)}
                              className="rounded-md border border-gray-200 px-2 py-1 text-[11px] text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-800"
                            >
                              Run
                            </button>
                          ) : null}
                          {item.status === 'pending' ? (
                            <button
                              type="button"
                              onClick={async () => {
                                if (!conversationId) return;
                                await fetch(`/api/conversations/${conversationId}/queue/${item.id}`, {
                                  method: 'PATCH',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ status: 'canceled', auto_run: queueAutoRun }),
                                });
                                await loadQueueItems(conversationId);
                              }}
                              className="rounded-md border border-gray-200 px-2 py-1 text-[11px] text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-800"
                            >
                              Cancel
                            </button>
                          ) : null}
                        </div>
                      </div>
                    )) : (
                      <div className="rounded-md border border-dashed border-gray-200 bg-white px-3 py-4 text-[12px] text-gray-500">
                        No queued follow-ups yet.
                      </div>
                    )}
                  </div>
                ) : null}
                {linkedArtifacts.length ? (
                  <div className="mt-3 border-t border-gray-200 pt-3">
                    <div className="text-[11px] uppercase tracking-[0.08em] text-gray-400">Linked docs</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {linkedArtifacts.map((artifact) => (
                        <button
                          key={artifact.id}
                          type="button"
                          onClick={() => router.push(`/reports?artifactId=${artifact.id}`)}
                          className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-[12px] text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-800"
                        >
                          {artifact.title}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <Sheet open={isMemoryOpen} onOpenChange={setIsMemoryOpen}>
        <SheetContent side="right" className="w-full max-w-[460px] overflow-y-auto bg-[#fbfcff] px-6 py-6">
          <SheetHeader>
            <SheetTitle>Memory &amp; Rules</SheetTitle>
            <SheetDescription>
              Approved facts shape future prompts. Pending suggestions stay inactive until you approve them.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-6 space-y-5">
            <section className="rounded-[20px] border border-[rgba(15,23,42,0.08)] bg-white p-4">
              <div className="text-sm font-[650] uppercase tracking-[0.12em] text-[#6b7280]">Pending</div>
              <div className="mt-3 space-y-3">
                {pendingFacts.length ? pendingFacts.map((fact) => (
                  <div key={fact.id} className="rounded-[18px] border border-[rgba(15,23,42,0.08)] bg-[#fbfcfb] p-3">
                    <div className="text-sm font-[600] text-[#111827]">{fact.predicate}</div>
                    <pre className="mt-2 overflow-auto rounded-[14px] bg-white px-3 py-3 text-xs text-[#4b5563]">{JSON.stringify(fact.value, null, 2)}</pre>
                    <div className="mt-3 flex gap-2">
                      <Button variant="outline" onClick={() => void dismissFact(fact.id)}>Dismiss</Button>
                      <Button className="bg-[#111827] text-white hover:bg-[#1f2937]" onClick={() => void approveFact(fact.id)}>Approve</Button>
                    </div>
                  </div>
                )) : (
                  <div className="rounded-[18px] border border-dashed border-[rgba(15,23,42,0.12)] bg-[#fbfcfb] px-3 py-5 text-sm text-[#6b7280]">
                    No pending memory suggestions.
                  </div>
                )}
              </div>
            </section>
            <section className="rounded-[20px] border border-[rgba(15,23,42,0.08)] bg-white p-4">
              <div className="text-sm font-[650] uppercase tracking-[0.12em] text-[#6b7280]">Approved</div>
              <div className="mt-3 space-y-3">
                {activeFacts.map((fact) => (
                  <div key={fact.id} className="rounded-[18px] border border-[rgba(15,23,42,0.08)] bg-[#fbfcfb] p-3">
                    <div className="text-sm font-[600] text-[#111827]">{fact.predicate}</div>
                    <pre className="mt-2 overflow-auto rounded-[14px] bg-white px-3 py-3 text-xs text-[#4b5563]">{JSON.stringify(fact.value, null, 2)}</pre>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </SheetContent>
      </Sheet>

      {/* Canvas Side Panel */}
      <AnimatePresence>
        {canvasData && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: effectiveCanvasWidth, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 40 }}
            className="relative flex shrink-0 overflow-hidden will-change-transform"
          >
            <div
              onMouseDown={handleCanvasResizeStart}
              className="absolute left-0 top-0 z-20 h-full w-2 -translate-x-1 cursor-col-resize"
              aria-label="Resize side panel"
              role="separator"
              aria-orientation="vertical"
            >
              <div className={cn(
                "mx-auto h-full w-px transition-colors",
                isResizingCanvas ? "bg-gray-400" : "bg-gray-200 hover:bg-gray-300",
              )} />
            </div>

            <div className="w-full overflow-hidden">
              <HabitCanvas 
                data={canvasData} 
                onClose={() => setCanvasData(null)} 
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      </div>
    </>
  );
}
