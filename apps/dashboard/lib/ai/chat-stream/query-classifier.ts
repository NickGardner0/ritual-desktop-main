/**
 * Query classifier functions for intent detection and fast-path routing.
 *
 * Extracted from orchestrator.ts during Phase 3 refactoring.
 * These regex-based classifiers determine which tool to invoke
 * without requiring an OpenAI round-trip.
 */

import { getStrictThisWeekRange } from '@/lib/ai/chat-stream/weekly-overview-utils.mjs';
import {
  shiftYmd,
  parseRelativeTimeWindowMs,
} from './executors';
import {
  formatNarrativeDateLabel,
  parseExplicitRecapAnchorDate,
} from './narrative';

export type RetrievalRoute =
  | 'anchored_day_recap'
  | 'range_recap'
  | 'specific_lookup'
  | 'time_breakdown'
  | 'habit_metrics'
  | 'generic_chat';

// ---------------------------------------------------------------------------
// Core intent classifiers
// ---------------------------------------------------------------------------

export function isContextMemoryRecapQuery(text: string): boolean {
  const normalized = (text || '').toLowerCase().trim();
  if (!normalized) return false;

  if (isSpecificContextLookupQuery(normalized)) {
    return false;
  }

  const explicitPatterns = [
    'what did i work on',
    'what was i working on',
    'what did i get done',
    'what did i get done on',
    'what did i accomplish',
    'what did i accomplish on',
    'what did i do on',
    'what did i do this morning',
    'what did i do today',
    'what did i do this week',
    'what did i do this month',
    'what did i work on today',
    'what did i do on my computer',
    'what happened in ',
    'what file was i working on',
    'what was i looking at',
    'what planning work did i do',
    'work recap',
    'workday recap',
    'narrative work recap',
    'narrative recap',
    'summarize my workday',
    'summarize my day',
    'recap my workday',
    'activity recap',
    'activity overview',
    'screen recap',
    'screen overview',
  ];

  if (explicitPatterns.some((pattern) => normalized.includes(pattern))) {
    return true;
  }

  const hasWorkVerb = /\b(work(?:ed|ing)? on|get done|accomplish(?:ed)?|doing|look(?:ed|ing) at|happened in|planning|research|reading|recap|summary|summarize)\b/.test(normalized);
  const hasExplicitAnchor = hasRelativeTimeHint(normalized) || parseExplicitRecapAnchorDate(normalized) !== null;
  const hasHabitFocus = /\b(habit|habits|tracked)\b/.test(normalized);
  const hasDigitalContext = /\b(computer|screen|context|browser|website|app|apps|cursor|codex|chrome|slack|paper|finder|terminal|things)\b/.test(normalized);
  const hasNarrativeWorkTarget =
    /\b(work|workday|projects?|tools?|time blocks?|workflow|workflows)\b/.test(normalized)
    && hasExplicitAnchor;
  const hasContextTarget = hasDigitalContext || (hasExplicitAnchor && !hasHabitFocus);

  const scopedQuery =
    /\bin\s+(cursor|codex|chrome|google chrome|slack|paper|finder|terminal|things|gmail|mail|safari|arc|claude)\b/.test(normalized)
    || /\bat\s+\d{1,2}(?::\d{2})?\s*(am|pm)\b/.test(normalized);

  return (hasWorkVerb && hasContextTarget && !scopedQuery) || hasNarrativeWorkTarget;
}

export function isSpecificContextLookupQuery(text: string): boolean {
  const normalized = (text || '').toLowerCase().trim();
  if (!normalized) return false;
  const specificLookupPatterns = [
    'what was i doing in ',
    'what did i do in ',
    'what was i working on in ',
    'what was i debugging in ',
    'when did i ',
    'find when i ',
    'show me when ',
    'what apps did i use at ',
    'what was i looking at in ',
  ];
  return specificLookupPatterns.some((pattern) => normalized.includes(pattern));
}

export function isComprehensiveWeeklyRecapQuery(text: string): boolean {
  const normalized = (text || '').toLowerCase().trim();
  if (!normalized) return false;

  if (isContextMemoryRecapQuery(normalized)) {
    return false;
  }

  const broadWeeklyPatterns = [
    'weekly habit recap',
    'weekly habit summary',
    'how did my habits do this week',
    'how did my habits do last week',
    'habit breakdown this week',
    'habit breakdown last week',
  ];

  if (broadWeeklyPatterns.some((pattern) => normalized.includes(pattern))) {
    return true;
  }

  return /\b(this week|last week|past week)\b/.test(normalized) && /\b(habit|habits|tracked)\b/.test(normalized);
}

export function isDailyOverviewQuery(text: string): boolean {
  const normalized = (text || '').toLowerCase().trim();
  if (!normalized) return false;

  if (isContextMemoryRecapQuery(normalized)) {
    return false;
  }

  const dailyPatterns = [
    'daily recap',
    'daily summary',
    'habit recap today',
    'habit summary today',
    'today habit summary',
    'today habit overview',
    'how are my habits today',
    'how did my habits do today',
    'summarize my habits today',
  ];

  if (dailyPatterns.some((pattern) => normalized.includes(pattern))) {
    return true;
  }

  return normalized.includes('today') && /\b(habit|habits|tracked)\b/.test(normalized);
}

export function isMonthlyOverviewQuery(text: string): boolean {
  const normalized = (text || '').toLowerCase().trim();
  if (!normalized) return false;

  if (isContextMemoryRecapQuery(normalized)) {
    return false;
  }

  const monthlyPatterns = [
    'monthly recap',
    'monthly summary',
    'monthly habit summary',
    'habit recap this month',
    'how did my habits do this month',
    'last 30 days of habits',
  ];

  if (monthlyPatterns.some((pattern) => normalized.includes(pattern))) {
    return true;
  }

  return (normalized.includes('this month') || normalized.includes('last 30 days')) && /\b(habit|habits|tracked)\b/.test(normalized);
}

export function isExplicitThisWeekQuery(text: string): boolean {
  const normalized = (text || '').toLowerCase();
  return normalized.includes('this week');
}

export function isExplicitLastWeekQuery(text: string): boolean {
  const normalized = (text || '').toLowerCase();
  return normalized.includes('last week');
}

export function isScreenTimeSpentQuery(text: string): boolean {
  const normalized = (text || '').toLowerCase().trim();
  if (!normalized) return false;

  const explicitPatterns = [
    'how much time did i spend',
    'what did i spend my time on',
    'what did i spend time on',
    'where did my time go',
    'time spent on',
    'spent the most time',
    'spend the most time',
    'which app did i spend',
    'which apps did i spend',
    'computer time spent',
  ];

  if (explicitPatterns.some((pattern) => normalized.includes(pattern))) {
    return true;
  }

  const hasSpendVerb = /(spent|spend|spending|time allocation|time breakdown)/.test(normalized);
  const hasComputerContext = /(computer|screen|app|apps|browser|website|ocr|recording|desktop)/.test(normalized);
  return hasSpendVerb && hasComputerContext;
}

export function hasRelativeTimeHint(text: string): boolean {
  const normalized = (text || '').toLowerCase();
  if (!normalized) return false;
  if (parseRelativeTimeWindowMs(normalized) !== null) return true;
  return /\b(today|yesterday|this week|last week|this month|last month)\b/.test(normalized);
}

export function isBroadScreenOverviewQuery(text: string): boolean {
  const normalized = (text || '').toLowerCase().trim();
  if (!normalized) return false;
  const patterns = [
    'what did i work on',
    'what was i working on',
    'what was i doing',
    'what did i do',
    'show me what i was doing',
    'activity recap',
    'activity overview',
    'screen recap',
    'screen overview',
  ];
  return patterns.some((pattern) => normalized.includes(pattern));
}

export function classifyRetrievalRoute(text: string): RetrievalRoute {
  const normalized = (text || '').toLowerCase().trim();
  if (!normalized) return 'generic_chat';

  if (isScreenTimeSpentQuery(normalized)) return 'time_breakdown';
  if (isSpecificContextLookupQuery(normalized)) return 'specific_lookup';
  if (isDailyOverviewQuery(normalized) || isMonthlyOverviewQuery(normalized) || isComprehensiveWeeklyRecapQuery(normalized)) {
    return 'habit_metrics';
  }
  if (isContextMemoryRecapQuery(normalized)) {
    if (
      parseExplicitRecapAnchorDate(normalized) !== null
      || /\b(today|yesterday|this morning|this afternoon|this evening|tonight|last night)\b/.test(normalized)
    ) {
      return 'anchored_day_recap';
    }
    return 'range_recap';
  }
  return 'generic_chat';
}

// ---------------------------------------------------------------------------
// Query resolution helpers
// ---------------------------------------------------------------------------

export function resolveWeeklyOverviewParamsFromQuery(
  text: string,
  timezone?: string,
): { startDate?: string; endDate?: string; daysBack?: number; strictThisWeek?: boolean } {
  if (isExplicitLastWeekQuery(text)) {
    const thisWeekRange = getStrictThisWeekRange(timezone || 'UTC', new Date());
    return {
      startDate: shiftYmd(thisWeekRange.startDate, -7),
      endDate: shiftYmd(thisWeekRange.startDate, -1),
      strictThisWeek: false,
    };
  }

  if (isExplicitThisWeekQuery(text)) {
    return {
      daysBack: 7,
      strictThisWeek: true,
    };
  }

  return {
    daysBack: 7,
    strictThisWeek: false,
  };
}

export function getOverviewTitleFromQuery(
  toolName: string | null,
  query: string,
  contextMemoryRecap?: unknown,
  timezone?: string,
): string {
  if (toolName === 'getDailyOverview') return 'Daily Activity Overview';
  if (toolName === 'getActivitySummary') {
    return formatNarrativeDateLabel((contextMemoryRecap || {}) as { results?: Array<{ timestamp?: string }>; days_searched?: number }, query, timezone);
  }
  if (toolName === 'searchContextMemory') {
    return formatNarrativeDateLabel((contextMemoryRecap || {}) as { results?: Array<{ timestamp?: string }>; days_searched?: number }, query, timezone);
  }
  if (toolName === 'getMonthlyOverview') return 'Monthly Activity Overview';
  if (toolName === 'getWeeklyOverview' && isExplicitLastWeekQuery(query)) {
    return 'Last Week Overview';
  }
  return 'Weekly Activity Overview';
}

export function chooseScreenSearchQuery(toolQuery: unknown, userQuery: string): string {
  const toolText = String(toolQuery || '').trim();
  const userText = String(userQuery || '').trim();
  if (!userText) return toolText;
  if (!toolText) return userText;

  const toolNormalized = toolText.toLowerCase();
  const userNormalized = userText.toLowerCase();

  const toolGeneric = (
    toolNormalized === 'what was i working on'
    || toolNormalized === 'what was i doing'
    || toolNormalized === 'what did i do'
  );
  const appearsTruncated = userNormalized.includes(toolNormalized) && (toolText.length + 8 < userText.length);
  const userHasWindow = hasRelativeTimeHint(userText);
  const toolHasWindow = hasRelativeTimeHint(toolText);

  if (userHasWindow && !toolHasWindow) return userText;
  if (toolGeneric) return userText;
  if (appearsTruncated) return userText;
  return toolText;
}
