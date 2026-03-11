import { NextRequest } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import OpenAI from 'openai';
import { buildWeeklyOverviewCanvasPayload, getStrictThisWeekRange } from '@/lib/ai/chat-stream/weekly-overview-utils.mjs';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const PYTHON_API_BASE = process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';

// ====================
// VOICE MODE POST-PROCESSING (Phase 4A)
// ====================

function formatVoiceResponse(text: string): string {
  if (!text) return text;
  
  const MAX_CHARS = 650;
  const MAX_BULLETS = 3;
  
  let result = text;
  
  // Remove markdown tables (replace with simple text)
  // Note: Using RegExp constructor to avoid Tailwind extracting the pattern as a class
  result = result.replace(new RegExp('\\|[^\\n]+\\|', 'g'), '');
  result = result.replace(new RegExp('[\\-:]+\\|[\\-:|]+', 'g'), '');
  
  // Limit bullet lists to MAX_BULLETS items
  const bulletPattern = /^[\s]*[-*•]\s.+$/gm;
  const bullets = result.match(bulletPattern) || [];
  if (bullets.length > MAX_BULLETS) {
    // Keep only first MAX_BULLETS bullets
    let bulletCount = 0;
    result = result.replace(bulletPattern, (match) => {
      bulletCount++;
      return bulletCount <= MAX_BULLETS ? match : '';
    });
  }
  
  // Remove excessive newlines
  result = result.replace(/\n{3,}/g, '\n\n');
  
  // Trim to max characters (but don't cut mid-sentence if possible)
  if (result.length > MAX_CHARS) {
    // Try to cut at a sentence boundary
    const truncated = result.substring(0, MAX_CHARS);
    const lastSentenceEnd = Math.max(
      truncated.lastIndexOf('. '),
      truncated.lastIndexOf('? '),
      truncated.lastIndexOf('! ')
    );
    
    if (lastSentenceEnd > MAX_CHARS * 0.5) {
      result = truncated.substring(0, lastSentenceEnd + 1);
    } else {
      // Check if we're cutting important numeric content
      const hasNumbers = /\d+(\.\d+)?%?/.test(truncated.substring(MAX_CHARS - 100));
      if (hasNumbers) {
        console.warn('⚠️ Voice post-processing: skipping trim to preserve numeric content');
      } else {
        result = truncated + '...';
      }
    }
  }
  
  // Ensure response ends with a question (add generic one if missing)
  const trimmedResult = result.trim();
  if (!trimmedResult.endsWith('?')) {
    // Check if there's a question somewhere near the end
    const lastQuestionMark = trimmedResult.lastIndexOf('?');
    if (lastQuestionMark > trimmedResult.length - 100) {
      // There's a question near the end, just trim after it
      result = trimmedResult.substring(0, lastQuestionMark + 1);
    } else {
      // Add a generic follow-up question
      result = trimmedResult + '\n\nWant me to break this down further?';
    }
  }
  
  return result.trim();
}

// Generate reply chips based on tool results
function generateReplyChips(toolResults: Record<string, unknown>): string[] {
  const chips: string[] = [];

  if (toolResults.screenTimeSpent) {
    chips.push('Show app time table');
    chips.push('Show daily time table');
    chips.push('Last 30 days');
  }

  // Overview recap
  if (toolResults.weeklyOverview || toolResults.dailyOverview || toolResults.monthlyOverview) {
    chips.push('Show app breakdown');
    chips.push('Show daily tables');
    chips.push('Compare periods');
  }
  
  // Based on trends data
  if (toolResults.trends) {
    const trends = toolResults.trends as { trends?: Array<{ habit_name: string }> };
    if (trends.trends && trends.trends.length > 0) {
      const topHabit = trends.trends[0].habit_name;
      chips.push(`Show anomalies for ${topHabit}`.substring(0, 32));
      chips.push('Last 90 days');
    }
  }
  
  // Based on anomalies data
  if (toolResults.anomalies) {
    chips.push('Show trends');
    chips.push('Last 7 days');
  }
  
  // Based on stats/breakdown
  if (toolResults.stats || toolResults.dailyBreakdown) {
    chips.push('Last 7 days');
    chips.push('Last 30 days');
    chips.push('Show anomalies');
  }
  
  // Fallback generic chips
  if (chips.length === 0) {
    chips.push('Last 7 days');
    chips.push('Last 30 days');
    chips.push('Show insights');
  }
  
  // Dedupe and limit to 3
  return [...new Set(chips)].slice(0, 3);
}

type ChatToolResults = {
  stats?: any[];
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
  allStats?: any[];
  allBreakdowns?: { habit: any; data: any[] }[];
  suggested_followups?: string[];
  reply_chips?: string[];
};

function buildCanvasToolPayload(toolResults: ChatToolResults): Record<string, unknown> | null {
  const payload: Record<string, unknown> = {
    stats: toolResults.stats,
    dailyBreakdown: toolResults.dailyBreakdown,
    dailyBreakdownHabit: toolResults.dailyBreakdownHabit,
    correlation: toolResults.correlation,
    trends: toolResults.trends,
    anomalies: toolResults.anomalies,
    screenRecordings: toolResults.screenRecordings,
    screenTimeSpent: toolResults.screenTimeSpent,
    weeklyOverview: toolResults.weeklyOverview,
    dailyOverview: toolResults.dailyOverview,
    monthlyOverview: toolResults.monthlyOverview,
    allStats: toolResults.allStats,
    allBreakdowns: toolResults.allBreakdowns,
    suggested_followups: toolResults.suggested_followups,
    reply_chips: toolResults.reply_chips,
  };

  for (const key of Object.keys(payload)) {
    const value = payload[key];
    if (value === undefined || value === null) {
      delete payload[key];
      continue;
    }
    if (Array.isArray(value) && value.length === 0) {
      delete payload[key];
    }
  }

  return Object.keys(payload).length > 0 ? payload : null;
}

function compactScreenWarning(raw: unknown): string | undefined {
  const text = String(raw || '').trim();
  if (!text) return undefined;

  const noisyPatterns = [
    /cloud semantic retrieval returned no grounded evidence/gi,
    /semantic intent is fail-closed/gi,
    /some semantic results may be missing while embeddings finish processing/gi,
    /semantic retrieval is degraded; using lexical-first fallback where needed/gi,
    /no cloud semantic evidence matched query in selected range/gi,
  ];

  let normalized = text;
  for (const pattern of noisyPatterns) {
    normalized = normalized.replace(pattern, '');
  }
  normalized = normalized
    .replace(/\s+/g, ' ')
    .replace(/\.\s*\./g, '.')
    .trim();

  if (!normalized) {
    return 'Semantic evidence is still catching up, so this summary relies more on activity signals.';
  }

  const firstSentence = normalized.split(/(?<=[.!?])\s+/).find((part) => part.trim().length > 0) || normalized;
  return firstSentence.trim();
}

function isComprehensiveWeeklyRecapQuery(text: string): boolean {
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

function isDailyOverviewQuery(text: string): boolean {
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

function isMonthlyOverviewQuery(text: string): boolean {
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

function isExplicitThisWeekQuery(text: string): boolean {
  const normalized = (text || '').toLowerCase();
  return normalized.includes('this week');
}

function isScreenTimeSpentQuery(text: string): boolean {
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

function hasRelativeTimeHint(text: string): boolean {
  const normalized = (text || '').toLowerCase();
  if (!normalized) return false;
  if (parseRelativeTimeWindowMs(normalized) !== null) return true;
  return /\b(today|yesterday|this week|last week|this month|last month)\b/.test(normalized);
}

function isBroadScreenOverviewQuery(text: string): boolean {
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

function isContextMemoryRecapQuery(text: string): boolean {
  const normalized = (text || '').toLowerCase().trim();
  if (!normalized) return false;

  const explicitPatterns = [
    'what did i work on',
    'what was i working on',
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
    'activity recap',
    'activity overview',
    'screen recap',
    'screen overview',
  ];

  if (explicitPatterns.some((pattern) => normalized.includes(pattern))) {
    return true;
  }

  const hasWorkVerb = /\b(work(?:ed|ing)? on|doing|look(?:ed|ing) at|happened in|planning|research|reading)\b/.test(normalized);
  const hasContextTarget =
    hasRelativeTimeHint(normalized) ||
    /\b(computer|screen|context|browser|website|app|apps|cursor|codex|chrome|slack|paper|finder|terminal|things)\b/.test(normalized);

  return hasWorkVerb && hasContextTarget;
}

function chooseScreenSearchQuery(toolQuery: unknown, userQuery: string): string {
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

function formatNarrativeDateLabel(
  payload: { results?: Array<{ timestamp?: string }>; days_searched?: number },
  query: string,
  timezone?: string,
): string {
  const normalizedQuery = (query || '').toLowerCase();
  if (normalizedQuery.includes('this morning')) return 'This Morning';
  if (normalizedQuery.includes('this afternoon')) return 'This Afternoon';
  if (normalizedQuery.includes('this evening') || normalizedQuery.includes('tonight')) return 'This Evening';
  if (normalizedQuery.includes('today')) return 'Your Day So Far';

  const firstTimestamp = payload.results?.find((item) => item?.timestamp)?.timestamp;
  if (!firstTimestamp) {
    return payload.days_searched === 1 ? 'Recent Activity' : `Last ${payload.days_searched || 7} Days`;
  }

  const label = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone || 'UTC',
    month: 'short',
    day: 'numeric',
  }).format(new Date(firstTimestamp));
  return `Activity Summary (${label})`;
}

function clipContextText(value: unknown, limit = 160): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(limit - 3, 1)).trimEnd()}...`;
}

function formatContextTimestamp(value: unknown, timezone?: string): string {
  if (!value) return '';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone || 'UTC',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function buildContextMemoryNarrative(
  payload: any,
  query: string,
  timezone?: string,
): string {
  if (!payload?.success) {
    return payload?.error || 'I could not retrieve context memory for that question.';
  }

  const storyPlan = payload.story_plan || {};
  const renderer = payload.renderer || storyPlan.renderer || {};
  const rendererKind = renderer.kind || storyPlan.renderer_kind || 'topic_lookup';
  const results = Array.isArray(payload.results) ? payload.results : [];
  const mainEvent = storyPlan.main_event || null;
  const claimCards = Array.isArray(storyPlan.claim_cards) ? storyPlan.claim_cards : [];
  const supporting = Array.isArray(storyPlan.supporting_workstreams) ? storyPlan.supporting_workstreams : [];
  const researchBrowsing = Array.isArray(storyPlan.research_browsing) ? storyPlan.research_browsing : [];
  const personalActivity = Array.isArray(storyPlan.personal_activity) ? storyPlan.personal_activity : [];
  const tasks = Array.isArray(storyPlan.concrete_tasks_completed) ? storyPlan.concrete_tasks_completed : [];
  const documents = Array.isArray(storyPlan.document_items) ? storyPlan.document_items : [];
  const strongestEvidence = Array.isArray(storyPlan.strongest_evidence) ? storyPlan.strongest_evidence : [];
  const apps = Array.isArray(storyPlan.apps_and_tools_used) ? storyPlan.apps_and_tools_used : [];
  const timelineSegments = Array.isArray(storyPlan.timeline_segments) ? storyPlan.timeline_segments : [];
  const uncertainty = Array.isArray(storyPlan.uncertainty_or_conflicts) ? storyPlan.uncertainty_or_conflicts : [];
  const heading = formatNarrativeDateLabel(payload, query, timezone);
  const lines: string[] = [`## ${heading}`];

  if (!mainEvent && results.length === 0) {
    if (payload.message) lines.push('', payload.message);
    return lines.join('\n');
  }

  const mainClaim =
    claimCards.find((card: any) => card?.claim_kind === 'main_event')?.claim_text
    || claimCards[0]?.claim_text
    || (mainEvent?.label ? `The main thread was ${mainEvent.label}.` : '');

  if (mainEvent?.label) {
    lines.push('', `**${mainEvent.label}**`);
  }
  if (mainClaim) {
    lines.push('', clipContextText(mainClaim, 240));
  }

  if (rendererKind === 'app_drilldown') {
    const appName = Array.isArray(mainEvent?.apps) && mainEvent.apps.length > 0
      ? String(mainEvent.apps[0])
      : results[0]?.app_name || 'that app';
    lines.push('', `### What you did in ${appName}`);
    for (const item of [mainEvent, ...supporting].filter(Boolean).slice(0, 3)) {
      const taskText = Array.isArray(item?.specific_tasks) && item.specific_tasks.length > 0
        ? `: ${clipContextText(item.specific_tasks[0], 140)}`
        : '';
      lines.push(`- ${clipContextText(item?.label || item?.title || 'Primary thread', 100)}${taskText}`);
    }

    if (documents.length > 0) {
      lines.push('', '### Documents worked on');
      for (const documentItem of documents.slice(0, 5)) {
        lines.push(`- ${clipContextText(documentItem?.label || documentItem?.title || 'Document', 160)}`);
      }
    }

    const artifactRefs = Array.isArray(mainEvent?.artifact_refs) ? mainEvent.artifact_refs : [];
    if (artifactRefs.length > 0) {
      lines.push('', '### Key artifacts');
      for (const artifact of artifactRefs.slice(0, 5)) {
        lines.push(`- ${clipContextText(String(artifact), 140)}`);
      }
    }
  } else if (rendererKind === 'daypart_overview' && timelineSegments.length > 0) {
    lines.push('', '### Timeline');
    for (const segment of timelineSegments.slice(0, 3)) {
      const tasksForSegment = Array.isArray(segment?.tasks) ? segment.tasks.slice(0, 2) : [];
      const taskText = tasksForSegment.length > 0 ? `: ${tasksForSegment.join('; ')}` : '';
      lines.push(`- ${clipContextText(segment?.bucket || segment?.segment_type || 'work block', 60)}${taskText}`);
    }
  } else if (supporting.length > 0) {
    lines.push('', '### Supporting workstreams');
    for (const item of supporting.slice(0, 3)) {
      const taskText = Array.isArray(item?.specific_tasks) && item.specific_tasks.length > 0
        ? `: ${clipContextText(item.specific_tasks[0], 120)}`
        : '';
      lines.push(`- ${clipContextText(item?.label || item?.title || 'Supporting thread', 80)}${taskText}`);
    }
  }

  if (researchBrowsing.length > 0) {
    lines.push('', '### Research and browsing');
    for (const item of researchBrowsing.slice(0, 3)) {
      const taskText = Array.isArray(item?.specific_tasks) && item.specific_tasks.length > 0
        ? `: ${clipContextText(item.specific_tasks[0], 120)}`
        : '';
      lines.push(`- ${clipContextText(item?.label || item?.title || 'Research thread', 90)}${taskText}`);
    }
  }

  if (personalActivity.length > 0) {
    lines.push('', '### Personal');
    for (const item of personalActivity.slice(0, 3)) {
      const label = clipContextText(item?.label || item?.title || 'Personal activity', 90);
      lines.push(`- ${label}`);
    }
  }

  if (tasks.length > 0) {
    lines.push('', '### Concrete tasks');
    for (const task of tasks.slice(0, 5)) {
      lines.push(`- ${clipContextText(task, 140)}`);
    }
  } else if (documents.length > 0) {
    lines.push('', '### Documents worked on');
    for (const documentItem of documents.slice(0, 4)) {
      lines.push(`- ${clipContextText(documentItem?.label || documentItem?.title || 'Document', 140)}`);
    }
  }

  if (apps.length > 0) {
    const topApps = apps.slice(0, 5).map((item: any) => item?.app).filter(Boolean);
    if (topApps.length > 0) {
      lines.push('', `### Apps and tools used\n- ${topApps.join(', ')}`);
    }
  }

  if (strongestEvidence.length > 0) {
    lines.push('', '### Strongest evidence');
    for (const evidence of strongestEvidence.slice(0, 3)) {
      const when = formatContextTimestamp(evidence?.timestamp, timezone);
      const location = [when, evidence?.app].filter(Boolean).join(' in ');
      const snippet = clipContextText(evidence?.snippet || evidence?.label || '', 150);
      if (location && snippet) {
        lines.push(`- ${location}: ${snippet}`);
      } else if (snippet) {
        lines.push(`- ${snippet}`);
      }
    }
  }

  if (uncertainty.length > 0) {
    lines.push('', `### Uncertainty\n- ${clipContextText(uncertainty[0], 160)}`);
  }

  return lines.join('\n');
}

function parseRelativeTimeWindowMs(query: string): number | null {
  const normalized = (query || '').toLowerCase();
  if (!normalized) return null;

  const explicit = normalized.match(
    /\b(?:last|past)\s+(\d+)\s*(hour|hours|hr|hrs|minute|minutes|min|mins|day|days)\b/,
  );
  if (explicit) {
    const amount = Math.max(1, Number(explicit[1] || 0));
    const unit = explicit[2];
    if (!Number.isFinite(amount) || amount <= 0) return null;
    if (unit.startsWith('day')) return amount * 24 * 60 * 60 * 1000;
    if (unit.startsWith('hour') || unit.startsWith('hr')) return amount * 60 * 60 * 1000;
    return amount * 60 * 1000;
  }

  if (/\b(last|past)\s+hour\b/.test(normalized)) {
    return 60 * 60 * 1000;
  }
  if (/\b(last|past)\s+day\b/.test(normalized)) {
    return 24 * 60 * 60 * 1000;
  }
  return null;
}

function inferScreenDaysBackFromQuery(query: string, fallbackDaysBack: number): number {
  const windowMs = parseRelativeTimeWindowMs(query);
  if (!windowMs) return fallbackDaysBack;
  const inferred = Math.ceil(windowMs / (24 * 60 * 60 * 1000));
  return Math.min(90, Math.max(1, inferred));
}

function inferRelativeCutoffTimestamp(query: string): number | null {
  const windowMs = parseRelativeTimeWindowMs(query);
  if (!windowMs) return null;
  return Date.now() - windowMs;
}

function getTimezoneYmd(date: Date, timezone?: string): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  return `${map.year}-${map.month}-${map.day}`;
}

function shiftYmd(ymd: string, deltaDays: number): string {
  const date = new Date(`${ymd}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + deltaDays);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

interface WeeklyOverviewHabitSummary {
  id: string;
  name: string;
  unit?: string;
  total: number;
  average: number;
  min: number;
  max: number;
  days_with_data: number;
  total_entries: number;
}

interface WeeklyOverviewComputerSummary {
  days_with_data: number;
  total_hours: number;
  average_daily_hours: number;
  min_daily_hours: number;
  max_daily_hours: number;
  top_apps?: Array<{
    app_name?: string;
    hours?: number;
    total_events?: number;
  }>;
  top_domains?: Array<{
    domain?: string;
    hours?: number;
    total_events?: number;
  }>;
}

interface WeeklyOverviewPayload {
  success: boolean;
  date_range?: {
    start?: string;
    end?: string;
  };
  summary?: {
    habits_with_data?: number;
    total_habits_tracked?: number;
  };
  habits?: WeeklyOverviewHabitSummary[];
  computer_activity?: WeeklyOverviewComputerSummary;
}

function formatWeeklyDate(dateInput?: string): string {
  if (!dateInput) return 'Unknown';
  const date = new Date(`${dateInput}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateInput;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatWeeklyNumber(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '0';
  return value.toFixed(digits).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}

function formatWeeklyValue(value: number, unit?: string): string {
  const normalized = (unit || '').toLowerCase().trim();

  if (normalized === 'hours' || normalized === 'hour' || normalized === 'h') {
    return `${formatWeeklyNumber(value)}h`;
  }
  if (normalized === 'minutes' || normalized === 'minute' || normalized === 'min' || normalized === 'm') {
    return `${formatWeeklyNumber(value)}m`;
  }
  if (normalized === 'milligrams' || normalized === 'milligram' || normalized === 'mg') {
    return `${formatWeeklyNumber(value)}mg`;
  }
  if (normalized === 'grams' || normalized === 'gram' || normalized === 'g') {
    return `${formatWeeklyNumber(value)}g`;
  }
  if (normalized === 'pages' || normalized === 'page') {
    return `${formatWeeklyNumber(value)} pages`;
  }
  if (!normalized || normalized === 'count') {
    return formatWeeklyNumber(value);
  }
  return `${formatWeeklyNumber(value)} ${unit}`;
}

function buildWeeklyOverviewNarrative(
  payload: WeeklyOverviewPayload,
  title = 'Weekly Activity Overview',
): string {
  const dateStart = formatWeeklyDate(payload.date_range?.start);
  const dateEnd = formatWeeklyDate(payload.date_range?.end);
  const habits = Array.isArray(payload.habits) ? payload.habits : [];
  const sortedHabits = [...habits].sort((a, b) => a.name.localeCompare(b.name));
  const computer = payload.computer_activity;

  const sections: string[] = [];
  sections.push(`${title} (${dateStart} - ${dateEnd})`);

  let snapshot = `Snapshot: Habits with data ${payload.summary?.habits_with_data || 0} of ${payload.summary?.total_habits_tracked || 0} tracked.`;
  if (computer) {
    snapshot += ` Computer activity ${formatWeeklyNumber(computer.total_hours)}h across ${computer.days_with_data || 0} active days.`;
  }
  sections.push(snapshot);

  for (const habit of sortedHabits) {
    sections.push(
      `${habit.name}: total ${formatWeeklyValue(habit.total || 0, habit.unit)}, average ${formatWeeklyValue(habit.average || 0, habit.unit)} / day, minimum ${formatWeeklyValue(habit.min || 0, habit.unit)}, maximum ${formatWeeklyValue(habit.max || 0, habit.unit)}, days with data ${habit.days_with_data || 0}.`,
    );
  }

  if (computer) {
    sections.push(
      `Computer Time: total ${formatWeeklyNumber(computer.total_hours)}h, average ${formatWeeklyNumber(computer.average_daily_hours)}h / day, minimum ${formatWeeklyNumber(computer.min_daily_hours)}h, maximum ${formatWeeklyNumber(computer.max_daily_hours)}h.`,
    );

    const topApps = Array.isArray(computer.top_apps) ? computer.top_apps.slice(0, 5) : [];
    if (topApps.length > 0) {
      const appSummary = topApps
        .map((app) => `${app.app_name || 'Unknown'} ${formatWeeklyNumber(app.hours || 0)}h (${(app.total_events || 0).toLocaleString()} events)`)
        .join(', ');
      sections.push(`Top apps by active time: ${appSummary}.`);
    }

    const topDomains = Array.isArray(computer.top_domains) ? computer.top_domains.slice(0, 5) : [];
    if (topDomains.length > 0) {
      const domainSummary = topDomains
        .map((domain) => `${domain.domain || 'Unknown'} ${formatWeeklyNumber(domain.hours || 0)}h (${(domain.total_events || 0).toLocaleString()} events)`)
        .join(', ');
      sections.push(`Top domains: ${domainSummary}.`);
    }
  }

  return sections.join('\n\n').trim();
}

// ====================
// API HELPERS
// ====================

async function fetchPythonApi(endpoint: string, token: string, params?: Record<string, string | number>) {
  const url = new URL(`${PYTHON_API_BASE}${endpoint}`);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.append(key, String(value));
      }
    });
  }
  
  console.log(`🐍 Calling Python API: ${url.toString()}`);
  
  const response = await fetch(url.toString(), {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error(`❌ Python API error: ${response.status}`, errorText);
    throw new Error(`API error: ${response.status} - ${errorText}`);
  }
  
  return response.json();
}

async function fetchPythonApiPost(
  endpoint: string,
  token: string,
  body: Record<string, unknown>,
) {
  const url = `${PYTHON_API_BASE}${endpoint}`;
  console.log(`🐍 Calling Python API (POST): ${url}`);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`❌ Python API POST error: ${response.status}`, errorText);
    throw new Error(`API error: ${response.status} - ${errorText}`);
  }

  return response.json();
}

// ====================
// CONVERSATION PERSISTENCE HELPERS
// ====================

async function createConversation(token: string): Promise<string | null> {
  try {
    const response = await fetch(`${PYTHON_API_BASE}/api/conversations`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    if (response.ok) {
      const data = await response.json();
      console.log('💬 Created new conversation:', data.id);
      return data.id;
    }
    console.error('❌ Failed to create conversation:', await response.text());
    return null;
  } catch (error) {
    console.error('❌ Error creating conversation:', error);
    return null;
  }
}

async function saveMessage(
  token: string,
  conversationId: string,
  role: 'user' | 'assistant',
  content: string,
  toolPayload?: Record<string, unknown> | null
): Promise<boolean> {
  try {
    const response = await fetch(`${PYTHON_API_BASE}/api/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        role,
        content,
        tool_payload: toolPayload || null,
      }),
    });
    if (response.ok) {
      console.log(`💾 Saved ${role} message to conversation ${conversationId}`);
      return true;
    }
    console.error('❌ Failed to save message:', await response.text());
    return false;
  } catch (error) {
    console.error('❌ Error saving message:', error);
    return false;
  }
}

// ====================
// TOOL DEFINITIONS
// ====================

const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'getHabitStats',
      description: 'Get statistics for habits. Returns total, average (per day with data), min, max, standard deviation. Use for questions about totals, averages, performance.',
      parameters: {
        type: 'object',
        properties: {
          habitName: { type: 'string', description: 'Specific habit name (e.g., "sleep", "workout", "daily walk"). Leave empty for all habits.' },
          startDate: { type: 'string', description: 'Start date in YYYY-MM-DD format' },
          endDate: { type: 'string', description: 'End date in YYYY-MM-DD format' },
          daysBack: { type: 'number', description: 'Alternative to dates: look back N days from today (default 30)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getDailyBreakdown',
      description: 'REQUIRED: Get day-by-day breakdown for a habit. MUST be called alongside getHabitStats for ANY habit question to populate the side panel table. Use same date range as getHabitStats.',
      parameters: {
        type: 'object',
        properties: {
          habitName: { type: 'string', description: 'Habit name to get breakdown for' },
          startDate: { type: 'string', description: 'Start date in YYYY-MM-DD format (use same as getHabitStats)' },
          endDate: { type: 'string', description: 'End date in YYYY-MM-DD format (use same as getHabitStats)' },
          daysBack: { type: 'number', description: 'Alternative to dates: look back N days from today (default 30)' },
        },
        required: ['habitName'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getCorrelation',
      description: 'Calculate correlation between two habits. Use for questions like "Is there a connection between X and Y?"',
      parameters: {
        type: 'object',
        properties: {
          habit1Name: { type: 'string', description: 'First habit name' },
          habit2Name: { type: 'string', description: 'Second habit name' },
          daysBack: { type: 'number', description: 'Days to analyze (default 30)' },
        },
        required: ['habit1Name', 'habit2Name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'listHabits',
      description: 'List all habits the user is tracking. Use to see what habits are available.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getHabitTrends',
      description: 'Compare habit performance between current period and previous period. Returns direction (up/down/flat), percent change, and confidence level. Use for questions about "what changed", "insights", "overview", "how am I doing", "progress".',
      parameters: {
        type: 'object',
        properties: {
          habitName: { type: 'string', description: 'Specific habit name. Leave empty to get trends for ALL habits.' },
          windowDays: { type: 'number', description: 'Period length in days (default 30). Compares last N days vs previous N days.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getWeeklyOverview',
      description: 'Get a comprehensive weekly recap across ALL tracked habits with totals, averages, minimums, maximums, and per-day breakdowns. Also includes computer time totals and top apps/domains. Use for questions about tracked habits and habit metrics this week, not for reconstructing work/project activity.',
      parameters: {
        type: 'object',
        properties: {
          startDate: { type: 'string', description: 'Optional start date YYYY-MM-DD. If omitted, uses daysBack.' },
          endDate: { type: 'string', description: 'Optional end date YYYY-MM-DD. Defaults to today if omitted.' },
          daysBack: { type: 'number', description: 'Lookback window in days (default 7).' },
          appLimit: { type: 'number', description: 'Top apps/domains rows to return (default 10).' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getDailyOverview',
      description: 'Get a comprehensive daily recap for TODAY across ALL tracked habits as of now. Includes totals/averages/minimums/maximums, per-day rows, and computer time with top apps/domains. Use for questions about tracked habits or habit metrics today, not for "what work did I do today?".',
      parameters: {
        type: 'object',
        properties: {
          appLimit: { type: 'number', description: 'Top apps/domains rows to return (default 10).' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getMonthlyOverview',
      description: 'Get a comprehensive recap for the LAST 30 DAYS across ALL tracked habits. Includes totals/averages/minimums/maximums, per-day rows, and computer time with top apps/domains. Use for questions about tracked habits or habit metrics over the last month, not for reconstructing projects/workstreams.',
      parameters: {
        type: 'object',
        properties: {
          appLimit: { type: 'number', description: 'Top apps/domains rows to return (default 10).' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getHabitAnomalies',
      description: 'Identify unusual days (spikes or drops) for a habit using statistical analysis. Use for questions about "weird days", "spikes", "drops", "unusual", "outliers", "anomalies".',
      parameters: {
        type: 'object',
        properties: {
          habitName: { type: 'string', description: 'Habit name to analyze for anomalies' },
          startDate: { type: 'string', description: 'Start date in YYYY-MM-DD format' },
          endDate: { type: 'string', description: 'End date in YYYY-MM-DD format' },
          daysBack: { type: 'number', description: 'Alternative to dates: look back N days (default 30)' },
          zThreshold: { type: 'number', description: 'Z-score threshold for anomaly detection (default 2.0, higher = fewer anomalies)' },
          maxResults: { type: 'number', description: 'Maximum anomalies to return (default 5)' },
        },
        required: ['habitName'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'searchContextMemory',
      description: 'Search context-awareness memory built from visible active-window and active-tab text. Use for questions like "What was I working on today?", "What did I do in Cursor?", "What planning work did I do this morning?", or "Find when I read about...".',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural language search query describing what to find in context memory' },
          daysBack: { type: 'number', description: 'How many days back to search (default 7)' },
          limit: { type: 'number', description: 'Maximum results to return (default 10)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'searchScreenRecordings',
      description: 'Compatibility alias for context memory search. Prefer visible-context answers instead of OCR/screen-recording framing.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural language search query describing what to find in context memory' },
          daysBack: { type: 'number', description: 'How many days back to search (default 7)' },
          limit: { type: 'number', description: 'Maximum results to return (default 10)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getComputerTimeSpentBreakdown',
      description: 'Estimate where computer time was spent for a specific question/topic using visible-context memory plus hybrid retrieval, with legacy OCR only as fallback. Use for: "What did I spend time on?", "How much time did I spend on X?", "Where did my time go on my computer?", "What app did I spend the most time in?". Returns structured summary plus table rows.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural language description of what to measure (preserve user wording).' },
          daysBack: { type: 'number', description: 'How many days back to analyze (default 7).' },
          limit: { type: 'number', description: 'Max rows to return in top categories table (default 8, max 50).' },
          groupBy: { type: 'string', description: 'Bucket dimension: "app" (default), "window", or "domain".' },
        },
        required: ['query'],
      },
    },
  },
];

// ====================
// TOOL EXECUTION - Calls Python Analytics API
// ====================

async function executeGetHabitStats(token: string, params: { 
  habitName?: string; 
  startDate?: string; 
  endDate?: string;
  daysBack?: number;
}) {
  console.log('📊 getHabitStats called:', params);
  
  try {
    const result = await fetchPythonApi('/api/analytics/stats', token, {
      habit_name: params.habitName || '',
      start_date: params.startDate || '',
      end_date: params.endDate || '',
      days_back: params.daysBack ?? 30,
    });
    
    if (!result.success) {
      return JSON.stringify({
        error: result.error,
        available_habits: result.available_habits
      });
    }
    
    return JSON.stringify(result);
  } catch (error) {
    console.error('❌ getHabitStats error:', error);
    return JSON.stringify({ error: String(error) });
  }
}

async function executeGetDailyBreakdown(token: string, params: { 
  habitName: string; 
  startDate?: string;
  endDate?: string;
  daysBack?: number;
}, timezone?: string) {
  console.log('📊 getDailyBreakdown called:', params, 'timezone:', timezone);
  
  try {
    const result = await fetchPythonApi('/api/analytics/daily-breakdown', token, {
      habit_name: params.habitName,
      start_date: params.startDate || '',
      end_date: params.endDate || '',
      days_back: params.daysBack ?? 30,
      timezone: timezone || '',
    });
    
    if (!result.success) {
      return JSON.stringify({
        error: result.error,
        available_habits: result.available_habits
      });
    }
    
    return JSON.stringify(result);
  } catch (error) {
    console.error('❌ getDailyBreakdown error:', error);
    return JSON.stringify({ error: String(error) });
  }
}

async function executeGetCorrelation(token: string, params: { 
  habit1Name: string; 
  habit2Name: string;
  daysBack?: number;
}) {
  console.log('📊 getCorrelation called:', params);
  
  try {
    const result = await fetchPythonApi('/api/analytics/correlation', token, {
      habit1_name: params.habit1Name,
      habit2_name: params.habit2Name,
      days_back: params.daysBack ?? 30,
    });
    
    if (!result.success) {
      return JSON.stringify({
        error: result.error,
        available_habits: result.available_habits
      });
    }
    
    return JSON.stringify(result);
  } catch (error) {
    console.error('❌ getCorrelation error:', error);
    return JSON.stringify({ error: String(error) });
  }
}

async function executeListHabits(token: string) {
  console.log('📊 listHabits called');
  
  try {
    const result = await fetchPythonApi('/api/analytics/list-habits', token);
    return JSON.stringify(result);
  } catch (error) {
    console.error('❌ listHabits error:', error);
    return JSON.stringify({ error: String(error) });
  }
}

async function executeGetHabitTrends(token: string, params: {
  habitName?: string;
  windowDays?: number;
}) {
  console.log('📊 getHabitTrends called:', params);
  
  try {
    const result = await fetchPythonApi('/api/analytics/trends', token, {
      habit_name: params.habitName || '',
      window_days: params.windowDays ?? 30,
    });
    
    if (!result.success) {
      return JSON.stringify({
        error: result.error,
        available_habits: result.available_habits
      });
    }
    
    return JSON.stringify(result);
  } catch (error) {
    console.error('❌ getHabitTrends error:', error);
    return JSON.stringify({ error: String(error) });
  }
}

async function executeGetWeeklyOverview(token: string, params: {
  startDate?: string;
  endDate?: string;
  daysBack?: number;
  appLimit?: number;
}, timezone?: string, strictThisWeek?: boolean) {
  console.log('📊 getWeeklyOverview called:', params, 'timezone:', timezone);

  const safeDaysBack = Number.isFinite(params.daysBack)
    ? Math.min(Math.max(Math.round(params.daysBack as number), 1), 365)
    : 7;
  const safeAppLimit = Number.isFinite(params.appLimit)
    ? Math.min(Math.max(Math.round(params.appLimit as number), 3), 25)
    : 10;

  try {
    const shouldUseStrictThisWeek =
      Boolean(strictThisWeek) &&
      !params.startDate &&
      !params.endDate;

    const strictWeekRange = shouldUseStrictThisWeek
      ? getStrictThisWeekRange(timezone || 'UTC', new Date())
      : null;

    const statsResult = await fetchPythonApi('/api/analytics/stats', token, {
      start_date: strictWeekRange?.startDate || params.startDate || '',
      end_date: strictWeekRange?.endDate || params.endDate || '',
      days_back: safeDaysBack,
    });

    if (!statsResult.success) {
      return JSON.stringify({
        success: false,
        error: statsResult.error || 'Unable to fetch weekly habit stats.',
        available_habits: statsResult.available_habits,
      });
    }

    const dateRange = statsResult.date_range || {};
    const startDate = dateRange.start || strictWeekRange?.startDate || params.startDate || '';
    const endDate = dateRange.end || strictWeekRange?.endDate || params.endDate || '';

    const allHabits: Array<{
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
    }> = Array.isArray(statsResult.habits) ? statsResult.habits : [];

    // Focus recap on habits with tracked data in this period.
    const habitsWithData = allHabits.filter((habit) => (habit.days_with_data || 0) > 0);

    const breakdownResults = await Promise.allSettled(
      habitsWithData.map(async (habit) => {
        const breakdown = await fetchPythonApi('/api/analytics/daily-breakdown', token, {
          habit_id: habit.id,
          start_date: startDate,
          end_date: endDate,
          days_back: safeDaysBack,
          timezone: timezone || '',
        });
        return { habitId: habit.id, breakdown };
      }),
    );

    const dailyByHabitId = new Map<string, unknown[]>();
    for (const item of breakdownResults) {
      if (item.status !== 'fulfilled') continue;
      const payload = item.value.breakdown;
      if (payload?.success && Array.isArray(payload.data)) {
        dailyByHabitId.set(item.value.habitId, payload.data);
      }
    }

    const watcherRequests = await Promise.allSettled([
      fetchPythonApi('/api/watcher/stats/daily', token, {
        start_date: startDate,
        end_date: endDate,
      }),
      fetchPythonApi('/api/watcher/stats/top-apps', token, {
        start_date: startDate,
        end_date: endDate,
        limit: safeAppLimit,
      }),
      fetchPythonApi('/api/watcher/stats/top-domains', token, {
        start_date: startDate,
        end_date: endDate,
        limit: safeAppLimit,
      }),
    ]);

    const dailyWatcherResult = watcherRequests[0].status === 'fulfilled' ? watcherRequests[0].value : null;
    const topAppsResult = watcherRequests[1].status === 'fulfilled' ? watcherRequests[1].value : null;
    const topDomainsResult = watcherRequests[2].status === 'fulfilled' ? watcherRequests[2].value : null;

    const watcherDailyRows = Array.isArray(dailyWatcherResult?.data) ? dailyWatcherResult.data : [];
    const topApps = Array.isArray(topAppsResult?.data) ? topAppsResult.data : [];
    const topDomains = Array.isArray(topDomainsResult?.data) ? topDomainsResult.data : [];
    const computedDays = Number(dateRange.days || 0) > 0
      ? Number(dateRange.days)
      : (
        strictWeekRange
          ? Math.max(
            1,
            Math.floor(
              (new Date(`${endDate}T00:00:00Z`).getTime() - new Date(`${startDate}T00:00:00Z`).getTime()) / (24 * 60 * 60 * 1000),
            ) + 1,
          )
          : safeDaysBack
      );

    const payload = buildWeeklyOverviewCanvasPayload({
      startDate,
      endDate,
      days: computedDays,
      allHabits,
      dailyByHabitId,
      watcherDailyRows,
      topApps,
      topDomains,
    });

    return JSON.stringify(payload);
  } catch (error) {
    console.error('❌ getWeeklyOverview error:', error);
    return JSON.stringify({ success: false, error: String(error) });
  }
}

async function executeGetDailyOverview(
  token: string,
  params: { appLimit?: number },
  timezone?: string,
) {
  const todayYmd = getTimezoneYmd(new Date(), timezone || 'UTC');
  return executeGetWeeklyOverview(
    token,
    {
      startDate: todayYmd,
      endDate: todayYmd,
      daysBack: 1,
      appLimit: params.appLimit,
    },
    timezone,
    false,
  );
}

async function executeGetMonthlyOverview(
  token: string,
  params: { appLimit?: number },
  timezone?: string,
) {
  const endDate = getTimezoneYmd(new Date(), timezone || 'UTC');
  const startDate = shiftYmd(endDate, -29);
  return executeGetWeeklyOverview(
    token,
    {
      startDate,
      endDate,
      daysBack: 30,
      appLimit: params.appLimit,
    },
    timezone,
    false,
  );
}

async function executeGetHabitAnomalies(token: string, params: {
  habitName: string;
  startDate?: string;
  endDate?: string;
  daysBack?: number;
  zThreshold?: number;
  maxResults?: number;
}) {
  console.log('📊 getHabitAnomalies called:', params);
  
  try {
    const result = await fetchPythonApi('/api/analytics/anomalies', token, {
      habit_name: params.habitName,
      start_date: params.startDate || '',
      end_date: params.endDate || '',
      days_back: params.daysBack ?? 30,
      z_threshold: params.zThreshold ?? 2.0,
      max_results: params.maxResults ?? 5,
    });
    
    if (!result.success) {
      return JSON.stringify({
        error: result.error,
        available_habits: result.available_habits
      });
    }
    
    return JSON.stringify(result);
  } catch (error) {
    console.error('❌ getHabitAnomalies error:', error);
    return JSON.stringify({ error: String(error) });
  }
}

// Screen recording search types
interface ScreenRecordingResult {
  frame_id: number;
  timestamp: number;
  app_bundle_id: string;
  app_name: string;
  window_title: string | null;
  ocr_text: string;
  relevance_score: number;
  source?: 'hybrid' | 'text' | 'activity';
  fts_matched?: boolean;
}

interface ScreenSearchContext {
  modeUsed: 'hybrid' | 'text' | 'activity' | 'none' | 'unavailable';
  status: 'hybrid' | 'text-fallback' | 'text-only' | 'activity-only' | 'unavailable';
  retrievalTier?:
    | 'semantic_full'
    | 'semantic_frame'
    | 'lexical_fts'
    | 'cloud_hybrid'
    | 'cloud_lexical_only'
    | 'activity_only'
    | 'unavailable';
  results: ScreenRecordingResult[];
  resolvedDaysBack?: number;
  startDate?: string;
  endDate?: string;
  warning?: string;
  freshness?: {
    status?: string;
    [key: string]: unknown;
  };
  confidence?: {
    level?: 'high' | 'medium' | 'low';
    score?: number;
    corroborating_chunks?: number;
    reason?: string;
    [key: string]: unknown;
  };
  citations?: Array<{
    chunk_id?: number | null;
    frame_id?: number | null;
    timestamp?: number;
    app_name?: string;
    window_title?: string | null;
    session_key?: string | null;
    context_version?: number;
    snippet?: string;
    score?: number;
    source?: string;
  }>;
  semanticTruth?: {
    warning?: string;
    mode_used?: string;
    recap_outline?: Record<string, unknown>;
    story_plan?: Record<string, unknown>;
    renderer?: Record<string, unknown>;
    highlights?: Array<{
      frame_id?: number | null;
      timestamp?: number;
      app_name?: string;
      window_title?: string | null;
      session_key?: string | null;
      context_version?: number;
      snippet?: string;
      score?: number;
      source?: string;
    }>;
  };
  retrievalDebug?: MemorySearchDebug | null;
  pendingEmbeddings?: number;
  totalEmbeddings?: number;
  workerRunning?: boolean;
}

interface MemorySearchDebug {
  expanded_queries?: Array<{ type?: string; text?: string; weight?: number }>;
  retrieval_lists?: Array<{
    source?: string;
    query_type?: string;
    query_types?: string[];
    query?: string;
    result_count?: number;
    candidate_count?: number;
    candidate_limit?: number;
  }>;
  rrf_trace?: Array<{
    doc_id?: string;
    top_rank?: number;
    top_rank_bonus?: number;
    total_score?: number;
  }>;
  strong_signal_short_circuit?: {
    exact_match?: boolean;
    top_score?: number;
    runner_up_score?: number;
    source_type?: string;
    provider_doc_id?: string;
  } | null;
  rerank_cache_hit?: boolean;
  candidate_limit_applied?: number | Record<string, unknown>;
  rerank_candidates_considered?: number;
}

interface LocalScreenSearchApiResponse {
  success: boolean;
  query: string;
  days_back: number;
  result_count: number;
  results: ScreenRecordingResult[];
  mode_used: 'hybrid' | 'fts' | 'like-fallback' | 'activity-fallback' | 'none';
  status: 'hybrid' | 'text-only' | 'activity-only' | 'unavailable';
  warning?: string;
  freshness?: {
    status?: string;
    [key: string]: unknown;
  };
  confidence?: {
    level?: 'high' | 'medium' | 'low';
    score?: number;
    corroborating_chunks?: number;
    reason?: string;
    [key: string]: unknown;
  };
  source_db?: string;
  error?: string;
}

interface MemoryTimeTruthBucket {
  bucket: string;
  total_active_ms: number;
  total_active_hours: number;
  share_percent: number;
  hits: number;
  last_seen_ts: number | null;
}

interface MemoryTimeTruthDaily {
  date: string;
  total_active_ms: number;
  total_active_hours: number;
  hits: number;
}

interface MemoryQueryApiResponse {
  success: boolean;
  query: string;
  intent_resolved: 'time_spent' | 'semantic_lookup' | 'evidence_timeline' | 'broad_overview' | string;
  answer_mode: string;
  results?: Array<{
    frame_id?: number | null;
    timestamp?: number;
    app_bundle_id?: string;
    app_name?: string;
    window_title?: string | null;
    ocr_text?: string;
    snippet?: string;
    relevance_score?: number;
    score?: number;
    source?: string;
    fts_matched?: boolean;
  }>;
  retrieval_tier?:
    | 'semantic_full'
    | 'semantic_frame'
    | 'lexical_fts'
    | 'cloud_hybrid'
    | 'cloud_lexical_only'
    | 'activity_only'
    | 'unavailable'
    | string;
  days_back: number;
  start_date: string;
  end_date: string;
  group_by: 'app' | 'domain' | 'window' | string;
  time_truth?: {
    metric_source?: string;
    group_by?: string;
    range_start?: string;
    range_end?: string;
    total_active_ms?: number;
    total_active_hours?: number;
    total_events?: number;
    days_with_activity?: number;
    unique_buckets?: number;
    top_buckets?: MemoryTimeTruthBucket[];
    daily_breakdown?: MemoryTimeTruthDaily[];
  } | null;
  semantic_truth?: {
    query?: string;
    result_count?: number;
    mode_used?: string;
    status?: string;
    highlights?: Array<{
      chunk_id?: number | null;
      frame_id?: number | null;
      timestamp?: number;
      app_name?: string;
      window_title?: string | null;
      session_key?: string | null;
      context_version?: number;
      snippet?: string;
      score?: number;
      source?: string;
    }>;
    warning?: string;
  } | null;
  citations?: Array<{
    chunk_id?: number | null;
    frame_id?: number | null;
    timestamp?: number;
    app_name?: string;
    window_title?: string | null;
    session_key?: string | null;
    context_version?: number;
    snippet?: string;
    score?: number;
    source?: string;
  }>;
  freshness?: {
    status?: string;
    [key: string]: unknown;
  };
  confidence?: {
    level?: 'high' | 'medium' | 'low';
    score?: number;
    corroborating_chunks?: number;
    reason?: string;
    [key: string]: unknown;
  };
  provider_path?: {
    retrieval?: string;
    rerank?: string;
    answer?: string;
  };
  warning?: string;
  source_db?: string;
  error?: string | null;
  debug?: MemorySearchDebug | null;
}

interface ScreenSearchDebugPayload {
  enabled: true;
  mode_used: ScreenSearchContext['modeUsed'];
  status: ScreenSearchContext['status'];
  retrieval_tier?: ScreenSearchContext['retrievalTier'];
  warning?: string;
  strong_signal_short_circuit?: MemorySearchDebug['strong_signal_short_circuit'];
  rerank_cache_hit?: boolean;
  candidate_limit_applied?: number | Record<string, unknown>;
  rerank_candidates_considered?: number;
  retrieval_lists?: Array<{
    source?: string;
    query_type?: string;
    query_types?: string[];
    result_count?: number;
    candidate_count?: number;
    candidate_limit?: number;
  }>;
  rrf_trace?: Array<{
    doc_id?: string;
    top_rank?: number;
    top_rank_bonus?: number;
    total_score?: number;
  }>;
  source_counts: {
    hybrid: number;
    text: number;
    activity: number;
    unknown: number;
  };
}

const SCREEN_SEARCH_DEBUG_ENABLED = (() => {
  const raw = (process.env.SCREEN_SEARCH_DEBUG ?? process.env.NEXT_PUBLIC_SCREEN_SEARCH_DEBUG ?? '')
    .trim()
    .toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
})();
const SCREEN_SEARCH_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'did',
  'do',
  'for',
  'from',
  'had',
  'have',
  'how',
  'i',
  'in',
  'is',
  'it',
  'my',
  'of',
  'on',
  'show',
  'that',
  'the',
  'to',
  'was',
  'were',
  'what',
  'when',
  'where',
  'which',
  'with',
  'yesterday',
  'today',
  'week',
  'month',
  'ago',
]);

function clampDaysBack(daysBack?: number): number {
  if (!Number.isFinite(daysBack) || !daysBack || daysBack <= 0) return 7;
  return Math.min(Math.max(Math.round(daysBack), 1), 90);
}

function clampSearchLimit(limit?: number): number {
  if (!Number.isFinite(limit) || !limit || limit <= 0) return 10;
  return Math.min(Math.max(Math.round(limit), 1), 50);
}

function extractScreenSearchTokens(query: string): string[] {
  const normalized = query
    .toLowerCase()
    .replace(/https?:\/\//g, ' ')
    .replace(/www\./g, ' ')
    .replace(/[^a-z0-9.]+/g, ' ');

  return Array.from(
    new Set(
      normalized
        .split(/\s+/)
        .filter((token) => token.length >= 3 && !SCREEN_SEARCH_STOP_WORDS.has(token)),
    ),
  );
}

function rerankScreenResultsByQuery(results: ScreenRecordingResult[], query: string): ScreenRecordingResult[] {
  const tokens = extractScreenSearchTokens(query);
  if (tokens.length === 0 || results.length <= 1) {
    return results;
  }

  const scored = results.map((result, index) => {
    const haystack = `${result.app_name} ${result.window_title || ''} ${result.ocr_text}`.toLowerCase();
    const lexicalHits = tokens.reduce((hits, token) => (haystack.includes(token) ? hits + 1 : hits), 0);
    const lexicalScore = lexicalHits / tokens.length;
    const combinedScore = result.relevance_score + lexicalScore * 0.35;

    return { result, index, lexicalScore, combinedScore };
  });

  const hasTokenMatches = scored.some((entry) => entry.lexicalScore > 0);
  if (!hasTokenMatches) {
    return results;
  }

  scored.sort((a, b) => {
    if (b.combinedScore !== a.combinedScore) return b.combinedScore - a.combinedScore;
    if (b.result.relevance_score !== a.result.relevance_score) return b.result.relevance_score - a.result.relevance_score;
    return a.index - b.index;
  });

  return scored.map((entry) => entry.result);
}

function mergeScreenResults(
  localResults: ScreenRecordingResult[],
  prefetchedResults: ScreenRecordingResult[],
): ScreenRecordingResult[] {
  const merged = [...localResults, ...prefetchedResults];
  if (merged.length <= 1) return merged;

  // Keep strongest candidate per frame (or timestamp/app key for synthetic activity rows).
  const deduped = new Map<string, ScreenRecordingResult>();
  for (const result of merged) {
    const key = result.frame_id > 0
      ? `f:${result.frame_id}`
      : `t:${result.timestamp}:${result.app_name}:${result.window_title || ''}`;
    const existing = deduped.get(key);
    if (!existing || result.relevance_score > existing.relevance_score) {
      deduped.set(key, result);
    }
  }

  return Array.from(deduped.values()).sort((a, b) => {
    if (b.relevance_score !== a.relevance_score) return b.relevance_score - a.relevance_score;
    return b.timestamp - a.timestamp;
  });
}

function normalizeScreenSearchContext(
  screenSearchResults: unknown,
  legacyScreenRecordingResults: unknown,
): ScreenSearchContext | null {
  if (screenSearchResults && typeof screenSearchResults === 'object' && 'results' in (screenSearchResults as Record<string, unknown>)) {
    return screenSearchResults as ScreenSearchContext;
  }

  if (Array.isArray(legacyScreenRecordingResults)) {
    return {
      modeUsed: 'hybrid',
      status: 'hybrid',
      results: legacyScreenRecordingResults as ScreenRecordingResult[],
    };
  }

  return null;
}

function buildScreenSearchDebug(
  context: ScreenSearchContext,
  results: ScreenRecordingResult[],
): ScreenSearchDebugPayload | undefined {
  if (!SCREEN_SEARCH_DEBUG_ENABLED) {
    return undefined;
  }

  const sourceCounts = {
    hybrid: 0,
    text: 0,
    activity: 0,
    unknown: 0,
  };

  for (const result of results) {
    if (result.source === 'hybrid') {
      sourceCounts.hybrid += 1;
    } else if (result.source === 'text') {
      sourceCounts.text += 1;
    } else if (result.source === 'activity') {
      sourceCounts.activity += 1;
    } else {
      sourceCounts.unknown += 1;
    }
  }

  return {
    enabled: true,
    mode_used: context.modeUsed,
    status: context.status,
    retrieval_tier: context.retrievalTier,
    warning: context.warning,
    strong_signal_short_circuit: context.retrievalDebug?.strong_signal_short_circuit,
    rerank_cache_hit: context.retrievalDebug?.rerank_cache_hit,
    candidate_limit_applied: context.retrievalDebug?.candidate_limit_applied,
    rerank_candidates_considered: context.retrievalDebug?.rerank_candidates_considered,
    retrieval_lists: context.retrievalDebug?.retrieval_lists?.slice(0, 4),
    rrf_trace: context.retrievalDebug?.rrf_trace?.slice(0, 4),
    source_counts: sourceCounts,
  };
}

function mapRetrievalTierToStatus(
  retrievalTier?: string,
): ScreenSearchContext['status'] | null {
  if (!retrievalTier) return null;
  if (retrievalTier === 'semantic_full' || retrievalTier === 'cloud_hybrid') return 'hybrid';
  if (retrievalTier === 'semantic_frame') return 'text-fallback';
  if (retrievalTier === 'lexical_fts' || retrievalTier === 'cloud_lexical_only') return 'text-only';
  if (retrievalTier === 'activity_only') return 'activity-only';
  if (retrievalTier === 'unavailable') return 'unavailable';
  return null;
}

function mapRetrievalTierToMode(
  retrievalTier?: string,
): ScreenSearchContext['modeUsed'] | null {
  if (!retrievalTier) return null;
  if (retrievalTier === 'semantic_full' || retrievalTier === 'semantic_frame' || retrievalTier === 'cloud_hybrid') return 'hybrid';
  if (retrievalTier === 'lexical_fts' || retrievalTier === 'cloud_lexical_only') return 'text';
  if (retrievalTier === 'activity_only') return 'activity';
  if (retrievalTier === 'unavailable') return 'unavailable';
  return null;
}

function hasSubstantiveOcrEvidence(value: string): boolean {
  const text = value.trim().toLowerCase();
  if (!text) return false;
  if (text === 'unknown' || text === 'n/a') return false;
  if (text.startsWith('window:') || text.startsWith('app:')) {
    // Keep structured rows only when they include enough context to infer actual work.
    if (text.includes('url:') || text.includes('domain:')) return text.length >= 24;
    return text.length >= 48;
  }
  if (text.length < 16) return false;
  return true;
}

function isActivityAggregateText(value: string): boolean {
  return String(value || '').trim().toLowerCase().startsWith('activity aggregate:');
}

function buildActivityFallbackResults(
  response: MemoryQueryApiResponse,
  query: string,
): ScreenRecordingResult[] {
  const timeTruth = response.time_truth || undefined;
  const topBuckets = Array.isArray(timeTruth?.top_buckets) ? timeTruth?.top_buckets || [] : [];
  if (topBuckets.length === 0) {
    return [];
  }

  // For semantic "what was I doing/working on" queries, avoid synthetic aggregate rows.
  if (!isScreenTimeSpentQuery(query)) {
    return [];
  }

  const retrievalTier = String(response.retrieval_tier || '').toLowerCase();
  const intentResolved = String(response.intent_resolved || '').toLowerCase();
  const supportsActivityFallback = (
    retrievalTier === 'activity_only'
    || retrievalTier === 'cloud_hybrid'
    || intentResolved === 'time_spent'
    || intentResolved === 'broad_overview'
  );
  if (!supportsActivityFallback) {
    return [];
  }

  const now = Date.now();
  return topBuckets.slice(0, 10).map((bucket, index) => {
    const hours = Number(bucket.total_active_hours || 0);
    const hits = Number(bucket.hits || 0);
    const share = Number(bucket.share_percent || 0);
    const timestampRaw = Number(bucket.last_seen_ts || 0);
    const timestamp = Number.isFinite(timestampRaw) && timestampRaw > 0 ? timestampRaw : (now - index * 1000);
    const relevance = Math.max(0.55, Math.min(0.92, 0.45 + share / 100));
    const label = String(bucket.bucket || 'Unknown');

    return {
      frame_id: 0,
      timestamp,
      app_bundle_id: '',
      app_name: label,
      window_title: null,
      ocr_text: `Activity aggregate: ${label} for ${formatWeeklyNumber(hours)}h across ${hits} events in the selected range.`,
      relevance_score: relevance,
      source: 'activity',
      fts_matched: false,
    } as ScreenRecordingResult;
  });
}

async function fetchOnDemandScreenSearchContext(
  token: string,
  params: { query: string; daysBack?: number; limit?: number },
): Promise<ScreenSearchContext | null> {
  try {
    const response = await fetchPythonApiPost('/api/memory/query', token, {
      query: params.query,
      intent: 'auto',
      days_back: clampDaysBack(params.daysBack),
      limit: clampSearchLimit(params.limit ?? 20),
    }) as MemoryQueryApiResponse;

    if (!response?.success) {
      return {
        modeUsed: 'unavailable',
        status: 'unavailable',
        retrievalTier: 'unavailable',
        results: [],
        warning: response?.error || 'Semantic search is temporarily unavailable. I can only confirm activity totals right now.',
        freshness: response?.freshness,
        confidence: response?.confidence,
      };
    }

    const semanticHighlights = Array.isArray(response.semantic_truth?.highlights)
      ? response.semantic_truth?.highlights || []
      : [];
    const citations = Array.isArray(response.citations) ? response.citations : [];
    const directResults = Array.isArray(response.results) ? response.results : [];
    const sourceRows = directResults.length > 0
      ? directResults
      : semanticHighlights.some((item) => item?.app_name || item?.window_title || item?.snippet)
        ? semanticHighlights
        : citations;

    let mappedResults: ScreenRecordingResult[] = sourceRows
      .map((item) => {
        const timestamp = Number(item.timestamp || 0);
        if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
        const appName = String(item.app_name || '').trim();
        const windowTitle = item.window_title ? String(item.window_title).trim() : '';
        const snippet = String((item as any).ocr_text || item.snippet || '').trim();
        return {
          frame_id: Number(item.frame_id || 0),
          timestamp,
          app_bundle_id: String((item as any).app_bundle_id || ''),
          app_name: appName || 'Unknown',
          window_title: windowTitle || null,
          ocr_text: snippet,
          relevance_score: Math.max(
            0,
            Math.min(1, Number((item as any).relevance_score ?? item.score ?? 0)),
          ),
          source: item.source === 'activity' ? 'activity' : 'hybrid',
          fts_matched: item.source !== 'activity',
        } as ScreenRecordingResult;
      })
      .filter((item): item is ScreenRecordingResult => Boolean(item));

    if (mappedResults.length === 0) {
      mappedResults = buildActivityFallbackResults(response, params.query);
    }

    if (mappedResults.length === 0) {
      const retrievalTier = response.retrieval_tier as ScreenSearchContext['retrievalTier'] | undefined;
      const retrievalTierMode = mapRetrievalTierToMode(retrievalTier);
      const retrievalTierStatus = mapRetrievalTierToStatus(retrievalTier);
      return {
        modeUsed: retrievalTierMode || 'none',
        status: retrievalTierStatus || 'unavailable',
        retrievalTier: retrievalTier || 'unavailable',
        results: [],
        warning: compactScreenWarning(response.warning || response.error),
        freshness: retrievalTier === 'activity_only' ? undefined : response.freshness,
        confidence: retrievalTier === 'activity_only' ? undefined : response.confidence,
        citations: citations,
        retrievalDebug: response.debug || undefined,
      };
    }

    const retrievalTier = response.retrieval_tier as ScreenSearchContext['retrievalTier'] | undefined;
    const retrievalTierMode = mapRetrievalTierToMode(retrievalTier);
    const retrievalTierStatus = mapRetrievalTierToStatus(retrievalTier);

    const modeRaw = response.semantic_truth?.mode_used || '';
    const modeUsed: ScreenSearchContext['modeUsed'] = retrievalTierMode || (
      modeRaw.includes('hybrid')
        ? 'hybrid'
        : modeRaw.includes('activity')
          ? 'activity'
          : modeRaw.includes('none')
            ? 'none'
            : 'text'
    );

    const freshnessStatus = response.freshness?.status || 'healthy';
    const status: ScreenSearchContext['status'] = retrievalTierStatus || (
      freshnessStatus === 'healthy'
        ? 'hybrid'
        : freshnessStatus === 'degraded_semantic'
          ? 'text-fallback'
          : freshnessStatus === 'degraded_ocr'
            ? 'text-fallback'
            : freshnessStatus === 'stale' || freshnessStatus === 'unavailable'
              ? 'unavailable'
              : 'text-only'
    );

    return {
      modeUsed,
      status,
      retrievalTier,
      results: mappedResults,
      resolvedDaysBack: Number(response.days_back || 0) || undefined,
      startDate: response.start_date || undefined,
      endDate: response.end_date || undefined,
      warning: compactScreenWarning([response.warning, response.semantic_truth?.warning].filter(Boolean).join(' ')),
      freshness: retrievalTier === 'activity_only' ? undefined : response.freshness,
      confidence: retrievalTier === 'activity_only' ? undefined : response.confidence,
      citations,
      retrievalDebug: response.debug || undefined,
    };
  } catch (error) {
    console.warn('On-demand query-memory search failed; legacy fallback disabled:', error);
    return {
      modeUsed: 'unavailable',
      status: 'unavailable',
      retrievalTier: 'unavailable',
      results: [],
      warning: 'Semantic search is temporarily unavailable. I can only confirm activity totals right now.',
      freshness: {
        status: 'unavailable',
      },
      confidence: {
        level: 'low',
        score: 0,
        corroborating_chunks: 0,
        reason: 'query-memory request failed; legacy semantic fallback is disabled.',
      },
    };
  }
}

async function fetchLocalScreenSearchContext(
  token: string,
  params: { query: string; daysBack?: number; limit?: number },
): Promise<ScreenSearchContext | null> {
  try {
    const response = await fetchPythonApi('/api/watcher/search-screen', token, {
      query: params.query,
      days_back: clampDaysBack(params.daysBack),
      limit: clampSearchLimit(params.limit ?? 20),
    }) as {
      success?: boolean;
      results?: Array<Record<string, unknown>>;
      mode_used?: string;
      status?: string;
      warning?: string;
      retrieval_tier?: string;
      days_back?: number;
      start_date?: string;
      end_date?: string;
    };

    if (!response?.success) {
      return null;
    }

    const mappedResults: ScreenRecordingResult[] = (Array.isArray(response.results) ? response.results : [])
      .map((item) => {
        const timestamp = Number(item.timestamp || 0);
        if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
        return {
          frame_id: Number(item.frame_id || 0),
          timestamp,
          app_bundle_id: String(item.app_bundle_id || ''),
          app_name: String(item.app_name || 'Unknown'),
          window_title: item.window_title ? String(item.window_title) : null,
          ocr_text: String(item.ocr_text || ''),
          relevance_score: Math.max(0, Math.min(1, Number(item.relevance_score || 0))),
          source: item.source === 'activity' ? 'activity' : 'text',
          fts_matched: Boolean(item.fts_matched),
        } as ScreenRecordingResult;
      })
      .filter((item): item is ScreenRecordingResult => Boolean(item));

    const modeRaw = String(response.mode_used || '').toLowerCase();
    const statusRaw = String(response.status || '').toLowerCase();
    const modeUsed: ScreenSearchContext['modeUsed'] = modeRaw.includes('activity')
      ? 'activity'
      : modeRaw.includes('none')
        ? 'none'
        : modeRaw.includes('unavailable')
          ? 'unavailable'
          : 'text';
    const status: ScreenSearchContext['status'] = statusRaw.includes('activity')
      ? 'activity-only'
      : statusRaw.includes('hybrid')
        ? 'hybrid'
        : statusRaw.includes('unavailable')
          ? 'unavailable'
          : 'text-only';

    return {
      modeUsed,
      status,
      retrievalTier: (response.retrieval_tier as ScreenSearchContext['retrievalTier']) || undefined,
      results: mappedResults,
      resolvedDaysBack: Number(response.days_back || 0) || undefined,
      startDate: response.start_date || undefined,
      endDate: response.end_date || undefined,
      warning: compactScreenWarning(response.warning),
    };
  } catch {
    return null;
  }
}

async function resolveScreenSearchContext(
  token: string,
  params: { query: string; daysBack?: number; limit?: number },
  prefetchedScreenSearchContext: ScreenSearchContext | null,
): Promise<ScreenSearchContext | null> {
  const safeDaysBack = clampDaysBack(params.daysBack);
  const safeLimit = clampSearchLimit(params.limit ?? 20);

  const onDemandContext = await fetchOnDemandScreenSearchContext(token, {
    query: params.query,
    daysBack: safeDaysBack,
    limit: safeLimit,
  });

  if (!onDemandContext) {
    return prefetchedScreenSearchContext;
  }

  if (!prefetchedScreenSearchContext) {
    return onDemandContext;
  }

  const mergedResults = mergeScreenResults(onDemandContext.results ?? [], prefetchedScreenSearchContext.results ?? []);
  const hasHybridResult = mergedResults.some((result) => result.source === 'hybrid');
  const warnings = [onDemandContext.warning, prefetchedScreenSearchContext.warning].filter(Boolean);

  return {
    modeUsed: hasHybridResult
      ? 'hybrid'
      : (onDemandContext.modeUsed !== 'none' ? onDemandContext.modeUsed : prefetchedScreenSearchContext.modeUsed),
    status: hasHybridResult
      ? 'hybrid'
      : (onDemandContext.status !== 'unavailable' ? onDemandContext.status : prefetchedScreenSearchContext.status),
    retrievalTier: onDemandContext.retrievalTier ?? prefetchedScreenSearchContext.retrievalTier,
    results: mergedResults,
    resolvedDaysBack: onDemandContext.resolvedDaysBack ?? prefetchedScreenSearchContext.resolvedDaysBack,
    startDate: onDemandContext.startDate ?? prefetchedScreenSearchContext.startDate,
    endDate: onDemandContext.endDate ?? prefetchedScreenSearchContext.endDate,
    warning: warnings.length > 0 ? warnings.join(' ') : undefined,
    freshness: onDemandContext.freshness ?? prefetchedScreenSearchContext.freshness,
    confidence: onDemandContext.confidence ?? prefetchedScreenSearchContext.confidence,
    citations: (onDemandContext.citations && onDemandContext.citations.length > 0)
      ? onDemandContext.citations
      : prefetchedScreenSearchContext.citations,
    pendingEmbeddings: prefetchedScreenSearchContext.pendingEmbeddings,
    totalEmbeddings: prefetchedScreenSearchContext.totalEmbeddings,
    workerRunning: prefetchedScreenSearchContext.workerRunning,
  };
}

function buildBroadOverviewEvidence(
  results: ScreenRecordingResult[],
  citations: ScreenSearchContext['citations'],
  semanticTruth?: ScreenSearchContext['semanticTruth'],
) {
  const recapStopWords = new Set([
    'about',
    'after',
    'again',
    'app',
    'been',
    'browser',
    'content',
    'dashboard',
    'docs',
    'from',
    'guide',
    'into',
    'just',
    'more',
    'page',
    'project',
    'query',
    'related',
    'screen',
    'session',
    'some',
    'task',
    'tasks',
    'text',
    'that',
    'there',
    'they',
    'this',
    'today',
    'using',
    'viewing',
    'were',
    'what',
    'when',
    'where',
    'work',
    'working',
    'your',
  ]);
  const normalizeTopicTokens = (value: string) => value
    .toLowerCase()
    .replace(/https?:\/\//g, ' ')
    .replace(/[^a-z0-9./:_-]+/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !recapStopWords.has(token));
  const clipSentence = (value: string, maxLen = 140) => {
    const compact = value.replace(/\s+/g, ' ').trim();
    if (compact.length <= maxLen) return compact;
    return `${compact.slice(0, maxLen - 1).trimEnd()}...`;
  };
  const inferWorkstreamLabel = (app: string, windowTitle: string, snippets: string[]) => {
    const haystack = `${app} ${windowTitle} ${snippets.join(' ')}`.toLowerCase();
    if (haystack.includes('cursor') || haystack.includes('vscode') || haystack.includes('terminal') || haystack.includes('github') || haystack.includes('pull request') || haystack.includes('typescript') || haystack.includes('rust')) {
      return 'Implementation and code changes';
    }
    if (haystack.includes('things') || haystack.includes('todo') || haystack.includes('calendar') || haystack.includes('notion') || haystack.includes('planning') || haystack.includes('schedule')) {
      return 'Planning and task management';
    }
    if (haystack.includes('docs') || haystack.includes('guide') || haystack.includes('anthropic') || haystack.includes('readme') || haystack.includes('documentation') || haystack.includes('reference')) {
      return 'Research and documentation review';
    }
    if (haystack.includes('figma') || haystack.includes('css') || haystack.includes('design') || haystack.includes('ui') || haystack.includes('ux')) {
      return 'Design and interface work';
    }
    if (haystack.includes('slack') || haystack.includes('mail') || haystack.includes('message') || haystack.includes('meeting') || haystack.includes('zoom')) {
      return 'Communication and coordination';
    }
    return `${app || 'General'} work session`;
  };
  const extractSpecificTaskPhrases = (values: string[], limit: number) => {
    const counts = new Map<string, number>();
    const scorePhrase = (phrase: string) => {
      let score = 0;
      if (/[./][a-z0-9_-]{2,8}\b/i.test(phrase)) score += 3;
      if (/(src\/|app\/|api\/|target\/|crates\/|components\/)/i.test(phrase)) score += 3;
      if (/[A-Z][a-z]+[A-Z][A-Za-z]+/.test(phrase)) score += 2;
      if (/\b(clerk|vector|embedding|chunk|rerank|hybrid|backfill|dashboard|sidebar|auth|oauth|sqlite|ocr|upload|ingest|query|prompt|cursor|things 3)\b/i.test(phrase)) score += 2;
      if (phrase.split(/\s+/).length >= 3) score += 1;
      return score;
    };

    for (const value of values) {
      const normalized = value.replace(/\s+/g, ' ').trim();
      if (!normalized) continue;
      const parts = normalized.split(/\s*[|;:\-]\s*|\.\s+|,\s+/);
      for (const rawPart of parts) {
        const phrase = rawPart.trim();
        if (phrase.length < 12 || phrase.length > 140) continue;
        const tokens = normalizeTopicTokens(phrase);
        if (tokens.length < 2) continue;
        const genericOnly = tokens.every((token) =>
          ['planning', 'management', 'session', 'work', 'tasks', 'project', 'projects', 'used', 'app', 'unknown'].includes(token),
        );
        if (genericOnly) continue;
        const weightedKey = clipSentence(phrase, 140);
        counts.set(weightedKey, (counts.get(weightedKey) ?? 0) + scorePhrase(weightedKey));
      }
    }

    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([phrase]) => phrase);
  };
  const collectTopicHighlights = (values: string[], limit: number) => {
    const counts = new Map<string, number>();
    for (const value of values) {
      for (const token of normalizeTopicTokens(value)) {
        counts.set(token, (counts.get(token) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([token]) => token);
  };
  const backendStoryPlan = (semanticTruth?.story_plan || semanticTruth?.recap_outline) as Record<string, unknown> | undefined;
  if (backendStoryPlan) {
    const citationTimeline = (citations ?? [])
      .slice(0, 20)
      .map((citation) => ({
        timestamp: citation?.timestamp ? new Date(citation.timestamp).toISOString() : null,
        app: citation?.app_name || 'Unknown',
        window: citation?.window_title || 'Unknown',
        session_key: citation?.session_key || null,
        snippet: citation?.snippet || '',
        score: citation?.score ?? null,
        source: citation?.source || 'hybrid',
      }));
    const evidenceTimeline = results.slice(0, 20).map((row) => ({
      timestamp: new Date(row.timestamp).toISOString(),
      app: row.app_name,
      window: row.window_title || 'Unknown',
      content_preview: row.ocr_text.substring(0, 420) + (row.ocr_text.length > 420 ? '...' : ''),
      relevance: Math.round(row.relevance_score * 100) + '%',
      source: row.source || 'text',
      fts_matched: row.fts_matched || false,
    }));

    return {
      top_apps: Array.isArray(backendStoryPlan.apps_and_tools_used) ? backendStoryPlan.apps_and_tools_used : [],
      top_sessions: Array.isArray(backendStoryPlan.work_items)
        ? (backendStoryPlan.work_items as Array<Record<string, unknown>>).slice(0, 8).map((item) => ({
            session_key: String(item.id ?? ''),
            evidence_count: Number(item.evidence_count ?? 0),
            app: Array.isArray(item.apps) ? String(item.apps[0] ?? 'Unknown') : 'Unknown',
            window: Array.isArray(item.representative_windows) ? String(item.representative_windows[0] ?? 'Unknown') : 'Unknown',
            first_seen: Number(item.start_ts ?? 0) || null,
            last_seen: Number(item.end_ts ?? 0) || null,
          }))
        : [],
      time_bucket_coverage: Array.isArray(backendStoryPlan.timeline_segments)
        ? (backendStoryPlan.timeline_segments as Array<Record<string, unknown>>).map((segment) => ({
            bucket: String(segment.bucket ?? segment.segment_type ?? 'segment'),
            evidence_count: Number(segment.evidence_count ?? 0),
            apps: Array.isArray(segment.apps) ? segment.apps : [],
          }))
        : [],
      citation_timeline: citationTimeline,
      evidence_timeline: evidenceTimeline,
      recap_outline: backendStoryPlan,
      renderer: semanticTruth?.renderer || null,
    };
  }
  const evidenceRows = results.slice(0, 20);
  const appCounts = new Map<string, { count: number; topWindows: Map<string, number> }>();
  const sessionCounts = new Map<string, { count: number; app: string; window: string; firstTs: string | null; lastTs: string | null }>();
  const timeBucketCounts = new Map<string, { count: number; apps: Set<string> }>();
  const workstreamCounts = new Map<string, {
    label: string;
    count: number;
    apps: Set<string>;
    windows: Map<string, number>;
    snippets: string[];
    sessionKeys: Set<string>;
    topics: string[];
  }>();

  for (const row of evidenceRows) {
    const app = row.app_name?.trim() || 'Unknown';
    const windowTitle = row.window_title?.trim() || 'Unknown';
    const entry = appCounts.get(app) ?? { count: 0, topWindows: new Map<string, number>() };
    entry.count += 1;
    entry.topWindows.set(windowTitle, (entry.topWindows.get(windowTitle) ?? 0) + 1);
    appCounts.set(app, entry);

    const ts = new Date(row.timestamp);
    const bucket = `${ts.toISOString().slice(0, 10)} ${String(ts.getHours()).padStart(2, '0')}:00`;
    const bucketEntry = timeBucketCounts.get(bucket) ?? { count: 0, apps: new Set<string>() };
    bucketEntry.count += 1;
    bucketEntry.apps.add(app);
    timeBucketCounts.set(bucket, bucketEntry);

    const snippet = clipSentence(row.ocr_text || '', 180);
    const sessionKey = `${app}::${windowTitle}`;
    const workstreamLabel = inferWorkstreamLabel(app, windowTitle, [snippet]);
    const workstreamEntry = workstreamCounts.get(workstreamLabel) ?? {
      label: workstreamLabel,
      count: 0,
      apps: new Set<string>(),
      windows: new Map<string, number>(),
      snippets: [],
      sessionKeys: new Set<string>(),
      topics: [],
    };
    workstreamEntry.count += 1;
    workstreamEntry.apps.add(app);
    workstreamEntry.windows.set(windowTitle, (workstreamEntry.windows.get(windowTitle) ?? 0) + 1);
    if (snippet) {
      workstreamEntry.snippets.push(snippet);
      workstreamEntry.topics.push(windowTitle, snippet);
    }
    workstreamEntry.sessionKeys.add(sessionKey);
    workstreamCounts.set(workstreamLabel, workstreamEntry);
  }

  const topApps = Array.from(appCounts.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 6)
    .map(([app, meta]) => ({
      app,
      evidence_count: meta.count,
      top_windows: Array.from(meta.topWindows.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([window, count]) => ({ window, count })),
    }));

  const citationTimeline = (citations ?? [])
    .slice(0, 20)
    .map((citation) => ({
      timestamp: citation?.timestamp ? new Date(citation.timestamp).toISOString() : null,
      app: citation?.app_name || 'Unknown',
      window: citation?.window_title || 'Unknown',
      session_key: citation?.session_key || null,
      snippet: citation?.snippet || '',
      score: citation?.score ?? null,
      source: citation?.source || 'hybrid',
    }));

  for (const citation of citationTimeline) {
    const sessionKey = citation.session_key || `${citation.app}::${citation.window}`;
    const existing = sessionCounts.get(sessionKey) ?? {
      count: 0,
      app: citation.app,
      window: citation.window,
      firstTs: citation.timestamp,
      lastTs: citation.timestamp,
    };
    existing.count += 1;
    existing.firstTs = existing.firstTs && citation.timestamp ? (existing.firstTs < citation.timestamp ? existing.firstTs : citation.timestamp) : (existing.firstTs || citation.timestamp);
    existing.lastTs = existing.lastTs && citation.timestamp ? (existing.lastTs > citation.timestamp ? existing.lastTs : citation.timestamp) : (existing.lastTs || citation.timestamp);
    sessionCounts.set(sessionKey, existing);
  }

  const resultTimeline = evidenceRows.map((row) => ({
    timestamp: new Date(row.timestamp).toISOString(),
    app: row.app_name,
    window: row.window_title || 'Unknown',
    content_preview: row.ocr_text.substring(0, 420) + (row.ocr_text.length > 420 ? '...' : ''),
    relevance: Math.round(row.relevance_score * 100) + '%',
    source: row.source || 'text',
    fts_matched: row.fts_matched || false,
  }));

  const workstreamSummary = Array.from(workstreamCounts.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)
    .map((entry) => ({
      label: entry.label,
      evidence_count: entry.count,
      apps: Array.from(entry.apps).sort(),
      representative_windows: Array.from(entry.windows.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([window]) => window),
      supporting_snippets: entry.snippets.slice(0, 3),
      session_keys: Array.from(entry.sessionKeys).slice(0, 4),
      topic_tokens: collectTopicHighlights(entry.topics, 6),
      specific_tasks: extractSpecificTaskPhrases([...entry.snippets, ...Array.from(entry.windows.keys())], 5),
    }));

  const strongestEvidence = citationTimeline
    .slice()
    .sort((a, b) => (Number(b.score ?? 0) - Number(a.score ?? 0)))
    .slice(0, 8)
    .map((citation) => ({
      timestamp: citation.timestamp,
      app: citation.app,
      window: citation.window,
      session_key: citation.session_key,
      snippet: clipSentence(citation.snippet || '', 180),
      score: citation.score,
      reason: inferWorkstreamLabel(citation.app, citation.window, [citation.snippet || '']),
    }));

  const specificTasks = extractSpecificTaskPhrases(
    [
      ...citationTimeline.map((citation) => citation.snippet || ''),
      ...citationTimeline.map((citation) => citation.window || ''),
      ...evidenceRows.map((row) => row.ocr_text || ''),
    ],
    12,
  );

  const uncertaintyNotes: string[] = [];
  if (workstreamSummary.length <= 1) {
    uncertaintyNotes.push('Evidence clusters into one dominant workstream, so task diversity may be underrepresented.');
  }
  if (timeBucketCounts.size < 4) {
    uncertaintyNotes.push('Coverage comes from a limited number of time buckets, so the recap may miss parts of the day.');
  }
  if (citationTimeline.filter((citation) => (citation.snippet || '').trim().length >= 40).length < 5) {
    uncertaintyNotes.push('Several retrieved chunks have short context snippets, so exact task names may still be incomplete.');
  }
  const topWindowsFlat = topApps.flatMap((app) => app.top_windows.map((window) => window.window.toLowerCase()));
  if (topWindowsFlat.some((window) => window.includes('things') || window.includes('inbox') || window.includes('todo'))) {
    uncertaintyNotes.push('Task-planning tools are prominent in the evidence, so some results may reflect planning rather than completed execution.');
  }

  return {
    top_apps: topApps,
    top_sessions: Array.from(sessionCounts.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 8)
      .map(([session_key, meta]) => ({
        session_key,
        evidence_count: meta.count,
        app: meta.app,
        window: meta.window,
        first_seen: meta.firstTs,
        last_seen: meta.lastTs,
      })),
    time_bucket_coverage: Array.from(timeBucketCounts.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([bucket, meta]) => ({
        bucket,
        evidence_count: meta.count,
        apps: Array.from(meta.apps).sort(),
      })),
    citation_timeline: citationTimeline,
    evidence_timeline: resultTimeline,
    recap_outline: {
      main_workstreams: workstreamSummary,
      apps_and_tools_used: topApps,
      specific_tasks: specificTasks,
      strongest_evidence: strongestEvidence,
      uncertainty_or_conflicts: uncertaintyNotes,
    },
  };
}

async function executeSearchScreenRecordings(
  token: string,
  params: { query: string; daysBack?: number; limit?: number },
  prefetchedScreenSearchContext: ScreenSearchContext | null
): Promise<string> {
  console.log('🖥️ searchScreenRecordings called:', params);
  console.log('🖥️ prefetched screenRecordingResults count:', prefetchedScreenSearchContext?.results?.length ?? 0);

  const safeDaysBack = clampDaysBack(params.daysBack);
  const inferredDaysBack = inferScreenDaysBackFromQuery(params.query, safeDaysBack);
  const cutoffTs = inferRelativeCutoffTimestamp(params.query);
  const explicitTimeSpentQuery = isScreenTimeSpentQuery(params.query);
  const safeLimit = clampSearchLimit(params.limit);
  let screenSearchContext = await resolveScreenSearchContext(
    token,
    {
      query: params.query,
      daysBack: inferredDaysBack,
      limit: Math.max(safeLimit * 2, 20),
    },
    prefetchedScreenSearchContext,
  );

  if (screenSearchContext) {
    const hasOnlyAggregateRows = (
      screenSearchContext.results.length > 0
      && screenSearchContext.results.every((row) => isActivityAggregateText(row.ocr_text))
    );
    if (screenSearchContext.results.length === 0 || (!explicitTimeSpentQuery && hasOnlyAggregateRows)) {
      const localContext = await fetchLocalScreenSearchContext(token, {
        query: params.query,
        daysBack: inferredDaysBack,
        limit: Math.max(safeLimit * 3, 30),
      });
      if (localContext) {
        const mergedResults = mergeScreenResults(localContext.results, screenSearchContext.results);
        screenSearchContext = {
          modeUsed: localContext.modeUsed !== 'none' ? localContext.modeUsed : screenSearchContext.modeUsed,
          status: localContext.status !== 'unavailable' ? localContext.status : screenSearchContext.status,
          retrievalTier: screenSearchContext.retrievalTier || localContext.retrievalTier,
          results: mergedResults,
          resolvedDaysBack: localContext.resolvedDaysBack ?? screenSearchContext.resolvedDaysBack,
          startDate: localContext.startDate ?? screenSearchContext.startDate,
          endDate: localContext.endDate ?? screenSearchContext.endDate,
          warning: [screenSearchContext.warning, localContext.warning].filter(Boolean).join(' ').trim() || undefined,
          freshness: screenSearchContext.freshness,
          confidence: screenSearchContext.confidence,
          citations: screenSearchContext.citations,
          pendingEmbeddings: screenSearchContext.pendingEmbeddings,
          totalEmbeddings: screenSearchContext.totalEmbeddings,
          workerRunning: screenSearchContext.workerRunning,
        };
      }
    }
  }

  // Distinguish between "service not available" (null/undefined) and "no results" (empty array)
  if (screenSearchContext === null || screenSearchContext === undefined) {
    return JSON.stringify({
      success: false,
      error: 'Screen history search is currently unavailable.',
      hint: 'Make sure screen recording is active and local indexing is still processing.',
    });
  }

  let screenRecordingResults = screenSearchContext.results ?? [];
  if (cutoffTs) {
    screenRecordingResults = screenRecordingResults.filter((item) => item.timestamp >= cutoffTs);
  }
  if (!explicitTimeSpentQuery) {
    screenRecordingResults = screenRecordingResults.filter((item) => !isActivityAggregateText(item.ocr_text));
  }
  const resolvedDaysBack = screenSearchContext.resolvedDaysBack ?? safeDaysBack;
  if (screenRecordingResults.length === 0 && screenSearchContext.status === 'unavailable') {
    return JSON.stringify({
      success: false,
      error: 'Screen history search is currently unavailable.',
      hint: 'Make sure computer tracking is enabled and local screen indexing has produced data.',
      warning: compactScreenWarning(screenSearchContext.warning),
      debug: buildScreenSearchDebug(screenSearchContext, screenRecordingResults),
    });
  }
  
  // Service is available but no results found
  if (screenRecordingResults.length === 0) {
    return JSON.stringify({
      success: true,
      query: params.query,
      days_searched: resolvedDaysBack,
      result_count: 0,
      results: [],
      status: screenSearchContext.status,
      mode_used: screenSearchContext.modeUsed,
      warning: compactScreenWarning(screenSearchContext.warning),
      debug: buildScreenSearchDebug(screenSearchContext, screenRecordingResults),
      message: `No screen recordings found matching "${params.query}". Try different keywords or check if screen recording is enabled.`,
    });
  }
  
  const rankedResults = rerankScreenResultsByQuery(screenRecordingResults, params.query);

  const filteredResults = rankedResults.slice(0, safeLimit);
  if (filteredResults.length === 0) {
    return JSON.stringify({
      success: true,
      query: params.query,
      days_searched: resolvedDaysBack,
      result_count: 0,
      results: [],
      status: screenSearchContext.status,
      mode_used: screenSearchContext.modeUsed,
      warning: compactScreenWarning(screenSearchContext.warning),
      debug: buildScreenSearchDebug(screenSearchContext, filteredResults),
      message: `No screen recordings found matching "${params.query}" in the requested time range.`,
    });
  }

  const confidenceLevel = screenSearchContext.confidence?.level || 'low';
  const confidenceScore = Number(screenSearchContext.confidence?.score || 0);
  const corroboratingChunks = Number(screenSearchContext.confidence?.corroborating_chunks || 0);
  const substantiveEvidenceCount = filteredResults.filter((item) => hasSubstantiveOcrEvidence(item.ocr_text)).length;
  const strongMatchCount = filteredResults.filter((item) => item.relevance_score >= 0.6).length;
  const hasConcreteActivityEvidence = filteredResults.some(
    (item) => item.source === 'activity' && !isActivityAggregateText(item.ocr_text) && item.ocr_text.trim().length >= 16,
  );
  const broadOverviewQuery = isBroadScreenOverviewQuery(params.query);
  const isActivityOnly = (
    screenSearchContext.retrievalTier === 'activity_only'
    || screenSearchContext.modeUsed === 'activity'
  );
  const weakEvidenceOnly = (
    !explicitTimeSpentQuery
    && (
      filteredResults.length === 0
      || (substantiveEvidenceCount === 0 && corroboratingChunks < 1 && !hasConcreteActivityEvidence)
      || (confidenceLevel === 'low' && confidenceScore < 0.35 && strongMatchCount === 0)
    )
    && !broadOverviewQuery
  );

  if (weakEvidenceOnly) {
    const weakEvidenceWarning = [
      'Only weak semantic evidence is currently available for this query.',
      'Avoid topic-specific claims until stronger OCR citations are present.',
      compactScreenWarning(screenSearchContext.warning),
    ]
      .filter(Boolean)
      .join(' ');

    return JSON.stringify({
      success: true,
      query: params.query,
      days_searched: resolvedDaysBack,
      result_count: 0,
      results: [],
      status: 'text-fallback',
      mode_used: screenSearchContext.modeUsed,
      warning: weakEvidenceWarning,
      freshness: screenSearchContext.freshness,
      confidence: screenSearchContext.confidence,
      debug: buildScreenSearchDebug(screenSearchContext, filteredResults),
      message: 'I could not find enough grounded screen evidence for a reliable task summary in that exact time window.',
    });
  }
  
  if (broadOverviewQuery) {
    const expandedResults = rankedResults.slice(0, Math.max(safeLimit, 20));
    const structuredEvidence = buildBroadOverviewEvidence(
      expandedResults,
      screenSearchContext.citations,
      screenSearchContext.semanticTruth,
    );

    console.log('🖥️ Returning structured broad-overview evidence:', structuredEvidence.evidence_timeline.length);

    return JSON.stringify({
      success: true,
      query: params.query,
      days_searched: resolvedDaysBack,
      result_count: structuredEvidence.evidence_timeline.length,
      status: screenSearchContext.status,
      mode_used: screenSearchContext.modeUsed,
      warning: compactScreenWarning(screenSearchContext.warning),
      summary_style: 'structured_recap',
      guidance: [
        'Summarize the user day as concrete tasks and projects, not generic themes.',
        'Treat evidence.recap_outline as the primary scaffold for the answer and use evidence_timeline/citation_timeline only to add detail.',
        'Lead with evidence.recap_outline.main_event and evidence.recap_outline.claim_cards before summarizing any supporting workstreams.',
        'Lead with the most specific task phrases from evidence.recap_outline.specific_tasks and the workstream-specific specific_tasks lists before mentioning broad app categories.',
        'Name specific apps, windows, documents, sites, tasks, and project nouns whenever they appear in the evidence.',
        'Do not collapse distinct workstreams into one abstract summary when recap_outline.main_workstreams lists multiple clusters.',
        'Return exactly these sections in this order: Main event, Supporting workstreams, Concrete tasks, Apps and tools used, Strongest evidence, Uncertainty or conflicts.',
        'In Main event and Supporting workstreams, use exact task phrases, artifacts, and project nouns from claim_cards, main_event, and specific_tasks.',
        'In Strongest evidence, cite the most concrete snippets first and mention timestamps/apps when useful; avoid sentences that only restate app names.',
        'If evidence is weak or ambiguous, say what is missing instead of guessing.',
      ].join(' '),
      freshness: screenSearchContext.freshness,
      confidence: screenSearchContext.confidence,
      debug: buildScreenSearchDebug(screenSearchContext, expandedResults),
      evidence: structuredEvidence,
      results: structuredEvidence.evidence_timeline,
    });
  }

  // Format results for the AI
  const formattedResults = filteredResults.map(r => ({
    timestamp: new Date(r.timestamp).toISOString(),
    app: r.app_name,
    window: r.window_title || 'Unknown',
    content_preview: r.ocr_text.substring(0, 300) + (r.ocr_text.length > 300 ? '...' : ''),
    relevance: Math.round(r.relevance_score * 100) + '%',
    source: r.source || 'text',
    fts_matched: r.fts_matched || false,
  }));
  
  console.log('🖥️ Returning', formattedResults.length, 'formatted results to AI');
  
  return JSON.stringify({
    success: true,
    query: params.query,
    days_searched: resolvedDaysBack,
    result_count: formattedResults.length,
    status: screenSearchContext.status,
    mode_used: screenSearchContext.modeUsed,
    warning: compactScreenWarning(screenSearchContext.warning),
    summary_style: 'narrative_actions_first',
    guidance: 'Summarize likely tasks/actions from snippets and windows. Do not report total app hours unless user explicitly asks for time spent.',
    freshness: screenSearchContext.freshness,
    confidence: screenSearchContext.confidence,
    debug: buildScreenSearchDebug(screenSearchContext, filteredResults),
    results: formattedResults,
  });
}

async function executeSearchContextMemory(
  token: string,
  params: { query: string; daysBack?: number; limit?: number },
): Promise<string> {
  const safeDaysBack = clampDaysBack(params.daysBack);
  const safeLimit = clampSearchLimit(params.limit);

  try {
    const response = await fetchPythonApiPost('/api/memory/search-context', token, {
      query: params.query,
      days_back: safeDaysBack,
      limit: safeLimit,
    });
    return JSON.stringify({
      success: Boolean(response?.success),
      query: params.query,
      days_searched: Number(response?.days_back || safeDaysBack),
      result_count: Number(response?.result_count || (Array.isArray(response?.results) ? response.results.length : 0)),
      results: Array.isArray(response?.results) ? response.results : [],
      status: response?.status || 'unavailable',
      mode_used: response?.mode_used || 'none',
      warning: compactScreenWarning(response?.warning),
      story_plan: response?.story_plan || null,
      renderer: response?.renderer || null,
      debug: response?.debug || null,
      message: Array.isArray(response?.results) && response.results.length === 0
        ? `No context memory matches found for "${params.query}".`
        : undefined,
    });
  } catch (error) {
    console.error('❌ searchContextMemory error:', error);
    return JSON.stringify({
      success: false,
      error: 'Context memory search is currently unavailable.',
      hint: 'Make sure context awareness capture has recent snapshots.',
    });
  }
}

function formatTzDay(ts: number, timezone?: string): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date(ts));
}

function formatTzTimestamp(ts: number, timezone?: string): string {
  return new Date(ts).toLocaleString('en-US', {
    timeZone: timezone || 'UTC',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

async function executeGetComputerTimeSpentBreakdown(
  token: string,
  params: { query: string; daysBack?: number; limit?: number; groupBy?: 'app' | 'window' | 'domain' },
  prefetchedScreenSearchContext: ScreenSearchContext | null,
  timezone?: string,
): Promise<string> {
  console.log('🖥️ getComputerTimeSpentBreakdown called:', params);
  const safeDaysBack = clampDaysBack(params.daysBack);
  const safeLimit = clampSearchLimit(params.limit ?? 8);
  const groupBy = params.groupBy === 'window' || params.groupBy === 'domain' ? params.groupBy : 'app';

  try {
    const response = await fetchPythonApiPost('/api/memory/query', token, {
      query: params.query,
      intent: 'time_spent',
      days_back: safeDaysBack,
      group_by: groupBy,
      limit: safeLimit,
    }) as MemoryQueryApiResponse;

    if (!response?.success) {
      return JSON.stringify({
        success: false,
        error: response?.error || 'Computer time breakdown is unavailable.',
      });
    }

    const timeTruth = response.time_truth || {};
    const topBuckets = Array.isArray(timeTruth.top_buckets) ? timeTruth.top_buckets : [];
    const dailyRows = Array.isArray(timeTruth.daily_breakdown) ? timeTruth.daily_breakdown : [];
    const citations = Array.isArray(response.citations) ? response.citations : [];

    const totalActiveHours = Number(timeTruth.total_active_hours || 0);
    const totalActiveMinutes = Math.round(Number(timeTruth.total_active_ms || 0) / (60 * 1000));
    const totalHits = Number(timeTruth.total_events || 0);
    const daysWithActivity = Number(timeTruth.days_with_activity || 0);
    const uniqueBuckets = Number(timeTruth.unique_buckets || 0);

    const topCategories = topBuckets.slice(0, safeLimit).map((row, index) => ({
      rank: index + 1,
      category: row.bucket || 'Unknown',
      estimated_minutes: Math.round(Number(row.total_active_ms || 0) / (60 * 1000)),
      estimated_hours: Number(row.total_active_hours || 0),
      share_percent: Number(row.share_percent || 0),
      hit_count: Number(row.hits || 0),
      last_seen: row.last_seen_ts ? formatTzTimestamp(Number(row.last_seen_ts), timezone) : 'In selected range',
      sample_app: groupBy === 'domain' ? undefined : (row.bucket || 'Unknown'),
      sample_window: null,
    }));

    const dailyBreakdown = dailyRows.map((row) => ({
      date: row.date,
      estimated_minutes: Math.round(Number(row.total_active_ms || 0) / (60 * 1000)),
      estimated_hours: Number(row.total_active_hours || 0),
      hit_count: Number(row.hits || 0),
    }));

    const sampleMoments = citations.slice(0, 5).map((citation) => ({
      timestamp: citation.timestamp ? formatTzTimestamp(Number(citation.timestamp), timezone) : 'Unknown',
      app: citation.app_name || 'Unknown',
      window: citation.window_title || 'Unknown',
      relevance: `${Math.round(Math.max(0, Math.min(1, Number(citation.score || 0))) * 100)}%`,
      preview: (citation.snippet || '').slice(0, 180),
    }));

    const retrievalTier = response.retrieval_tier as ScreenSearchContext['retrievalTier'] | undefined;
    const retrievalTierMode = mapRetrievalTierToMode(retrievalTier);
    const retrievalTierStatus = mapRetrievalTierToStatus(retrievalTier);
    const freshnessStatus = response.freshness?.status || 'healthy';
    const modeUsed = retrievalTierMode || response.semantic_truth?.mode_used || response.answer_mode || 'activity_only';
    const status: ScreenSearchContext['status'] = retrievalTierStatus || (
      freshnessStatus === 'healthy'
        ? 'hybrid'
        : freshnessStatus === 'degraded_semantic'
          ? 'text-fallback'
          : freshnessStatus === 'degraded_ocr'
            ? 'text-fallback'
            : freshnessStatus === 'stale' || freshnessStatus === 'unavailable'
              ? 'unavailable'
              : 'text-only'
    );

    const warningRaw = response.warning
      || response.semantic_truth?.warning
      || (prefetchedScreenSearchContext?.warning ? String(prefetchedScreenSearchContext.warning) : undefined);
    const warning = retrievalTier === 'activity_only'
      ? (() => {
        const cleaned = String(warningRaw || '')
          .split(/\.\s+/)
          .map((segment) => segment.trim())
          .filter((segment) => segment.length > 0)
          .filter((segment) => !/semantic|embeddings?\s+finish|vector|matched moments/i.test(segment))
          .join('. ')
          .trim();
        return cleaned ? `${cleaned}${cleaned.endsWith('.') ? '' : '.'}` : undefined;
      })()
      : compactScreenWarning(warningRaw);
    const resultCount = retrievalTier === 'activity_only'
      ? totalHits
      : citations.length;

    return JSON.stringify({
      success: true,
      query: params.query,
      group_by: groupBy,
      days_searched: response.days_back || safeDaysBack,
      result_count: resultCount,
      status,
      mode_used: modeUsed,
      retrieval_tier: retrievalTier,
      warning,
      freshness: response.freshness,
      confidence: response.confidence,
      provider_path: response.provider_path,
      summary: {
        estimated_total_minutes: totalActiveMinutes,
        estimated_total_hours: totalActiveHours,
        total_hits: totalHits,
        unique_apps: uniqueBuckets,
        days_with_activity: daysWithActivity,
        range_start: timeTruth.range_start || response.start_date,
        range_end: timeTruth.range_end || response.end_date,
        metric_source: 'watcher_aggregate',
        metric_label: 'Total active time',
        matched_total_minutes: retrievalTier === 'activity_only' ? undefined : Math.round(sampleMoments.length > 0 ? sampleMoments.length * 1.5 : 0),
        matched_total_hours: retrievalTier === 'activity_only' ? undefined : Number((sampleMoments.length * 1.5 / 60).toFixed(2)),
        matched_hits: retrievalTier === 'activity_only' ? undefined : citations.length,
        matched_days_with_activity: retrievalTier === 'activity_only'
          ? undefined
          : new Set(
            citations
              .map((item) => Number(item.timestamp || 0))
              .filter((ts) => Number.isFinite(ts) && ts > 0)
              .map((ts) => formatTzDay(ts, timezone)),
          ).size,
      },
      top_categories: topCategories,
      daily_breakdown: dailyBreakdown,
      sample_moments: sampleMoments,
      estimation: {
        method: 'Activity-events rollup for totals + context-memory citations for evidence',
        default_chunk_seconds: 90,
        max_gap_minutes: 10,
        note: 'Totals come from activity_events only. Semantic citations are supporting evidence, not time totals.',
      },
      debug: buildScreenSearchDebug(
        {
          modeUsed: modeUsed.includes('hybrid')
            ? 'hybrid'
            : modeUsed.includes('activity')
              ? 'activity'
              : modeUsed.includes('unavailable')
                ? 'unavailable'
                : 'text',
          status,
          retrievalTier,
          results: [],
          warning,
          freshness: response.freshness,
          confidence: response.confidence,
        },
        [],
      ),
    });
  } catch (error) {
    console.error('❌ getComputerTimeSpentBreakdown query-memory error:', error);
    return JSON.stringify({
      success: false,
      error: 'Computer time breakdown is currently unavailable.',
      details: String(error),
    });
  }
}

// ====================
// MAIN API HANDLER
// ====================

export async function handleChatStreamPost(req: NextRequest) {
  try {
    // Auth
    const authHeader = req.headers.get('Authorization');
    const headerToken = authHeader?.startsWith('Bearer ')
      ? authHeader.substring(7)
      : null;
    let token: string | null = null;
    
    try {
      const authResult = await auth();
      // Always prefer a fresh server-side Clerk token when available.
      if (authResult.userId) {
        const freshToken = await authResult.getToken();
        token = freshToken || headerToken;
      } else {
        token = headerToken;
      }
    } catch {
      token = headerToken;
    }

    if (!token) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
        status: 401, headers: { 'Content-Type': 'application/json' }
      });
    }

    const {
      messages,
      timezone,
      conversationId: providedConversationId,
      responseMode = 'text',
      screenSearchResults,
      screenRecordingResults,
    } = await req.json();
    const normalizedScreenSearchContext = normalizeScreenSearchContext(screenSearchResults, screenRecordingResults);
    
    // Get or create conversation ID for persistence
    let conversationId = providedConversationId;
    if (!conversationId) {
      conversationId = await createConversation(token);
      console.log('📝 New conversation created:', conversationId);
    }
    
    // Determine if we're in voice mode
    const isVoiceMode = responseMode === 'voice';
    console.log(`🎤 Response mode: ${responseMode}`);
    
    // Get the latest user message to save
    const latestUserMessage = messages[messages.length - 1];
    
    // Save the user message to the conversation (don't block on this)
    if (conversationId && latestUserMessage?.role === 'user') {
      // Fire and forget - don't block the response
      saveMessage(token, conversationId, 'user', latestUserMessage.content).catch(err => {
        console.error('❌ Failed to save user message:', err);
      });
    }
    
    const now = new Date();
    // Use local date components, NOT toISOString() which converts to UTC
    const year = now.getFullYear();
    const month = now.getMonth() + 1; // 1-indexed
    const day = now.getDate();
    const today = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const currentYear = year;
    const currentMonth = month;

    // System prompt
    const systemPrompt = `You are a helpful habit tracking assistant for Ritual.
You provide accurate insights about the user's habit data using the analytics tools.

Current date: ${today}
Current year: ${currentYear}
Timezone: ${timezone || 'UTC'}

IMPORTANT: All statistics come from the Python backend (single source of truth).
- "average" means total divided by DAYS WITH DATA (not per entry)
- Always use tools to get real data - never make up numbers

=== TOOL ROUTING GUIDE ===

FOR OVERVIEW/INSIGHTS QUESTIONS ("what changed", "insights", "how am I doing", "overview", "progress", "lately"):
→ Use getHabitTrends (leave habitName empty to get ALL habits)
→ Summarize top 3 improving and top 3 declining habits
→ Include percent change and confidence level in your response
→ If confidence is "low", mention "limited data"
→ If user asks what they were doing on computer/screen this week (or similar), ALSO call searchContextMemory

FOR COMPREHENSIVE WEEKLY HABIT RECAP QUESTIONS ("How did my habits do this week?", "weekly habit recap", "weekly habit summary"):
→ Use getWeeklyOverview
→ Include totals, averages, minimums, and maximums for each habit with data
→ Include computer time totals and top apps/domains breakdown
→ Keep numbers precise and concise
→ Format recap as sections per habit: Total, Average, Minimum, Maximum

FOR DAILY HABIT RECAP QUESTIONS ("How did my habits do today?", "today habit summary", "daily habit recap"):
→ Use getDailyOverview
→ Treat "today" as the current local day in the user's timezone
→ Include totals, averages, minimums, and maximums for each habit with data
→ Include computer time totals and top apps/domains breakdown

FOR MONTHLY/LAST-30-DAYS HABIT RECAP QUESTIONS ("How did my habits do this month?", "last 30 days of habits", "monthly habit summary"):
→ Use getMonthlyOverview
→ The range is rolling last 30 days ending today
→ Include totals, averages, minimums, and maximums for each habit with data
→ Include computer time totals and top apps/domains breakdown

FOR SPECIFIC HABIT QUESTIONS ("How's my sleep?", "Tell me about my workouts"):
→ Call BOTH getHabitStats AND getDailyBreakdown with same date range
→ The user sees a side panel with daily breakdown - it REQUIRES getDailyBreakdown data

FOR ANOMALY/OUTLIER QUESTIONS ("weird days", "spikes", "drops", "unusual", "outliers"):
→ Use getHabitAnomalies for the specific habit mentioned
→ Reference specific dates and values in your response
→ If a trend shows extreme change with high confidence, suggest checking anomalies

FOR RELATIONSHIP QUESTIONS ("connection between X and Y", "correlation"):
→ Use getCorrelation
→ State the coefficient and what it means

FOR CONTEXT MEMORY / COMPUTER ACTIVITY QUESTIONS ("what did I work on today", "what did I do this morning", "what was I working on", "when did I look at", "find when I was", "what apps did I use", "show me what I was doing", "what did I do this week on my computer"):
→ Use searchContextMemory with a natural language query
→ The search uses visible context from active apps/tabs, with legacy OCR only as fallback
→ Summarize what was found: apps used, content viewed, approximate times
→ If results include visible text/content, mention key details
→ For "what was I working on/doing" requests, infer tasks from snippets/windows and chronology, not total app-hour metrics
→ Only discuss total app time if the user explicitly asks a time-spent question
→ Time is returned as ISO timestamp - convert to readable format
→ Output style should feel like a clean AI summary: 1 short summary paragraph + up to 4 concise bullets
→ Prioritize synthesis over raw dumps; do not list every matched moment
→ Never paste raw internal warning strings; convert caveats into one plain-English sentence max
→ No markdown tables unless user explicitly asks
→ If no results, suggest trying specific app names, URLs, or keywords

FOR COMPUTER TIME-SPENT BREAKDOWN QUESTIONS ("what did I spend my time on", "where did my time go on my computer", "how much time did I spend on X", "what app did I spend the most time in"):
→ Use getComputerTimeSpentBreakdown
→ Keep the user wording in query
→ Default groupBy to "app" unless user asks for website/domain/window breakdown
→ Present the returned summary as clean prose and bullets (no markdown tables unless explicitly requested)
→ Treat this as an executive summary, not a telemetry dump
→ Clarify estimates are from visible-context/hybrid matched moments (not exact timers)

=== RESPONSE FORMAT ===
1. Brief intro (1-2 sentences)
2. Key findings with **bold** numbers
3. For trends: mention direction (↑/↓) and percent change
4. For anomalies: cite specific dates
5. For low confidence data: say "Note: limited data for this period"
6. End with 1-2 actionable insights

Keep it concise - the user sees detailed data in a side panel.

=== DATE HANDLING ===
- Use current year (${currentYear}) unless explicitly specified
- "this month" → startDate = first of current month, endDate = today
- Month names without year → use ${currentYear}
- Relative windows ("today", "this week", "last week", "this month", "last month") are resolved by backend query routing; avoid hard-coding daysBack for those phrases.

=== CONSTRAINTS ===
- NEVER list every single day's data - user sees that in side panel
- NEVER make up numbers - all data comes from tools
- Max 2 tool call rounds for performance
- Be encouraging and supportive!`;

    // Voice-style prompt addition (Phase 4A)
    const voiceStylePrompt = `

=== VOICE STYLE MODE (ACTIVE) ===
You are now in conversational voice mode. Respond as if speaking aloud.

RULES:
1. BE BRIEF: 2-6 short sentences max. No long paragraphs.
2. SPEAK NATURALLY: Short sentences, conversational tone. No markdown tables. No "Here are 10 things..."
3. END WITH ONE QUESTION: Always end with a simple follow-up question offering a choice.
   Examples: "Want the last 7 days or last 30?" / "Should I check for anomalies?" / "Compare with another habit?"
4. NUMBERS FROM TOOLS ONLY: Same grounding rules. If confidence is low, say so in one sentence.
5. NO UI REFERENCES: Don't say "in the canvas panel" - instead say "I can show a breakdown if you want."

FORMAT:
- Summary (1-2 sentences with key number)
- Key insight (1 sentence)
- Follow-up question (ends with ?)

Keep total response under 500 characters when possible.`;

    // Build the full system prompt
    const fullSystemPrompt = isVoiceMode ? systemPrompt + voiceStylePrompt : systemPrompt;
    const latestUserContent = latestUserMessage?.content || '';
    const forceScreenTimeBreakdown = isScreenTimeSpentQuery(latestUserContent);
    const forceContextRecap = !forceScreenTimeBreakdown && isContextMemoryRecapQuery(latestUserContent);
    const forceDailyOverview = isDailyOverviewQuery(latestUserContent);
    const forceMonthlyOverview = !forceDailyOverview && isMonthlyOverviewQuery(latestUserContent);
    const forceWeeklyOverview =
      !forceContextRecap &&
      !forceDailyOverview &&
      !forceMonthlyOverview &&
      isComprehensiveWeeklyRecapQuery(latestUserContent);
    const forcedToolName = forceScreenTimeBreakdown
      ? 'getComputerTimeSpentBreakdown'
      : forceContextRecap
        ? 'searchContextMemory'
      : forceDailyOverview
        ? 'getDailyOverview'
        : forceMonthlyOverview
          ? 'getMonthlyOverview'
          : forceWeeklyOverview
            ? 'getWeeklyOverview'
            : null;
    const strictThisWeekForWeeklyOverview = isExplicitThisWeekQuery(latestUserContent);

    // Fast path: for deterministic recap tools in text mode, skip OpenAI and
    // render directly from the tool payload so routing and structure stay stable.
    const deterministicFastPath =
      !isVoiceMode &&
      forcedToolName &&
      ['getWeeklyOverview', 'getDailyOverview', 'getMonthlyOverview', 'searchContextMemory'].includes(forcedToolName);

    if (deterministicFastPath) {
      console.log(`⚡ Fast-path: skipping OpenAI, executing ${forcedToolName} directly`);

      const toolResults: ChatToolResults = { allStats: [], allBreakdowns: [] };
      let toolResultJson: string;

      switch (forcedToolName) {
        case 'getWeeklyOverview':
          toolResultJson = await executeGetWeeklyOverview(
            token,
            { daysBack: 7 },
            timezone,
            strictThisWeekForWeeklyOverview,
          );
          break;
        case 'getDailyOverview':
          toolResultJson = await executeGetDailyOverview(token, {}, timezone);
          break;
        case 'getMonthlyOverview':
          toolResultJson = await executeGetMonthlyOverview(token, {}, timezone);
          break;
        case 'searchContextMemory':
          toolResultJson = await executeSearchContextMemory(
            token,
            {
              query: latestUserContent,
              daysBack: inferScreenDaysBackFromQuery(latestUserContent, 7),
              limit: 12,
            },
          );
          break;
        default:
          toolResultJson = JSON.stringify({ success: false, error: 'Unknown overview tool' });
      }

      try {
        const parsed = JSON.parse(toolResultJson);
        if (parsed.success) {
          if (forcedToolName === 'getWeeklyOverview') toolResults.weeklyOverview = parsed;
          else if (forcedToolName === 'getDailyOverview') toolResults.dailyOverview = parsed;
          else if (forcedToolName === 'searchContextMemory') toolResults.screenRecordings = parsed;
          else toolResults.monthlyOverview = parsed;

          if (parsed.suggested_followups) {
            toolResults.suggested_followups = parsed.suggested_followups;
          }
        }
      } catch {}

      const title =
        forcedToolName === 'getDailyOverview'
          ? 'Daily Activity Overview'
          : forcedToolName === 'searchContextMemory'
            ? formatNarrativeDateLabel(toolResults.screenRecordings || {}, latestUserContent, timezone)
          : forcedToolName === 'getMonthlyOverview'
            ? 'Monthly Activity Overview'
            : 'Weekly Activity Overview';

      const overviewPayload =
        toolResults.weeklyOverview || toolResults.dailyOverview || toolResults.monthlyOverview || toolResults.screenRecordings;

      const finalText = overviewPayload?.success
        ? forcedToolName === 'searchContextMemory'
          ? buildContextMemoryNarrative(overviewPayload, latestUserContent, timezone)
          : buildWeeklyOverviewNarrative(overviewPayload as WeeklyOverviewPayload, title)
        : 'I was unable to retrieve your data. Please try again.';

      const canvasToolPayload = buildCanvasToolPayload(toolResults);

      console.log('📦 Tool results collected:', Object.keys(toolResults));
      console.log('📦 Canvas payload keys:', Object.keys(canvasToolPayload || {}));

      if (conversationId) {
        saveMessage(token, conversationId, 'assistant', finalText, canvasToolPayload).catch(err => {
          console.error('❌ Failed to save assistant message:', err);
        });
      }

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          if (conversationId) {
            controller.enqueue(encoder.encode(`__CONVERSATION_ID__${conversationId}__END_CONVERSATION_ID__\n`));
          }

          const words = finalText.split(' ');
          const chunkSize = 5;
          for (let i = 0; i < words.length; i += chunkSize) {
            const chunkWords = words.slice(i, i + chunkSize);
            const chunk = (i === 0 ? '' : ' ') + chunkWords.join(' ');
            controller.enqueue(encoder.encode(`0:${JSON.stringify(chunk)}\n`));
            await new Promise(resolve => setTimeout(resolve, 5));
          }

          if (canvasToolPayload) {
            controller.enqueue(encoder.encode(`\n__TOOL_DATA__${JSON.stringify(canvasToolPayload)}__END_TOOL_DATA__\n`));
          }

          controller.close();
        },
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    }

    // Build messages for OpenAI
    const apiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: fullSystemPrompt },
      ...messages.map((m: { role: string; content: string }) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    ];

    // Call OpenAI
    let response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: apiMessages,
      tools,
      tool_choice: forcedToolName
        ? { type: 'function', function: { name: forcedToolName } }
        : 'auto',
      temperature: 0.7,
    });

    let assistantMessage = response.choices[0].message;

    // Collect tool results for frontend canvas
    // Note: For multi-habit/multi-period queries, we accumulate results
    const toolResults: ChatToolResults = {
      allStats: [],
      allBreakdowns: []
    };

    // Handle tool calls (loop up to 5 times for complex queries)
    let iterations = 0;
    while (assistantMessage.tool_calls && iterations < 5) {
      iterations++;
      console.log(`🔧 Tool call iteration ${iterations}:`, assistantMessage.tool_calls.map(t => t.function.name));
      
      apiMessages.push(assistantMessage);

      for (const toolCall of assistantMessage.tool_calls) {
        const args = JSON.parse(toolCall.function.arguments || '{}');
        let result: string;

        try {
          switch (toolCall.function.name) {
            case 'getHabitStats':
              result = await executeGetHabitStats(token, args);
              // Store stats for canvas - accumulate all calls
              try {
                const parsed = JSON.parse(result);
                if (parsed.success && parsed.habits) {
                  // Accumulate all stats calls for multi-habit queries
                  toolResults.allStats = toolResults.allStats || [];
                  toolResults.allStats.push(...parsed.habits);
                  // Also keep the most recent for backwards compatibility
                  toolResults.stats = parsed.habits;
                }
              } catch {}
              break;
            case 'getDailyBreakdown':
              result = await executeGetDailyBreakdown(token, args, timezone);
              // Store daily breakdown for canvas - accumulate all calls
              try {
                const parsed = JSON.parse(result);
                if (parsed.success) {
                  // Accumulate all breakdown calls for multi-period queries
                  toolResults.allBreakdowns = toolResults.allBreakdowns || [];
                  if (parsed.habit && parsed.data) {
                    toolResults.allBreakdowns.push({
                      habit: parsed.habit,
                      data: parsed.data
                    });
                  }
                  // Keep the most recent/primary for backwards compatibility
                  // Use the FIRST breakdown (usually the main habit being asked about)
                  if (!toolResults.dailyBreakdown || toolResults.dailyBreakdown.length === 0) {
                    toolResults.dailyBreakdown = parsed.data || [];
                    if (parsed.habit) {
                      toolResults.dailyBreakdownHabit = parsed.habit;
                    }
                  }
                }
              } catch {}
              break;
            case 'getCorrelation':
              result = await executeGetCorrelation(token, args);
              // Store correlation for canvas
              try {
                const parsed = JSON.parse(result);
                if (parsed.success) {
                  toolResults.correlation = parsed;
                }
              } catch {}
              break;
            case 'listHabits':
              result = await executeListHabits(token);
              break;
            case 'getHabitTrends':
              result = await executeGetHabitTrends(token, args);
              // Store trends for canvas
              try {
                const parsed = JSON.parse(result);
                if (parsed.success) {
                  toolResults.trends = parsed;
                  // Capture suggested follow-ups
                  if (parsed.suggested_followups) {
                    toolResults.suggested_followups = parsed.suggested_followups;
                  }
                }
              } catch {}
              break;
            case 'getWeeklyOverview':
              result = await executeGetWeeklyOverview(
                token,
                args,
                timezone,
                strictThisWeekForWeeklyOverview,
              );
              // Store weekly overview for canvas
              try {
                const parsed = JSON.parse(result);
                if (parsed.success) {
                  toolResults.weeklyOverview = parsed;
                  if (parsed.suggested_followups) {
                    toolResults.suggested_followups = parsed.suggested_followups;
                  }
                }
              } catch {}
              break;
            case 'getDailyOverview':
              result = await executeGetDailyOverview(token, args, timezone);
              try {
                const parsed = JSON.parse(result);
                if (parsed.success) {
                  toolResults.dailyOverview = parsed;
                  if (parsed.suggested_followups) {
                    toolResults.suggested_followups = parsed.suggested_followups;
                  }
                }
              } catch {}
              break;
            case 'getMonthlyOverview':
              result = await executeGetMonthlyOverview(token, args, timezone);
              try {
                const parsed = JSON.parse(result);
                if (parsed.success) {
                  toolResults.monthlyOverview = parsed;
                  if (parsed.suggested_followups) {
                    toolResults.suggested_followups = parsed.suggested_followups;
                  }
                }
              } catch {}
              break;
            case 'getHabitAnomalies':
              result = await executeGetHabitAnomalies(token, args);
              // Store anomalies for canvas
              try {
                const parsed = JSON.parse(result);
                if (parsed.success) {
                  toolResults.anomalies = parsed;
                  // Capture suggested follow-ups (merge with existing)
                  if (parsed.suggested_followups) {
                    toolResults.suggested_followups = [
                      ...(toolResults.suggested_followups || []),
                      ...parsed.suggested_followups
                    ].slice(0, 3);  // Max 3 suggestions
                  }
                }
              } catch {}
              break;
            case 'searchScreenRecordings':
              {
                const normalizedArgs = {
                  ...args,
                  query: chooseScreenSearchQuery(args?.query, latestUserContent),
                };
                result = await executeSearchContextMemory(token, normalizedArgs);
              }
              // Store screen recording results for canvas
              try {
                const parsed = JSON.parse(result);
                console.log('🖥️ screen tool parsed status:', {
                  success: parsed?.success,
                  result_count: parsed?.result_count,
                  status: parsed?.status,
                  mode_used: parsed?.mode_used,
                });
                if (parsed.success && parsed.results) {
                  toolResults.screenRecordings = parsed;
                }
              } catch {}
              break;
            case 'searchContextMemory':
              {
                const normalizedArgs = {
                  ...args,
                  query: chooseScreenSearchQuery(args?.query, latestUserContent),
                };
                result = await executeSearchContextMemory(token, normalizedArgs);
              }
              try {
                const parsed = JSON.parse(result);
                if (parsed.success && parsed.results) {
                  toolResults.screenRecordings = parsed;
                }
              } catch {}
              break;
            case 'getComputerTimeSpentBreakdown':
              result = await executeGetComputerTimeSpentBreakdown(
                token,
                args,
                normalizedScreenSearchContext,
                timezone,
              );
              try {
                const parsed = JSON.parse(result);
                if (parsed.success) {
                  toolResults.screenTimeSpent = parsed;
                }
              } catch {}
              break;
            default:
              result = JSON.stringify({ error: `Unknown tool: ${toolCall.function.name}` });
          }
        } catch (error) {
          console.error(`❌ Tool ${toolCall.function.name} error:`, error);
          result = JSON.stringify({ error: String(error) });
        }

        console.log(`📊 Tool ${toolCall.function.name} result length:`, result.length);

        apiMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: result,
        });
      }

      response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: apiMessages,
        tools,
        tool_choice: 'auto',
        temperature: 0.7,
      });

      assistantMessage = response.choices[0].message;
    }

    let finalText = assistantMessage.content || 'I was unable to process your request.';
    
    // Apply voice mode post-processing (Phase 4A)
    if (isVoiceMode) {
      console.log('🎤 Applying voice mode post-processing');
      finalText = formatVoiceResponse(finalText);
      
      // Generate reply chips for voice mode
      const replyChips = generateReplyChips(toolResults);
      toolResults.reply_chips = replyChips;
      console.log('💬 Generated reply chips:', replyChips);
    }

    // Use deterministic recap text so streamed answers stay consistent and clean.
    if (!isVoiceMode && toolResults.dailyOverview?.success) {
      finalText = buildWeeklyOverviewNarrative(
        toolResults.dailyOverview as WeeklyOverviewPayload,
        'Daily Activity Overview',
      );
    } else if (!isVoiceMode && toolResults.screenRecordings?.success && forceContextRecap) {
      finalText = buildContextMemoryNarrative(
        toolResults.screenRecordings,
        latestUserContent,
        timezone,
      );
    } else if (!isVoiceMode && toolResults.monthlyOverview?.success) {
      finalText = buildWeeklyOverviewNarrative(
        toolResults.monthlyOverview as WeeklyOverviewPayload,
        'Monthly Activity Overview',
      );
    } else if (!isVoiceMode && toolResults.weeklyOverview?.success) {
      finalText = buildWeeklyOverviewNarrative(
        toolResults.weeklyOverview as WeeklyOverviewPayload,
        'Weekly Activity Overview',
      );
    }
    
    // Merge breakdown data if multiple calls were made for the same habit
    if (toolResults.allBreakdowns && toolResults.allBreakdowns.length > 1) {
      // Check if all breakdowns are for the same habit
      const habitIds = toolResults.allBreakdowns.map(b => b.habit?.id).filter(Boolean);
      const uniqueHabitIds = [...new Set(habitIds)];
      
      if (uniqueHabitIds.length === 1) {
        // Same habit, different periods - merge the data
        const mergedData: any[] = [];
        const seenDates = new Set<string>();
        
        for (const breakdown of toolResults.allBreakdowns) {
          for (const entry of (breakdown.data || [])) {
            if (!seenDates.has(entry.date)) {
              seenDates.add(entry.date);
              mergedData.push(entry);
            }
          }
        }
        
        // Sort by date
        mergedData.sort((a, b) => a.date.localeCompare(b.date));
        
        // Update the primary breakdown with merged data
        toolResults.dailyBreakdown = mergedData;
        toolResults.dailyBreakdownHabit = toolResults.allBreakdowns[0].habit;
        
        console.log('📦 Merged breakdown data from', toolResults.allBreakdowns.length, 'calls:', mergedData.length, 'entries');
      }
    }
    
    const canvasToolPayload = buildCanvasToolPayload(toolResults);

    // Log tool results being sent
    console.log('📦 Tool results collected:', Object.keys(toolResults));
    console.log('📦 Canvas payload keys:', Object.keys(canvasToolPayload || {}));

    // Save assistant message with tool payload (fire and forget)
    if (conversationId) {
      saveMessage(token, conversationId, 'assistant', finalText, canvasToolPayload).catch(err => {
        console.error('❌ Failed to save assistant message:', err);
      });
    }

    // Stream response in chunks for faster perceived performance
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        // Send conversation ID first so client can track it
        if (conversationId) {
          controller.enqueue(encoder.encode(`__CONVERSATION_ID__${conversationId}__END_CONVERSATION_ID__\n`));
        }
        
        // Stream in larger chunks (sentences or phrases) for faster delivery
        // while still providing a streaming feel
        const words = finalText.split(' ');
        const chunkSize = 5; // Send 5 words at a time for balance
        
        for (let i = 0; i < words.length; i += chunkSize) {
          const chunkWords = words.slice(i, i + chunkSize);
          const chunk = (i === 0 ? '' : ' ') + chunkWords.join(' ');
          controller.enqueue(encoder.encode(`0:${JSON.stringify(chunk)}\n`));
          // Minimal delay just to give streaming feel without slowing down
          await new Promise(resolve => setTimeout(resolve, 5));
        }
        
        // Send tool results as metadata for canvas
        if (canvasToolPayload) {
          controller.enqueue(encoder.encode(`\n__TOOL_DATA__${JSON.stringify(canvasToolPayload)}__END_TOOL_DATA__\n`));
        }
        
        controller.close();
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error) {
    console.error('Chat API error:', error);
    return new Response(JSON.stringify({ 
      error: 'Error processing request',
      details: error instanceof Error ? error.message : 'Unknown error'
    }), { 
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
}
