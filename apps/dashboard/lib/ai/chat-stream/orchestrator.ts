import { NextRequest } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import OpenAI from 'openai';
import { buildWeeklyOverviewCanvasPayload, getStrictThisWeekRange } from '@/lib/ai/chat-stream/weekly-overview-utils.mjs';

const PYTHON_API_BASE = process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';

function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured');
  }
  return new OpenAI({ apiKey });
}

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
  contextMemoryRecap?: any;
  screenTimeSpent?: any;
  weeklyOverview?: any;
  dailyOverview?: any;
  monthlyOverview?: any;
  allStats?: any[];
  allBreakdowns?: { habit: any; data: any[] }[];
  activitySummary?: any;
  dailyBiometrics?: any;
  screenTimeSummary?: any;
  calendarEvents?: any;
  suggested_followups?: string[];
  reply_chips?: string[];
};

type LocalOverviewActivityBundle = {
  startDate?: string;
  endDate?: string;
  daily?: Array<{
    day?: string;
    active_hours?: number;
    events_count?: number;
    apps_count?: number;
  }>;
  apps?: Array<{
    app_bundle_id?: string;
    app_name?: string;
    hours?: number;
    total_events?: number;
  }>;
  domains?: Array<{
    domain?: string;
    hours?: number;
    total_events?: number;
  }>;
  source?: string;
};

function selectLocalOverviewActivityBundle(
  bundles: unknown,
  startDate: string,
  endDate: string,
): LocalOverviewActivityBundle | null {
  if (!Array.isArray(bundles)) return null;
  const match = bundles.find((bundle) => {
    const candidate = bundle as LocalOverviewActivityBundle;
    return candidate?.startDate === startDate && candidate?.endDate === endDate;
  });
  return (match as LocalOverviewActivityBundle) || null;
}

function buildCanvasToolPayload(toolResults: ChatToolResults): Record<string, unknown> | null {
  const payload: Record<string, unknown> = {
    stats: toolResults.stats,
    dailyBreakdown: toolResults.dailyBreakdown,
    dailyBreakdownHabit: toolResults.dailyBreakdownHabit,
    correlation: toolResults.correlation,
    trends: toolResults.trends,
    anomalies: toolResults.anomalies,
    screenTimeSpent: toolResults.screenTimeSpent,
    weeklyOverview: toolResults.weeklyOverview,
    dailyOverview: toolResults.dailyOverview,
    monthlyOverview: toolResults.monthlyOverview,
    allStats: toolResults.allStats,
    allBreakdowns: toolResults.allBreakdowns,
    activitySummary: toolResults.activitySummary,
    dailyBiometrics: toolResults.dailyBiometrics,
    screenTimeSummary: toolResults.screenTimeSummary,
    calendarEvents: toolResults.calendarEvents,
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

function isExplicitLastWeekQuery(text: string): boolean {
  const normalized = (text || '').toLowerCase();
  return normalized.includes('last week');
}

function resolveWeeklyOverviewParamsFromQuery(
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

function getOverviewTitleFromQuery(
  toolName: string | null,
  query: string,
  contextMemoryRecap?: unknown,
  timezone?: string,
): string {
  if (toolName === 'getDailyOverview') return 'Daily Activity Overview';
  if (toolName === 'getActivitySummary') {
    return formatNarrativeDateLabel(contextMemoryRecap || {}, query, timezone);
  }
  if (toolName === 'searchContextMemory') {
    return formatNarrativeDateLabel(contextMemoryRecap || {}, query, timezone);
  }
  if (toolName === 'getMonthlyOverview') return 'Monthly Activity Overview';
  if (toolName === 'getWeeklyOverview' && isExplicitLastWeekQuery(query)) {
    return 'Last Week Overview';
  }
  return 'Weekly Activity Overview';
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
    'activity recap',
    'activity overview',
    'screen recap',
    'screen overview',
  ];

  if (explicitPatterns.some((pattern) => normalized.includes(pattern))) {
    return true;
  }

  const hasWorkVerb = /\b(work(?:ed|ing)? on|get done|accomplish(?:ed)?|doing|look(?:ed|ing) at|happened in|planning|research|reading)\b/.test(normalized);
  const hasContextTarget =
    hasRelativeTimeHint(normalized) ||
    parseExplicitRecapAnchorDate(normalized) !== null ||
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

function formatWorkstreamTimeRange(
  startTs: unknown,
  endTs: unknown,
  timezone?: string,
): string {
  const start = formatContextTimestamp(startTs, timezone);
  const end = formatContextTimestamp(endTs, timezone);
  if (start && end && start !== end) return `${start} - ${end}`;
  return start || end || '';
}

function renderWorkstreamSection(
  item: any,
  timezone?: string,
): string[] {
  const sectionLines: string[] = [];
  const label = clipContextText(item?.label || item?.title || 'Workstream', 120);
  const timeRange = formatWorkstreamTimeRange(item?.start_ts, item?.end_ts, timezone);
  const seqNum = item?.sequence_number || 0;
  const interactionLevel = item?.interaction_level || 'present';

  // For brief passive visits, render a single concise line instead of a full section
  if (interactionLevel === 'passive_brief') {
    const apps = Array.isArray(item?.apps) ? item.apps : [];
    const appName = apps[0] || label;
    const briefLine = seqNum > 0
      ? `${seqNum}. Briefly checked ${appName}`
      : `- Briefly checked ${appName}`;
    if (timeRange) {
      sectionLines.push(`${briefLine} *(${timeRange})*`);
    } else {
      sectionLines.push(briefLine);
    }
    return sectionLines;
  }

  // For task manager items without corroborating artifacts, use "viewed tasks" language
  if (interactionLevel === 'task_viewed') {
    const apps = Array.isArray(item?.apps) ? item.apps : [];
    const appName = apps[0] || label;
    const specificTasks = Array.isArray(item?.specific_tasks) ? item.specific_tasks : [];
    const taskDetail = specificTasks.length > 0
      ? `: "${clipContextText(specificTasks[0], 120)}"`
      : '';
    const viewedLine = seqNum > 0
      ? `${seqNum}. Viewed/added tasks in ${appName}${taskDetail}`
      : `- Viewed/added tasks in ${appName}${taskDetail}`;
    if (timeRange) {
      sectionLines.push(`${viewedLine} *(${timeRange})*`);
    } else {
      sectionLines.push(viewedLine);
    }
    return sectionLines;
  }

  // Bold heading (not markdown ### — avoids LLM passing through as section headers)
  const heading = `**${label}**`;
  sectionLines.push(heading);
  if (timeRange) {
    sectionLines.push(`*${timeRange}*`);
  }

  // Canonical identity context (repo/branch) — gives grounding like Littlebird
  const repoRoot = item?.repo_root ? String(item.repo_root).split('/').pop() || '' : '';
  const branch = item?.branch || '';
  if (repoRoot && branch) {
    sectionLines.push(`*${repoRoot} — ${branch}*`);
  } else if (repoRoot) {
    sectionLines.push(`*${repoRoot}*`);
  }

  // Collect all evidence into a structured block for LLM synthesis
  const specificTasks = Array.isArray(item?.specific_tasks) ? item.specific_tasks : [];
  const files = Array.isArray(item?.file_artifacts) ? item.file_artifacts : [];
  const commands = Array.isArray(item?.command_artifacts) ? item.command_artifacts : [];
  const commits = Array.isArray(item?.commit_artifacts) ? item.commit_artifacts : [];
  const gitOps = Array.isArray(item?.git_op_artifacts) ? item.git_op_artifacts : [];
  const errors = Array.isArray(item?.error_artifacts) ? item.error_artifacts : [];
  const taskDocs = Array.isArray(item?.task_doc_artifacts) ? item.task_doc_artifacts : [];
  const apps = Array.isArray(item?.apps) ? item.apps : [];
  const confidence = item?.confidence || 0;
  const durationMs = item?.duration_ms || 0;
  const durationMin = durationMs > 0 ? Math.round(durationMs / 60000) : 0;

  // Provide evidence as a synthesis block — the LLM weaves these into prose
  sectionLines.push('[EVIDENCE FOR SYNTHESIS — weave into narrative prose, do not list mechanically]');

  if (specificTasks.length > 0) {
    sectionLines.push(`Activities: ${specificTasks.slice(0, 6).map((t: string) => clipContextText(t, 160)).join(' | ')}`);
  }

  if (files.length > 0) {
    sectionLines.push(`Files modified: ${files.slice(0, 10).map((f: string) => `\`${f}\``).join(', ')}`);
  }

  if (commands.length > 0) {
    sectionLines.push(`Commands: ${commands.slice(0, 5).map((c: string) => `\`${c}\``).join(', ')}`);
  }

  const allGit = [...commits.slice(0, 3), ...gitOps.slice(0, 3)];
  if (allGit.length > 0) {
    sectionLines.push(`Git activity: ${allGit.map((g: string) => clipContextText(g, 80)).join(', ')}`);
  }

  if (errors.length > 0) {
    sectionLines.push(`Errors encountered: ${errors.slice(0, 3).map((e: string) => clipContextText(e, 140)).join('; ')}`);
  }

  if (taskDocs.length > 0) {
    sectionLines.push(`Task references: ${taskDocs.slice(0, 3).join(', ')}`);
  }

  if (apps.length > 0) {
    sectionLines.push(`Apps: ${apps.join(', ')}`);
  }

  if (durationMin > 0) {
    sectionLines.push(`Duration: ~${durationMin} min`);
  }

  if (confidence > 0 && confidence < 0.5) {
    sectionLines.push(`Note: low confidence (${(confidence * 100).toFixed(0)}%) — use cautious language`);
  }

  sectionLines.push('[END EVIDENCE]');

  return sectionLines;
}

function getWorkstreamSortTimestamp(item: any): number {
  const startTs = Number(item?.start_ts || 0);
  const endTs = Number(item?.end_ts || 0);
  if (Number.isFinite(startTs) && startTs > 0) return startTs;
  if (Number.isFinite(endTs) && endTs > 0) return endTs;
  return Number.MAX_SAFE_INTEGER;
}

function sortWorkstreamsChronologically(items: any[]): any[] {
  return [...items].sort((a: any, b: any) => {
    const aTs = getWorkstreamSortTimestamp(a);
    const bTs = getWorkstreamSortTimestamp(b);
    if (aTs !== bTs) return aTs - bTs;

    const aEnd = Number(a?.end_ts || 0);
    const bEnd = Number(b?.end_ts || 0);
    if (aEnd !== bEnd) return aEnd - bEnd;

    const aSeq = Number(a?.sequence_number || 0);
    const bSeq = Number(b?.sequence_number || 0);
    return aSeq - bSeq;
  });
}

function getNarrativeWorkstreamLimit(query: string, rendererKind: string): number {
  const normalized = (query || '').toLowerCase();
  if (
    rendererKind === 'daypart_overview'
    || rendererKind === 'broad_overview'
    || /\b(what did i (work on|do|get done)|activity summary|recap)\b/.test(normalized)
  ) {
    return 12;
  }
  return 8;
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
  const numberedWorkstreams = Array.isArray(storyPlan.numbered_workstreams) ? storyPlan.numbered_workstreams : [];
  const corroboratingActivity = Array.isArray(storyPlan.corroborating_activity) ? storyPlan.corroborating_activity : [];
  const filesTouched = Array.isArray(storyPlan.files_touched) ? storyPlan.files_touched : [];
  const commandsRun = Array.isArray(storyPlan.commands_run) ? storyPlan.commands_run : [];
  const errorsEncountered = Array.isArray(storyPlan.errors_encountered) ? storyPlan.errors_encountered : [];
  const commitsAndPushes = Array.isArray(storyPlan.commits_and_pushes) ? storyPlan.commits_and_pushes : [];
  const heading = formatNarrativeDateLabel(payload, query, timezone);
  const maxWorkstreamsToRender = getNarrativeWorkstreamLimit(query, rendererKind);
  const lines: string[] = [`## ${heading}`];

  if (!mainEvent && results.length === 0) {
    if (payload.message) lines.push('', payload.message);
    return lines.join('\n');
  }

  // --- App Drilldown: Numbered workstream rendering ---
  if (rendererKind === 'app_drilldown') {
    const appName = Array.isArray(mainEvent?.apps) && mainEvent.apps.length > 0
      ? String(mainEvent.apps[0])
      : results[0]?.app_name || 'that app';

    // Compute overall time range from ALL workstreams (not just main event)
    const allWorkstreams = numberedWorkstreams.length > 0
      ? numberedWorkstreams
      : [mainEvent, ...supporting].filter(Boolean);
    let minTs = mainEvent?.start_ts || 0;
    let maxTs = mainEvent?.end_ts || 0;
    for (const ws of allWorkstreams) {
      if (ws?.start_ts && (!minTs || ws.start_ts < minTs)) minTs = ws.start_ts;
      if (ws?.end_ts && ws.end_ts > maxTs) maxTs = ws.end_ts;
    }
    const overallTimeRange = formatWorkstreamTimeRange(minTs || undefined, maxTs || undefined, timezone);
    if (overallTimeRange) {
      lines.push('', `**${appName} (${overallTimeRange})**`);
    } else {
      lines.push('', `**${appName}**`);
    }

    // Render numbered workstreams
    const workstreamsToRender = sortWorkstreamsChronologically(numberedWorkstreams.length > 0
      ? numberedWorkstreams.filter((ws: any) => ws?.label && ws.label !== 'General workstream')
      : [mainEvent, ...supporting].filter(Boolean));

    for (const item of workstreamsToRender.slice(0, maxWorkstreamsToRender)) {
      lines.push('');
      lines.push(...renderWorkstreamSection(item, timezone));
    }

    // If no workstreams had files but we have top-level files, show them
    const workstreamHasFiles = workstreamsToRender.some((ws: any) =>
      Array.isArray(ws?.file_artifacts) && ws.file_artifacts.length > 0
    );
    if (!workstreamHasFiles && filesTouched.length > 0) {
      lines.push('', '[EVIDENCE FOR SYNTHESIS — weave into narrative prose, do not list mechanically]');
      lines.push(`Files modified: ${filesTouched.slice(0, 10).map((f: string) => `\`${f}\``).join(', ')}`);
      lines.push('[END EVIDENCE]');
    }

    // Corroborating activity from other apps
    const terminalCorr = corroboratingActivity.filter((c: any) => c?.kind === 'terminal');
    const browserCorr = corroboratingActivity.filter((c: any) => c?.kind === 'browser');
    const hasGitOps = commitsAndPushes.length > 0;
    const hasCorr = terminalCorr.length > 0 || browserCorr.length > 0 || hasGitOps || errorsEncountered.length > 0;

    if (hasCorr) {
      lines.push('', '[ADDITIONAL EVIDENCE — weave into workstream narratives where relevant]');
      if (terminalCorr.length > 0) {
        const termCmds = _dedupeStrings(terminalCorr.flatMap((c: any) => c?.commands || []).concat(commandsRun)).slice(0, 6);
        if (termCmds.length > 0) {
          lines.push(`Terminal commands: ${termCmds.map((c: string) => `\`${c}\``).join(', ')}`);
        }
      }
      if (browserCorr.length > 0) {
        const browserSnippets = browserCorr.slice(0, 3).map((c: any) => {
          const domain = c?.domain || '';
          const snippet = clipContextText(c?.snippet || '', 80);
          return domain ? `${domain} (${snippet})` : snippet;
        }).filter(Boolean);
        if (browserSnippets.length > 0) {
          lines.push(`Browser research: ${browserSnippets.join(', ')}`);
        }
      }
      if (hasGitOps) {
        lines.push(`Git activity: ${commitsAndPushes.slice(0, 4).join(', ')}`);
      }
      if (errorsEncountered.length > 0) {
        for (const err of errorsEncountered.slice(0, 3)) {
          lines.push(`Error: ${clipContextText(err, 140)}`);
        }
      }
      lines.push('[END ADDITIONAL EVIDENCE]');
    }

    // Documents — included as evidence for the LLM to weave into narrative
    if (documents.length > 0 && filesTouched.length === 0) {
      lines.push('', '[EVIDENCE FOR SYNTHESIS — weave into narrative prose, do not list mechanically]');
      lines.push(`Documents: ${documents.slice(0, 5).map((d: any) => clipContextText(d?.label || d?.title || 'Document', 160)).join(', ')}`);
      lines.push('[END EVIDENCE]');
    }

  // --- Daypart/Broad Overview: Numbered workstream rendering ---
  } else if (rendererKind === 'daypart_overview' || rendererKind === 'broad_overview') {
    // Provide claim cards as high-level narrative seeds for the LLM
    const relevantClaims = claimCards.filter((card: any) =>
      card?.claim_text && card.claim_kind !== 'uncertainty'
    );
    if (relevantClaims.length > 0) {
      lines.push('', '[NARRATIVE SEEDS — use these to frame the overall summary]');
      for (const card of relevantClaims.slice(0, 5)) {
        const conf = card.confidence ? ` (confidence: ${(card.confidence * 100).toFixed(0)}%)` : '';
        lines.push(`- ${clipContextText(card.claim_text, 200)}${conf}`);
      }
      lines.push('[END NARRATIVE SEEDS]');
    }

    // Render numbered workstreams for overview too
    const workstreamsToRender = numberedWorkstreams.length > 0
      ? numberedWorkstreams.filter((ws: any) => ws?.label && ws.label !== 'General workstream')
      : [mainEvent, ...supporting].filter(Boolean);

    const overviewWorkstreams = sortWorkstreamsChronologically(
      [...workstreamsToRender, ...researchBrowsing, ...personalActivity].filter(Boolean),
    );

    for (const item of overviewWorkstreams.slice(0, maxWorkstreamsToRender)) {
      lines.push('');
      lines.push(...renderWorkstreamSection(item, timezone));
    }

    // Corroborating activity from terminal/browser
    const terminalCorr = corroboratingActivity.filter((c: any) => c?.kind === 'terminal');
    const browserCorr = corroboratingActivity.filter((c: any) => c?.kind === 'browser');
    const hasCorr = terminalCorr.length > 0 || browserCorr.length > 0 || commitsAndPushes.length > 0 || commandsRun.length > 0;

    if (hasCorr) {
      lines.push('', '[ADDITIONAL EVIDENCE — weave into workstream narratives where relevant]');
      if (terminalCorr.length > 0) {
        const termCmds = _dedupeStrings(terminalCorr.flatMap((c: any) => c?.commands || []).concat(commandsRun)).slice(0, 6);
        if (termCmds.length > 0) {
          lines.push(`Terminal commands: ${termCmds.map((c: string) => `\`${c}\``).join(', ')}`);
        }
      }
      if (browserCorr.length > 0) {
        const browserSnippets = browserCorr.slice(0, 3).map((c: any) => {
          const domain = c?.domain || '';
          const snippet = clipContextText(c?.snippet || '', 80);
          return domain ? `${domain} (${snippet})` : snippet;
        }).filter(Boolean);
        if (browserSnippets.length > 0) {
          lines.push(`Browser research: ${browserSnippets.join(', ')}`);
        }
      }
      if (commitsAndPushes.length > 0) {
        lines.push(`Git activity: ${commitsAndPushes.slice(0, 4).join(', ')}`);
      }
      lines.push('[END ADDITIONAL EVIDENCE]');
    }

    // Uncertainty / caveats
    if (uncertainty.length > 0) {
      lines.push('', '[CAVEATS — mention these honestly in your summary]');
      for (const u of uncertainty.slice(0, 3)) {
        lines.push(`- ${clipContextText(u, 160)}`);
      }
      lines.push('[END CAVEATS]');
    }

  // --- Topic lookup / default ---
  } else {
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

    if (supporting.length > 0) {
      for (const item of supporting.slice(0, 3)) {
        lines.push('');
        lines.push(...renderWorkstreamSection(item, timezone));
      }
    }

    if (tasks.length > 0) {
      lines.push('', '[EVIDENCE FOR SYNTHESIS — weave into narrative prose, do not list mechanically]');
      lines.push(`Completed tasks: ${tasks.slice(0, 5).map((t: string) => clipContextText(t, 140)).join(', ')}`);
      lines.push('[END EVIDENCE]');
    } else if (documents.length > 0) {
      lines.push('', '[EVIDENCE FOR SYNTHESIS — weave into narrative prose, do not list mechanically]');
      lines.push(`Documents: ${documents.slice(0, 4).map((d: any) => clipContextText(d?.label || d?.title || 'Document', 140)).join(', ')}`);
      lines.push('[END EVIDENCE]');
    }
  }

  // Apps list and strongest evidence are available in per-workstream evidence blocks —
  // no separate sections needed. The LLM weaves these into narrative naturally.

  if (uncertainty.length > 0) {
    lines.push('', `*${clipContextText(uncertainty[0], 160)}*`);
  }

  return lines.join('\n');
}

function _dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const v of values) {
    const key = v.toLowerCase().trim();
    if (key && !seen.has(key)) {
      seen.add(key);
      result.push(v);
    }
  }
  return result;
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

function parseExplicitRecapAnchorDate(
  query: string,
  timezone?: string,
): string | null {
  const normalized = (query || '').toLowerCase();
  if (!normalized) return null;

  const monthMap: Record<string, number> = {
    january: 1,
    jan: 1,
    february: 2,
    feb: 2,
    march: 3,
    mar: 3,
    april: 4,
    apr: 4,
    may: 5,
    june: 6,
    jun: 6,
    july: 7,
    jul: 7,
    august: 8,
    aug: 8,
    september: 9,
    sep: 9,
    sept: 9,
    october: 10,
    oct: 10,
    november: 11,
    nov: 11,
    december: 12,
    dec: 12,
  };

  const match = normalized.match(
    /\b(?:on\s+)?(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,\s*|\s+)?(\d{4})?\b/,
  );
  if (!match) return null;

  const month = monthMap[match[1]];
  const day = Number.parseInt(match[2], 10);
  const currentYear = Number.parseInt(getTimezoneYmd(new Date(), timezone).slice(0, 4), 10);
  const year = match[3] ? Number.parseInt(match[3], 10) : currentYear;

  if (!month || !Number.isFinite(day) || day < 1 || day > 31 || !Number.isFinite(year)) {
    return null;
  }

  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year
    || candidate.getUTCMonth() + 1 !== month
    || candidate.getUTCDate() !== day
  ) {
    return null;
  }

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

interface WeeklyOverviewHabitSummary {
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
  daily?: Array<{
    date?: string;
    value?: number;
  }>;
}

interface WeeklyOverviewComputerSummary {
  days_with_data: number;
  total_hours: number;
  average_daily_hours: number;
  min_daily_hours: number;
  max_daily_hours: number;
  daily?: Array<{
    day?: string;
    active_hours?: number;
    events_count?: number;
  }>;
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
    days?: number;
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

function formatWeeklyShortDate(dateInput?: string): string {
  if (!dateInput) return 'Unknown';
  const date = new Date(`${dateInput}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateInput;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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

function normalizeWeeklyHabitName(name?: string): string {
  return String(name || '').trim().toLowerCase();
}

function formatWeeklyNameList(names: string[]): string {
  if (names.length <= 1) return names[0] || '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

function buildWeeklyOverviewSynthesisPayload(payload: WeeklyOverviewPayload) {
  const habits = (Array.isArray(payload.habits) ? payload.habits : [])
    .filter((habit) => (habit.days_with_data || 0) > 0)
    .map((habit) => ({
      name: habit.name,
      category: habit.category,
      unit: habit.unit,
      total: habit.total,
      average: habit.average,
      min: habit.min,
      max: habit.max,
      days_with_data: habit.days_with_data,
      total_entries: habit.total_entries,
      daily: Array.isArray(habit.daily)
        ? habit.daily.map((row) => ({
            date: row.date,
            value: row.value,
          }))
        : [],
    }));

  const computer = payload.computer_activity
    ? {
        days_with_data: payload.computer_activity.days_with_data,
        total_hours: payload.computer_activity.total_hours,
        average_daily_hours: payload.computer_activity.average_daily_hours,
        min_daily_hours: payload.computer_activity.min_daily_hours,
        max_daily_hours: payload.computer_activity.max_daily_hours,
        daily: Array.isArray(payload.computer_activity.daily)
          ? payload.computer_activity.daily.map((row) => ({
              day: row.day,
              active_hours: row.active_hours,
              events_count: row.events_count,
            }))
          : [],
        top_apps: Array.isArray(payload.computer_activity.top_apps)
          ? payload.computer_activity.top_apps.slice(0, 5)
          : [],
        top_domains: Array.isArray(payload.computer_activity.top_domains)
          ? payload.computer_activity.top_domains.slice(0, 5)
          : [],
      }
    : null;

  return {
    date_range: payload.date_range,
    summary: payload.summary,
    habits,
    computer_activity: computer,
  };
}

function findWeeklyPeakPoint(
  points: Array<{ date?: string; value?: number }>,
): { date?: string; value: number } | null {
  const normalizedPoints = [...points]
    .map((point) => ({
      date: point.date,
      value: Number(point.value || 0),
    }))
    .filter((point) => point.date && Number.isFinite(point.value));

  if (normalizedPoints.length === 0) return null;
  return normalizedPoints.reduce((best, point) => (point.value > best.value ? point : best), normalizedPoints[0]);
}

function buildWeeklyOverviewHighlights(payload: WeeklyOverviewPayload): string[] {
  const habits = Array.isArray(payload.habits) ? payload.habits : [];
  const habitsWithData = habits.filter((habit) => (habit.days_with_data || 0) > 0);
  const rangeDays = payload.date_range?.days || 7;
  const computer = payload.computer_activity;

  const sortedByConsistency = [...habitsWithData].sort((a, b) => {
    if ((b.days_with_data || 0) !== (a.days_with_data || 0)) {
      return (b.days_with_data || 0) - (a.days_with_data || 0);
    }
    return (b.total || 0) - (a.total || 0);
  });
  const mostConsistent = sortedByConsistency[0];
  const sleepHabit = habitsWithData.find((habit) => normalizeWeeklyHabitName(habit.name) === 'sleep duration');
  const leadWorkHabit = [...habitsWithData]
    .filter((habit) => normalizeWeeklyHabitName(habit.name) !== 'sleep duration' && Array.isArray(habit.daily) && habit.daily.length > 0)
    .sort((a, b) => {
      if ((b.days_with_data || 0) !== (a.days_with_data || 0)) {
        return (b.days_with_data || 0) - (a.days_with_data || 0);
      }
      return (b.total || 0) - (a.total || 0);
    })[0];
  const topApp = Array.isArray(computer?.top_apps) ? computer?.top_apps?.[0] : undefined;
  const secondApp = Array.isArray(computer?.top_apps) ? computer?.top_apps?.[1] : undefined;
  const topWebsite = Array.isArray(computer?.top_domains) ? computer?.top_domains?.[0] : undefined;
  const secondWebsite = Array.isArray(computer?.top_domains) ? computer?.top_domains?.[1] : undefined;

  const highlights: string[] = [];

  if (mostConsistent) {
    highlights.push(
      `${mostConsistent.name} was the steadiest habit, logged on ${mostConsistent.days_with_data} of ${rangeDays} days.`,
    );
  }

  if (sleepHabit) {
    const peakSleep = findWeeklyPeakPoint(
      Array.isArray(sleepHabit.daily)
        ? sleepHabit.daily.map((point) => ({ date: point.date, value: point.value }))
        : [],
    );
    highlights.push(
      `Sleep averaged ${formatWeeklyValue(sleepHabit.average || 0, sleepHabit.unit)} and was logged on ${sleepHabit.days_with_data} of ${rangeDays} days${peakSleep?.date ? `, with the strongest night on ${formatWeeklyShortDate(peakSleep.date)}` : ''}.`,
    );
  }

  if (leadWorkHabit) {
    const peakWorkPoint = findWeeklyPeakPoint(
      Array.isArray(leadWorkHabit.daily)
        ? leadWorkHabit.daily.map((point) => ({ date: point.date, value: point.value }))
        : [],
    );
    highlights.push(
      `${leadWorkHabit.name} carried the clearest work/effort signal${peakWorkPoint?.date ? `, peaking at ${formatWeeklyValue(peakWorkPoint.value, leadWorkHabit.unit)} on ${formatWeeklyShortDate(peakWorkPoint.date)}` : ''}.`,
    );
  }

  if (computer && computer.total_hours > 0) {
    const peakComputerPoint = findWeeklyPeakPoint(
      Array.isArray(computer.daily)
        ? computer.daily.map((point) => ({ date: point.day, value: point.active_hours }))
        : [],
    );
    const digitalLeaders = [topApp?.app_name, topWebsite?.domain].filter(Boolean).join(' and ');
    highlights.push(
      `Computer use averaged ${formatWeeklyNumber(computer.average_daily_hours)}h/day${peakComputerPoint?.date ? ` and peaked on ${formatWeeklyShortDate(peakComputerPoint.date)} at ${formatWeeklyNumber(peakComputerPoint.value)}h` : ''}${digitalLeaders ? `, with most attention going to ${digitalLeaders}` : ''}.`,
    );
    if (secondApp || secondWebsite) {
      highlights.push(
        `Secondary digital context included ${[secondApp?.app_name, secondWebsite?.domain].filter(Boolean).join(' and ')}.`,
      );
    }
  }

  const lowFrequencyHabits = habitsWithData
    .filter((habit) => (habit.days_with_data || 0) > 0 && (habit.days_with_data || 0) <= Math.max(2, Math.floor(rangeDays / 3)))
    .slice(0, 2);
  if (lowFrequencyHabits.length > 0) {
    highlights.push(
      `Lower-frequency habits in this window were ${lowFrequencyHabits.map((habit) => `${habit.name} (${habit.days_with_data} days)`).join(' and ')}.`,
    );
  }

  return highlights.slice(0, 5);
}

async function generateWeeklyOverviewNarrative(
  payload: WeeklyOverviewPayload,
  title = 'Weekly Activity Overview',
): Promise<string> {
  const fallback = buildWeeklyOverviewNarrative(payload, title);
  const synthesisPayload = buildWeeklyOverviewSynthesisPayload(payload);
  const highlights = buildWeeklyOverviewHighlights(payload);
  const periodLabel = title.includes('Daily')
    ? 'today'
    : title.includes('Monthly')
      ? 'this month'
      : 'this week';

  try {
    const response = await getOpenAIClient().chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.5,
      max_tokens: 350,
      messages: [
        {
          role: 'system',
          content: [
            'You write high-quality personal activity recaps from structured data.',
            'The user already sees raw tables in a side panel. Your job is to synthesize, interpret, and explain the period cleanly.',
            'Use this exact structure: 1 short opening sentence, then 2 to 4 sections with bold titles on their own lines, then 1 short closing line.',
            'Each section body should usually be 2 short sentences when the evidence supports it, not a long paragraph.',
            'Preferred section titles are: **Rhythm**, **Standout Days**, **Computer Use**, **What Shifted**. Skip a section if the evidence is thin.',
            'Every section must include at least one concrete anchor: a date, number, habit name, app name, or website.',
            'In at least 2 sections, include a secondary concrete detail instead of stopping after the first metric.',
            'Be crisp and specific. Avoid filler, coaching, and abstraction.',
            'Do not use phrases like "notable ebb and flow", "particularly", "overall", "likely", "may have", "suggests", or "illustrates".',
            'Do not moralize. Do not speculate beyond the data. Do not mention tables, payloads, or analytics.',
            'Keep the whole response under 260 words unless the period is monthly, then stay under 320 words.',
          ].join(' '),
        },
        {
          role: 'user',
          content: `Write a useful recap for ${periodLabel}.\n\nAnchoring highlights:\n${highlights.map((line) => `- ${line}`).join('\n')}\n\nStructured overview data:\n${JSON.stringify(synthesisPayload, null, 2)}`,
        },
      ],
    });

    const content = response.choices[0]?.message?.content?.trim();
    return content || fallback;
  } catch (error) {
    console.error('❌ generateWeeklyOverviewNarrative error:', error);
    return fallback;
  }
}

function averageWeeklyValues(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function describeWeeklyShape(
  subject: string,
  points: Array<{ date?: string; value?: number }>,
): string | null {
  const normalizedPoints = [...points]
    .map((point) => ({
      date: point.date,
      value: Number(point.value || 0),
    }))
    .filter((point) => point.date && Number.isFinite(point.value))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  if (normalizedPoints.length < 3) return null;

  const values = normalizedPoints.map((point) => point.value);
  const overallAvg = averageWeeklyValues(values);
  if (!Number.isFinite(overallAvg) || overallAvg <= 0) return null;

  const earlyCutoff = Math.ceil(normalizedPoints.length / 3);
  const lateStart = Math.max(earlyCutoff + 1, Math.floor((normalizedPoints.length * 2) / 3));
  const early = normalizedPoints.slice(0, earlyCutoff);
  const middle = normalizedPoints.slice(earlyCutoff, lateStart);
  const late = normalizedPoints.slice(lateStart);

  if (early.length === 0 || late.length === 0) return null;

  const earlyAvg = averageWeeklyValues(early.map((point) => point.value));
  const middleAvg = averageWeeklyValues(middle.map((point) => point.value));
  const lateAvg = averageWeeklyValues(late.map((point) => point.value));
  const threshold = Math.max(overallAvg * 0.18, 0.5);
  const peak = normalizedPoints.reduce((best, point) => (point.value > best.value ? point : best), normalizedPoints[0]);
  const low = normalizedPoints.reduce((best, point) => (point.value < best.value ? point : best), normalizedPoints[0]);

  if (middle.length > 0 && earlyAvg > middleAvg + threshold && lateAvg > middleAvg + threshold) {
    return `${subject} started relatively strong, dipped in the middle of the week, and recovered by the end, with the low point landing around ${formatWeeklyShortDate(low.date)}.`;
  }
  if (lateAvg > earlyAvg + threshold && lateAvg >= middleAvg + threshold * 0.6) {
    return `${subject} built as the week went on and looked strongest near ${formatWeeklyShortDate(peak.date)}.`;
  }
  if (earlyAvg > lateAvg + threshold && earlyAvg >= middleAvg + threshold * 0.6) {
    return `${subject} was more front-loaded, with the strongest stretch early before easing later in the week.`;
  }
  if (middle.length > 0 && middleAvg > earlyAvg + threshold && middleAvg > lateAvg + threshold) {
    return `${subject} peaked midweek, with the strongest day around ${formatWeeklyShortDate(peak.date)} before settling back down.`;
  }
  if (peak.value - low.value >= threshold * 1.5) {
    return `${subject} stayed uneven across the week, ranging from a low on ${formatWeeklyShortDate(low.date)} to a high on ${formatWeeklyShortDate(peak.date)}.`;
  }

  return `${subject} was fairly steady across the week without a big midweek swing.`;
}

function buildWeeklyOverviewNarrative(
  payload: WeeklyOverviewPayload,
  title = 'Weekly Activity Overview',
): string {
  const habits = Array.isArray(payload.habits) ? payload.habits : [];
  const habitsWithData = habits.filter((h) => (h.days_with_data || 0) > 0);
  const computer = payload.computer_activity;
  const rangeDays = payload.date_range?.days || 7;
  const periodLabel = title.includes('Daily')
    ? 'Today'
    : title.includes('Monthly')
      ? 'This month'
      : 'This week';

  if (habitsWithData.length === 0 && (!computer || computer.total_hours <= 0)) {
    return `${periodLabel} did not have enough logged activity to form a meaningful summary.`;
  }

  const lines: string[] = [];
  const sortedByConsistency = [...habitsWithData].sort((a, b) => {
    if ((b.days_with_data || 0) !== (a.days_with_data || 0)) {
      return (b.days_with_data || 0) - (a.days_with_data || 0);
    }
    return (b.total || 0) - (a.total || 0);
  });
  const topConsistencyDays = sortedByConsistency[0]?.days_with_data || 0;
  const consistencyLeaders = sortedByConsistency
    .filter((habit) => (habit.days_with_data || 0) === topConsistencyDays)
    .slice(0, 3);
  const mostConsistent = sortedByConsistency[0];
  const sleepHabit = habitsWithData.find((habit) => normalizeWeeklyHabitName(habit.name) === 'sleep duration');
  const leadWorkHabit = [...habitsWithData]
    .filter((habit) => normalizeWeeklyHabitName(habit.name) !== 'sleep duration' && Array.isArray(habit.daily) && habit.daily.length >= 3)
    .sort((a, b) => {
      if ((b.days_with_data || 0) !== (a.days_with_data || 0)) {
        return (b.days_with_data || 0) - (a.days_with_data || 0);
      }
      return (b.total || 0) - (a.total || 0);
    })[0];
  const topApp = Array.isArray(computer?.top_apps) ? computer?.top_apps?.[0] : undefined;
  const topWebsite = Array.isArray(computer?.top_domains) ? computer?.top_domains?.[0] : undefined;
  const occasionalHabits = [...habitsWithData]
    .filter((habit) => (habit.days_with_data || 0) > 0 && (habit.days_with_data || 0) <= Math.max(2, Math.floor(rangeDays / 3)))
    .sort((a, b) => {
      if ((a.days_with_data || 0) !== (b.days_with_data || 0)) {
        return (a.days_with_data || 0) - (b.days_with_data || 0);
      }
      return (b.total_entries || 0) - (a.total_entries || 0);
    })
    .slice(0, 2);

  const openingParts: string[] = [];
  if (consistencyLeaders.length > 1) {
    openingParts.push(
      `${periodLabel} was anchored by ${formatWeeklyNameList(consistencyLeaders.map((habit) => habit.name))}, each logged on ${topConsistencyDays} of ${rangeDays} days.`,
    );
  } else if (mostConsistent) {
    openingParts.push(
      `${periodLabel} was anchored most clearly by ${mostConsistent.name}, which showed up on ${mostConsistent.days_with_data} of ${rangeDays} days.`,
    );
  }
  if (computer && computer.total_hours > 0) {
    openingParts.push(`Computer use averaged ${formatWeeklyNumber(computer.average_daily_hours)}h/day.`);
  }
  if (openingParts.length > 0) {
    lines.push(openingParts.join(' '));
  }

  const rhythmLines: string[] = [];
  if (sleepHabit) {
    const sleepAverage = formatWeeklyValue(sleepHabit.average || 0, sleepHabit.unit);
    if ((sleepHabit.days_with_data || 0) >= Math.max(1, rangeDays - 2)) {
      rhythmLines.push(
        `Sleep averaged ${sleepAverage} across ${sleepHabit.days_with_data} ${sleepHabit.days_with_data === 1 ? 'night' : 'nights'}, which gave the week a fairly stable recovery baseline.`,
      );
    } else {
      rhythmLines.push(
        `Sleep averaged ${sleepAverage} when it was logged, but it only showed up on ${sleepHabit.days_with_data} of ${rangeDays} days, so your recovery picture was thinner than your work tracking.`,
      );
    }

    const sleepShape = describeWeeklyShape(
      'Sleep',
      Array.isArray(sleepHabit.daily)
        ? sleepHabit.daily.map((point) => ({ date: point.date, value: point.value }))
        : [],
    );
    if (sleepShape) {
      rhythmLines.push(sleepShape);
    }
  }

  if (leadWorkHabit) {
    const workShape = describeWeeklyShape(
      leadWorkHabit.name,
      Array.isArray(leadWorkHabit.daily)
        ? leadWorkHabit.daily.map((point) => ({ date: point.date, value: point.value }))
        : [],
    );
    if (workShape) {
      rhythmLines.push(workShape);
    }
  }
  if (rhythmLines.length > 0) {
    lines.push(`**Rhythm**\n${rhythmLines.slice(0, 2).join(' ')}`);
  }

  const computerLines: string[] = [];
  if (computer && computer.total_hours > 0) {
    const computerRange = computer.max_daily_hours - computer.min_daily_hours;
    const computerLine = topApp?.app_name && topWebsite?.domain
      ? `Computer time averaged ${formatWeeklyNumber(computer.average_daily_hours)}h/day, with most of that time concentrated in ${topApp.app_name} and ${topWebsite.domain}.`
      : topApp?.app_name
        ? `Computer time averaged ${formatWeeklyNumber(computer.average_daily_hours)}h/day, and ${topApp.app_name} took the biggest share of that time.`
        : `Computer time averaged ${formatWeeklyNumber(computer.average_daily_hours)}h/day across ${computer.days_with_data || 0} active days.`;
    computerLines.push(computerLine);
    if (computerRange >= 2) {
      computerLines.push(
        `Your digital workload also moved around quite a bit day to day, from ${formatWeeklyNumber(computer.min_daily_hours)}h on the lightest day to ${formatWeeklyNumber(computer.max_daily_hours)}h on the heaviest.`,
      );
    }

    const computerShape = describeWeeklyShape(
      'Computer activity',
      Array.isArray(computer.daily)
        ? computer.daily.map((point) => ({ date: point.day, value: point.active_hours }))
        : [],
    );
    if (computerShape) {
      computerLines.push(computerShape);
    }
  }
  if (computerLines.length > 0) {
    lines.push(`**Computer Use**\n${computerLines.slice(0, 2).join(' ')}`);
  }

  const shiftLines: string[] = [];
  if (occasionalHabits.length > 0) {
    shiftLines.push(
      `The more occasional habits were ${occasionalHabits.map((habit) => `${habit.name} (${habit.days_with_data} ${habit.days_with_data === 1 ? 'day' : 'days'})`).join(' and ')}, so those showed up as situational patterns rather than fixed routines.`,
    );
  }

  if (mostConsistent) {
    const recoveryLagging = sleepHabit
      && normalizeWeeklyHabitName(mostConsistent.name) !== 'sleep duration'
      && (sleepHabit.days_with_data || 0) < (mostConsistent.days_with_data || 0);

    shiftLines.push(
      recoveryLagging
        ? `Overall, the pattern reads as a productive stretch with stronger follow-through on work and learning than on recovery tracking.`
        : `Overall, the week looks structured and repeatable rather than scattered.`,
    );
  }
  if (shiftLines.length > 0) {
    lines.push(`**What Shifted**\n${shiftLines.slice(0, 2).join(' ')}`);
  }

  return lines.slice(0, 4).join('\n\n').trim();
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

function formatActivityRangeMs(ms: number): string {
  const totalMin = Math.round(ms / 60000);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function inferRecapAnchorDate(
  query: string,
  safeDaysBack: number,
  timezone?: string,
): string | null {
  const normalized = (query || '').toLowerCase();
  const today = getTimezoneYmd(new Date(), timezone);
  const explicitDate = parseExplicitRecapAnchorDate(query, timezone);

  if (explicitDate) {
    return explicitDate;
  }

  if (/\byesterday\b/.test(normalized) || /\blast night\b/.test(normalized)) {
    return shiftYmd(today, -1);
  }
  if (/\btoday\b/.test(normalized) || /\btonight\b/.test(normalized)) {
    return today;
  }

  if (
    safeDaysBack <= 1 &&
    /\b(what did i get done|what did i do|recap my day|activity summary|what happened today|what happened)\b/.test(normalized)
  ) {
    return today;
  }

  return null;
}

type CalendarEvidenceSnippet = {
  app_name?: string;
  window_title?: string;
  document_path?: string;
  semantic_summary?: string;
  snippet?: string;
  time?: number;
  ax_richness_score?: number;
};

type StructuredRecapWorkstream = {
  startTs: number;
  endTs: number;
  anchor: string;
  entryCount: number;
  maxRichness: number;
  apps: Set<string>;
  domains: Set<string>;
  files: Set<string>;
  projects: Set<string>;
  windowFragments: Set<string>;
  semanticSummaries: string[];
  snippetLines: string[];
  evidenceLines: string[];
  commitMessages: string[];
  tokens: Set<string>;
};

const recapOutlineStopWords = new Set([
  'about', 'after', 'again', 'app', 'browser', 'content', 'dashboard', 'details', 'from', 'into', 'just', 'page',
  'project', 'query', 'related', 'screen', 'session', 'some', 'task', 'tasks', 'text', 'that', 'their', 'there',
  'this', 'today', 'using', 'viewing', 'were', 'what', 'when', 'where', 'with', 'work', 'working', 'your',
]);

function normalizeRecapTokens(value: string): string[] {
  return String(value || '')
    .toLowerCase()
    .replace(/https?:\/\//g, ' ')
    .replace(/[^a-z0-9._/-]+/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !recapOutlineStopWords.has(token));
}

function countTokenOverlap(a: Set<string>, b: Set<string>): number {
  let overlap = 0;
  for (const token of a) {
    if (b.has(token)) overlap += 1;
  }
  return overlap;
}

function parseRecapTimestampMs(value: unknown): number {
  const num = Number(value || 0);
  if (Number.isFinite(num) && num > 0) {
    return num > 1e12 ? num : num * 1000;
  }
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function extractRecapDomain(...values: Array<string | undefined>): string {
  for (const value of values) {
    const match = String(value || '').match(/\b([a-z0-9-]+\.)+[a-z]{2,}\b/i);
    if (match) return match[0].toLowerCase().replace(/^www\./, '');
  }
  return '';
}

function extractRecapWindowFragments(title: string): string[] {
  return String(title || '')
    .split(/\s+[|–—-]\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 4 && part.length <= 90)
    .filter((part) => !/^(google chrome|chrome|cursor|codex|claude|finder|mail|gmail)$/i.test(part))
    .slice(0, 4);
}

function extractRecapFileLabel(documentPath: string): string {
  const normalized = String(documentPath || '').trim();
  if (!normalized) return '';
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] || '';
}

function extractRecapProjectLabel(documentPath: string, windowTitle: string): string {
  const pathParts = String(documentPath || '').split('/').filter(Boolean);
  const repoCandidate = pathParts.find((part) => /(desktop|backend|dashboard|ritual|main|app)/i.test(part));
  if (repoCandidate) return repoCandidate;
  const titleMatch = String(windowTitle || '').match(/\b([a-z0-9._-]+(?:desktop|backend|dashboard|main)[a-z0-9._-]*)\b/i);
  return titleMatch?.[1] || '';
}

function buildRecapSnippetEvidenceLines(item: CalendarEvidenceSnippet): string[] {
  const lines: string[] = [];
  const semantic = clipContextText(item.semantic_summary || '', 180);
  const snippet = clipContextText(item.snippet || '', 220);
  const windowTitle = clipContextText(item.window_title || '', 120);
  const documentPath = clipContextText(item.document_path || '', 120);

  if (semantic) lines.push(`Semantic: ${semantic}`);
  if (windowTitle) lines.push(`Window: ${windowTitle}`);
  if (documentPath) lines.push(`Path: ${documentPath}`);
  if (snippet) lines.push(`Visible text: ${snippet}`);

  return lines;
}

function getRecapAnchor(item: CalendarEvidenceSnippet): string {
  const file = extractRecapFileLabel(item.document_path || '');
  if (file) return `file:${file.toLowerCase()}`;

  const fragments = extractRecapWindowFragments(item.window_title || '');
  if (fragments.length > 0) return `window:${fragments[0].toLowerCase()}`;

  const domain = extractRecapDomain(item.window_title || '', item.semantic_summary || '', item.snippet || '');
  if (domain) return `domain:${domain}`;

  return `app:${String(item.app_name || 'unknown').toLowerCase()}`;
}

function pushUniqueClipped(target: string[], value: string, maxLen: number, maxItems: number) {
  const clipped = clipContextText(value, maxLen);
  if (!clipped || target.includes(clipped) || target.length >= maxItems) return;
  target.push(clipped);
}

function shouldAppendToRecapWorkstream(
  current: StructuredRecapWorkstream | undefined,
  entryTs: number,
  entryAnchor: string,
  entryTokens: Set<string>,
): boolean {
  if (!current || !entryTs) return false;
  const gapMs = Math.max(0, entryTs - current.endTs);
  const overlap = countTokenOverlap(current.tokens, entryTokens);
  if (entryAnchor === current.anchor && gapMs <= 90 * 60 * 1000) return true;
  if (overlap >= 3 && gapMs <= 60 * 60 * 1000) return true;
  if (overlap >= 1 && gapMs <= 18 * 60 * 1000) return true;
  return false;
}

function mergeRecapWorkstreamEntry(
  workstream: StructuredRecapWorkstream,
  item: CalendarEvidenceSnippet,
  entryTs: number,
  entryTokens: Set<string>,
) {
  workstream.startTs = Math.min(workstream.startTs, entryTs);
  workstream.endTs = Math.max(workstream.endTs, entryTs);
  workstream.entryCount += 1;
  workstream.maxRichness = Math.max(workstream.maxRichness, Number(item.ax_richness_score || 0));

  if (item.app_name) workstream.apps.add(String(item.app_name));
  const domain = extractRecapDomain(item.window_title || '', item.semantic_summary || '', item.snippet || '');
  if (domain) workstream.domains.add(domain);

  const fileLabel = extractRecapFileLabel(item.document_path || '');
  if (fileLabel) workstream.files.add(fileLabel);
  const projectLabel = extractRecapProjectLabel(item.document_path || '', item.window_title || '');
  if (projectLabel) workstream.projects.add(projectLabel);

  for (const fragment of extractRecapWindowFragments(item.window_title || '')) {
    workstream.windowFragments.add(fragment);
  }

  pushUniqueClipped(workstream.semanticSummaries, item.semantic_summary || '', 180, 6);
  pushUniqueClipped(workstream.snippetLines, item.snippet || '', 220, 8);
  for (const line of buildRecapSnippetEvidenceLines(item)) {
    pushUniqueClipped(workstream.evidenceLines, line, 240, 10);
  }
  entryTokens.forEach((token) => workstream.tokens.add(token));
}

function createRecapWorkstream(item: CalendarEvidenceSnippet, entryTs: number, entryTokens: Set<string>): StructuredRecapWorkstream {
  const workstream: StructuredRecapWorkstream = {
    startTs: entryTs,
    endTs: entryTs,
    anchor: getRecapAnchor(item),
    entryCount: 0,
    maxRichness: 0,
    apps: new Set<string>(),
    domains: new Set<string>(),
    files: new Set<string>(),
    projects: new Set<string>(),
    windowFragments: new Set<string>(),
    semanticSummaries: [],
    snippetLines: [],
    evidenceLines: [],
    commitMessages: [],
    tokens: new Set<string>(),
  };
  mergeRecapWorkstreamEntry(workstream, item, entryTs, entryTokens);
  return workstream;
}

function buildStructuredRecapWorkstreams(
  screenEvidence: any,
  gitData: any,
): StructuredRecapWorkstream[] {
  const snippets = (Array.isArray(screenEvidence?.ocr_snippets) ? screenEvidence.ocr_snippets : [])
    .map((item: CalendarEvidenceSnippet) => ({ ...item, _ts: parseRecapTimestampMs(item?.time) }))
    .filter((item: CalendarEvidenceSnippet & { _ts: number }) => item._ts > 0)
    .sort(
      (
        a: CalendarEvidenceSnippet & { _ts: number },
        b: CalendarEvidenceSnippet & { _ts: number },
      ) => a._ts - b._ts,
    );

  const workstreams: StructuredRecapWorkstream[] = [];

  for (const item of snippets) {
    const entryTokens = new Set(
      normalizeRecapTokens(
        [
          item.app_name || '',
          item.window_title || '',
          item.document_path || '',
          item.semantic_summary || '',
          item.snippet || '',
        ].join(' '),
      ).slice(0, 40),
    );

    const current = workstreams[workstreams.length - 1];
    if (shouldAppendToRecapWorkstream(current, item._ts, getRecapAnchor(item), entryTokens)) {
      mergeRecapWorkstreamEntry(current, item, item._ts, entryTokens);
    } else {
      workstreams.push(createRecapWorkstream(item, item._ts, entryTokens));
    }
  }

  const commits = Array.isArray(gitData?.commits) ? gitData.commits : [];
  for (const commit of commits) {
    const commitTs = parseRecapTimestampMs(commit?.time);
    const commitMessage = clipContextText(commit?.message || '', 160);
    if (!commitTs || !commitMessage) continue;

    let bestIndex = -1;
    let bestDistance = Number.MAX_SAFE_INTEGER;
    for (let i = 0; i < workstreams.length; i += 1) {
      const ws = workstreams[i];
      const distance = commitTs < ws.startTs
        ? ws.startTs - commitTs
        : commitTs > ws.endTs
          ? commitTs - ws.endTs
          : 0;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }

    if (bestIndex >= 0 && bestDistance <= 2 * 60 * 60 * 1000) {
      const target = workstreams[bestIndex];
      pushUniqueClipped(target.commitMessages, commitMessage, 160, 4);
      target.startTs = Math.min(target.startTs, commitTs);
      target.endTs = Math.max(target.endTs, commitTs);
      normalizeRecapTokens(commitMessage).forEach((token) => target.tokens.add(token));
    }
  }

  return workstreams;
}

function deriveRecapTitleHint(workstream: StructuredRecapWorkstream): string {
  const project = Array.from(workstream.projects)[0] || '';
  const file = Array.from(workstream.files)[0] || '';
  const windowFragment = Array.from(workstream.windowFragments)[0] || '';
  const domain = Array.from(workstream.domains)[0] || '';
  const app = Array.from(workstream.apps)[0] || 'Work';
  const semantic = workstream.semanticSummaries[0] || '';
  const commit = workstream.commitMessages[0] || '';

  if (file && project) return `${file} changes in ${project}`;
  if (file) return `${file} updates`;
  if (windowFragment && project) return `${windowFragment} in ${project}`;
  if (windowFragment && domain) return `${windowFragment} on ${domain}`;
  if (windowFragment) return windowFragment;
  if (commit) return commit.replace(/^[a-z]+:\s*/i, '');
  if (semantic) return semantic.split(/[.!?]/)[0].trim();
  if (domain && app && !/chrome|safari|browser/i.test(app)) return `${domain} in ${app}`;
  if (domain) return domain;
  return `${app} work session`;
}

function buildStructuredRecapOutline(
  date: string,
  timezone: string | undefined,
  screenEvidence: any,
  appsData: any,
  domainsData: any,
  gitData: any,
): string | null {
  const workstreams = buildStructuredRecapWorkstreams(screenEvidence, gitData);
  if (workstreams.length === 0) {
    return null;
  }

  const mainWorkstreams = workstreams.slice(0, 12);
  const topApps = Array.isArray(appsData?.apps || appsData?.data)
    ? (appsData.apps || appsData.data).slice(0, 8)
    : [];
  const topDomains = Array.isArray(domainsData?.domains || domainsData?.data)
    ? (domainsData.domains || domainsData.data).slice(0, 6)
    : [];

  const sections: string[] = [
    `Date: ${date}`,
    timezone ? `Timezone: ${timezone}` : '',
    `Evidenced workstreams: ${mainWorkstreams.length}`,
  ].filter(Boolean);

  if (topApps.length > 0) {
    sections.push(
      `Top apps: ${topApps
        .map((item: any) => {
          const name = item.app_name || item.name || 'Unknown';
          const ms = item.total_active_ms || item.active_ms || item.total_ms || 0;
          return ms > 0 ? `${name} (${formatActivityRangeMs(ms)})` : name;
        })
        .join(', ')}`,
    );
  }

  if (topDomains.length > 0) {
    sections.push(
      `Top websites: ${topDomains
        .map((item: any) => {
          const name = item.domain || item.name || 'Unknown';
          const ms = item.total_active_ms || item.active_ms || item.total_ms || 0;
          return ms > 0 ? `${name} (${formatActivityRangeMs(ms)})` : name;
        })
        .join(', ')}`,
    );
  }

  mainWorkstreams.forEach((workstream, index) => {
    sections.push('');
    sections.push(`WORKSTREAM ${index + 1}`);
    sections.push(`Title hint: ${clipContextText(deriveRecapTitleHint(workstream), 110)}`);
    sections.push(`Time range: ${formatWorkstreamTimeRange(workstream.startTs, workstream.endTs, timezone)}`);
    sections.push(`Apps: ${Array.from(workstream.apps).slice(0, 4).join(', ') || 'Unknown'}`);
    if (workstream.domains.size > 0) {
      sections.push(`Domains: ${Array.from(workstream.domains).slice(0, 4).join(', ')}`);
    }
    if (workstream.files.size > 0) {
      sections.push(`Files: ${Array.from(workstream.files).slice(0, 5).map((file) => `\`${file}\``).join(', ')}`);
    }
    if (workstream.projects.size > 0) {
      sections.push(`Projects: ${Array.from(workstream.projects).slice(0, 4).join(', ')}`);
    }
    if (workstream.commitMessages.length > 0) {
      sections.push(`Commits: ${workstream.commitMessages.join(' | ')}`);
    }
    sections.push('Strong evidence:');
    const evidenceLines = [
      ...workstream.evidenceLines.slice(0, 6),
      ...workstream.semanticSummaries
        .filter((line) => !workstream.evidenceLines.some((evidence) => evidence.includes(line)))
        .slice(0, 2)
        .map((line) => `Semantic: ${line}`),
    ].slice(0, 8);
    evidenceLines.forEach((line) => sections.push(`- ${line}`));
  });

  return sections.join('\n');
}

function sanitizeCalendarStyleActivitySummary(text: string): string {
  const lines = text
    .split('\n')
    .map((line) => line.trimEnd());

  const stripped = [...lines];
  while (stripped.length > 0) {
    const first = stripped[0].trim();
    if (
      first.length === 0 ||
      /^let me dig through\b/i.test(first) ||
      /^here'?s a rundown\b/i.test(first) ||
      /^looked through your context\b/i.test(first)
    ) {
      stripped.shift();
      continue;
    }
    break;
  }

  const cleaned = stripped.join('\n').trim();

  return cleaned
    .replace(/\bHere'?s a rundown of what you (?:were up to|accomplished)(?: (?:today|yesterday|on [^!.\n]+))?!?\s*/gi, '')
    .replace(/\bLet me dig through [^.!?\n]+[.!?]?\s*/gi, '')
    .replace(/\bLooked through your context\b\s*›?/gi, '')
    .trim();
}

async function buildCalendarStyleActivitySummary(
  token: string,
  date: string,
  timezone?: string,
): Promise<string | null> {
  try {
    const params = {
      start_date: date,
      end_date: date,
      limit: 12,
    };

    const [screenEvidence, appsData, domainsData, gitData] = await Promise.all([
      fetchPythonApi('/api/watcher/screen-evidence', token, { date, limit: 180 }).catch(() => null),
      fetchPythonApi('/api/watcher/stats/top-apps', token, params).catch(() => null),
      fetchPythonApi('/api/watcher/stats/top-domains', token, params).catch(() => null),
      fetchPythonApi('/api/watcher/git-commits', token, { date }).catch(() => null),
    ]);

    const outline = buildStructuredRecapOutline(
      date,
      timezone,
      screenEvidence,
      appsData,
      domainsData,
      gitData,
    );
    if (!outline) {
      return null;
    }

    const prompt = `You are rewriting a PRE-CLUSTERED workday outline into a concrete, Littlebird-style work summary.

The workstreams are already grouped and ordered chronologically. Your job is to turn them into clean prose, not to invent new structure from scratch.

Rules:
- Cover the full evidenced day from the earliest workstream to the latest one.
- Keep the workstreams in chronological order.
- Prefer 4-8 main workstreams. If there are extra small items, merge them into **Other things** bullet points.
- Each main workstream should use this format:
  **Specific title**
  *7:12 AM – 7:57 AM*
  2-4 sentences
- Use the "Title hint" only as a starting point. Improve it when the evidence supports a more specific title.
- The first sentence of each section must say exactly what was done using a concrete verb like edited, deployed, configured, compared, fixed, tested, scheduled, debugged, reviewed, or bought.
- Prefer explicit objects from the outline: file names, repos, domains, commits, settings pages, products, APIs, meeting subjects, commands.
- If a workstream only has thin evidence, keep it short or move it into **Other things**.
- Do not invent outcomes or blockers that are not in the outline.
- Do not write generic filler. Avoid phrases like "you worked on", "focusing on", "this involved", "you explored", "you managed", "significant", "various", "overall productivity".
- Do not add greetings or corny lead-ins. Start directly with the summary sections.

Use the strongest evidence first:
1. Commit messages
2. Semantic summaries
3. Files / paths / window titles
4. Visible text

Here is the structured outline:

${outline}`;

    const response = await getOpenAIClient().chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.2,
      max_tokens: 2200,
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: `Rewrite this outline into a concrete work summary for ${date}. Preserve chronology and cover the full evidenced day.` },
      ],
    });

    const content = response.choices[0]?.message?.content?.trim();
    return content ? sanitizeCalendarStyleActivitySummary(content) : null;
  } catch (error) {
    console.error('❌ buildCalendarStyleActivitySummary error:', error);
    return null;
  }
}

async function buildRichActivitySummaryFromStoryPlan(
  payload: any,
  query: string,
  timezone?: string,
  calendarStyleSummary?: string | null,
): Promise<string | null> {
  try {
    if (!payload?.success || !payload?.story_plan) {
      return calendarStyleSummary?.trim() || null;
    }

    const evidenceScaffold = buildContextMemoryNarrative(payload, query, timezone);
    if (!evidenceScaffold || evidenceScaffold.trim().length < 80) {
      return calendarStyleSummary?.trim() || null;
    }

    const prompt = `You are turning a rich evidence scaffold into a concrete, Littlebird-quality activity recap.

Your job:
- Write a comprehensive, chronologically ordered summary of what the user actually got done.
- Prefer 4-8 substantive workstreams.
- Cover more of the evidenced day instead of stopping after the first few items.
- Use concrete verbs and concrete nouns from the evidence: repos, files, products, domains, APIs, commits, settings pages, documents, commands.
- Preserve chronology from earliest to latest workstream.
- Merge tiny fragments into a short "Other things" section instead of dropping them.

Output format:
- Start directly with the work summary. No greeting or preamble.
- For each main workstream:
  **Specific title**
  *7:12 AM – 7:57 AM*
  2-4 sentences
- End with **Other things:** bullet points if there are smaller evidenced items left over.

Quality bar:
- Be more comprehensive than a shallow screen-only summary.
- Do not invent details or outcomes.
- Do not write generic filler like "you worked on", "you explored", "this involved", "focused on", "various".
- If the evidence shows concrete implementation/debugging/configuration work, say that plainly.
- If a lower-quality draft summary is provided, use it only as supporting context. Prefer the evidence scaffold when there is any conflict or missing detail.

Evidence scaffold:
${evidenceScaffold}

Supporting draft summary:
${calendarStyleSummary?.trim() || '(none)'}`;

    const response = await getOpenAIClient().chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.2,
      max_tokens: 2200,
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: `Write the final recap for: ${query}` },
      ],
    });

    const content = response.choices[0]?.message?.content?.trim();
    return content ? sanitizeCalendarStyleActivitySummary(content) : (calendarStyleSummary?.trim() || null);
  } catch (error) {
    console.error('❌ buildRichActivitySummaryFromStoryPlan error:', error);
    return calendarStyleSummary?.trim() || null;
  }
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
  {
    type: 'function',
    function: {
      name: 'getActivitySummary',
      description: 'Get a rich activity summary with structured workstreams, claim cards, timeline segments, and evidence from context memory. Use for "what did I do today", "give me an activity summary", "recap my day/week", "what happened today". Returns the full story plan with broad_overview intent. Prefer this over searchContextMemory for overview/recap questions.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural language query (e.g., "what did I do today", "activity this week")' },
          daysBack: { type: 'number', description: 'How many days back to analyze (default 1 for today, 7 for week)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getDailyBiometrics',
      description: 'Get biometrics data for a specific day: heart rate summary (average, min, max BPM, source breakdown, lowest/highest windows). Use for "what was my heart rate today", "biometrics", "heart rate summary", "resting heart rate", "how was my heart rate".',
      parameters: {
        type: 'object',
        properties: {
          day: { type: 'string', description: 'Date in YYYY-MM-DD format (default: today)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getScreenTimeSummary',
      description: 'Get iPhone/mobile screen time summary: total active time and top apps by duration. Use for "how much time on my phone", "screen time", "phone usage", "mobile app usage". This is phone screen time, NOT computer time (use getComputerTimeSpentBreakdown for computer).',
      parameters: {
        type: 'object',
        properties: {
          startDate: { type: 'string', description: 'Start date YYYY-MM-DD (default: today)' },
          endDate: { type: 'string', description: 'End date YYYY-MM-DD (default: today)' },
          daysBack: { type: 'number', description: 'Alternative: look back N days (default 1)' },
          appLimit: { type: 'number', description: 'Top apps to return (default 10)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getCalendarEvents',
      description: 'Get scheduled blocks/events from the user calendar for a date range. Use for "what do I have scheduled", "calendar today", "upcoming events", "what\'s on my calendar".',
      parameters: {
        type: 'object',
        properties: {
          startDate: { type: 'string', description: 'Start date YYYY-MM-DD (default: today)' },
          endDate: { type: 'string', description: 'End date YYYY-MM-DD (default: today)' },
        },
        required: [],
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
}, timezone?: string, strictThisWeek?: boolean, localOverviewActivity?: unknown) {
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

    const localActivityBundle = selectLocalOverviewActivityBundle(localOverviewActivity, startDate, endDate);

    let watcherDailyRows: any[] = [];
    let topApps: any[] = [];
    let topDomains: any[] = [];

    if (localActivityBundle) {
      watcherDailyRows = Array.isArray(localActivityBundle.daily)
        ? localActivityBundle.daily.map((row) => ({
            day: row.day,
            active_hours: Number(row.active_hours || 0),
            events_count: Number(row.events_count || 0),
            apps_count: Number(row.apps_count || 0),
            source: localActivityBundle.source || 'cloud_first',
          }))
        : [];
      topApps = Array.isArray(localActivityBundle.apps)
        ? localActivityBundle.apps.slice(0, safeAppLimit).map((row) => ({
            app_bundle_id: row.app_bundle_id,
            app_name: row.app_name,
            hours: Number(row.hours || 0),
            total_events: Number(row.total_events || 0),
            source: localActivityBundle.source || 'cloud_first',
          }))
        : [];
      topDomains = Array.isArray(localActivityBundle.domains)
        ? localActivityBundle.domains.slice(0, safeAppLimit).map((row) => ({
            domain: row.domain,
            hours: Number(row.hours || 0),
            total_events: Number(row.total_events || 0),
            source: localActivityBundle.source || 'cloud_first',
          }))
        : [];
    } else {
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

      watcherDailyRows = Array.isArray(dailyWatcherResult?.data) ? dailyWatcherResult.data : [];
      topApps = Array.isArray(topAppsResult?.data) ? topAppsResult.data : [];
      topDomains = Array.isArray(topDomainsResult?.data) ? topDomainsResult.data : [];
    }
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

    // Add formatting instruction so the LLM writes a concise narrative
    // instead of dumping all the raw data
    (payload as any).__response_instructions = `IMPORTANT: The side panel already shows the raw tables and numbers. Your text response should be a useful recap, not a stat dump. Write a concise but substantive narrative (4-6 sentences). Explain the week's shape: what was most consistent, what looked less consistent, what recovery looked like if sleep exists, and what the computer/app pattern suggests. Mention only a few specific numbers that support your take. Do NOT list every habit with totals or averages. Write like an observant coach explaining what the week meant, not a reporting script.`;

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
  localOverviewActivity?: unknown,
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
    localOverviewActivity,
  );
}

async function executeGetMonthlyOverview(
  token: string,
  params: { appLimit?: number },
  timezone?: string,
  localOverviewActivity?: unknown,
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
    localOverviewActivity,
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
  document_path: string | null;
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
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
    const response = await fetchPythonApiPost('/api/memory/query', token, {
      query: params.query,
      intent: 'auto',
      days_back: clampDaysBack(params.daysBack),
      timezone,
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
  const _token = token;
  const _params = params;
  return null;
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
    const evidenceTimeline = results.slice(0, 20).map((row) => {
      const ts = new Date(row.timestamp);
      const now = Date.now();
      const diffMs = now - ts.getTime();
      const diffMin = Math.round(diffMs / 60000);
      let timeAgo: string;
      if (diffMin < 1) timeAgo = 'just now';
      else if (diffMin < 60) timeAgo = `${diffMin}m ago`;
      else if (diffMin < 1440) timeAgo = `${Math.round(diffMin / 60)}h ago`;
      else timeAgo = `${Math.round(diffMin / 1440)}d ago`;
      return {
        timestamp: ts.toISOString(),
        timeAgo,
        app: row.app_name,
        window: row.window_title || 'Unknown',
        document_path: row.document_path || undefined,
        content_preview: row.ocr_text.substring(0, 420) + (row.ocr_text.length > 420 ? '...' : ''),
        relevance: Math.round(row.relevance_score * 100) + '%',
        source: row.source || 'text',
        fts_matched: row.fts_matched || false,
      };
    });

    // Application summary — pre-computed app breakdown for the LLM
    const appSummaryMap = new Map<string, number>();
    for (const row of results) {
      const app = row.app_name?.trim() || 'Unknown';
      appSummaryMap.set(app, (appSummaryMap.get(app) ?? 0) + 1);
    }
    const applicationSummary = Array.from(appSummaryMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([application, captures]) => ({ application, captures }));

    return {
      application_summary: applicationSummary,
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

  const resultTimeline = evidenceRows.map((row) => {
    const ts = new Date(row.timestamp);
    const now = Date.now();
    const diffMs = now - ts.getTime();
    const diffMin = Math.round(diffMs / 60000);
    let timeAgo: string;
    if (diffMin < 1) timeAgo = 'just now';
    else if (diffMin < 60) timeAgo = `${diffMin}m ago`;
    else if (diffMin < 1440) timeAgo = `${Math.round(diffMin / 60)}h ago`;
    else timeAgo = `${Math.round(diffMin / 1440)}d ago`;
    return {
      timestamp: ts.toISOString(),
      timeAgo,
      app: row.app_name,
      window: row.window_title || 'Unknown',
      document_path: row.document_path || undefined,
      content_preview: row.ocr_text.substring(0, 420) + (row.ocr_text.length > 420 ? '...' : ''),
      relevance: Math.round(row.relevance_score * 100) + '%',
      source: row.source || 'text',
      fts_matched: row.fts_matched || false,
    };
  });

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

  // Application summary — pre-computed app breakdown for the LLM
  const fallbackAppSummaryMap = new Map<string, number>();
  for (const row of results) {
    const app = row.app_name?.trim() || 'Unknown';
    fallbackAppSummaryMap.set(app, (fallbackAppSummaryMap.get(app) ?? 0) + 1);
  }
  const fallbackApplicationSummary = Array.from(fallbackAppSummaryMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([application, captures]) => ({ application, captures }));

  return {
    application_summary: fallbackApplicationSummary,
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
      timezone: timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || undefined,
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
// NEW TOOLS: Activity Summary, Biometrics, Screen Time, Calendar
// ====================

async function executeGetActivitySummary(
  token: string,
  params: { query?: string; daysBack?: number },
  prefetchedScreenSearchContext: ScreenSearchContext | null,
  timezone?: string,
) {
  const safeDaysBack = clampDaysBack(params.daysBack ?? 1);
  const query = params.query || 'activity summary';
  console.log('📋 getActivitySummary called:', { query, daysBack: safeDaysBack });

  const stripStoryPlanMeta = (rawPlan: any): any => {
    if (Array.isArray(rawPlan)) return rawPlan.map(stripStoryPlanMeta);
    if (rawPlan && typeof rawPlan === 'object') {
      const cleaned: any = {};
      for (const [k, v] of Object.entries(rawPlan)) {
        if (
          [
            'evidence_count',
            'score_main_event',
            'confidence',
            'grounding_score',
            'grounding_reasons',
            'supporting_evidence_ids',
            'counter_evidence_ids',
            'metrics',
            'session_keys',
          ].includes(k)
        ) continue;
        cleaned[k] = stripStoryPlanMeta(v);
      }
      return cleaned;
    }
    return rawPlan;
  };

  const recapAnchorDate = inferRecapAnchorDate(query, safeDaysBack, timezone);
  const calendarStyleSummaryPromise = recapAnchorDate
    ? buildCalendarStyleActivitySummary(token, recapAnchorDate, timezone)
    : Promise.resolve(null);

  const buildLocalFallbackPayload = async () => {
    let screenSearchContext = await resolveScreenSearchContext(
      token,
      {
        query,
        daysBack: safeDaysBack,
        limit: 30,
      },
      prefetchedScreenSearchContext,
    );

    if (screenSearchContext) {
      const hasOnlyAggregateRows = (
        screenSearchContext.results.length > 0
        && screenSearchContext.results.every((row) => isActivityAggregateText(row.ocr_text))
      );

      if (screenSearchContext.results.length === 0 || hasOnlyAggregateRows) {
        const localContext = await fetchLocalScreenSearchContext(token, {
          query,
          daysBack: safeDaysBack,
          limit: 40,
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
            semanticTruth: screenSearchContext.semanticTruth,
            pendingEmbeddings: screenSearchContext.pendingEmbeddings,
            totalEmbeddings: screenSearchContext.totalEmbeddings,
            workerRunning: screenSearchContext.workerRunning,
          };
        }
      }
    } else {
      screenSearchContext = await fetchLocalScreenSearchContext(token, {
        query,
        daysBack: safeDaysBack,
        limit: 40,
      });
    }

    if (!screenSearchContext || !Array.isArray(screenSearchContext.results) || screenSearchContext.results.length === 0) {
      return null;
    }

    const rankedResults = rerankScreenResultsByQuery(screenSearchContext.results, query);
    const filteredResults = rankedResults.filter((row) => !isActivityAggregateText(row.ocr_text)).slice(0, 30);
    if (filteredResults.length === 0) {
      return null;
    }

    const structuredEvidence = buildBroadOverviewEvidence(
      filteredResults,
      screenSearchContext.citations,
      screenSearchContext.semanticTruth,
    );
    const citationsSource = (screenSearchContext.citations && screenSearchContext.citations.length > 0)
      ? screenSearchContext.citations.slice(0, 25).map((citation) => ({
          app: citation.app_name || '',
          title: citation.window_title || '',
          text: (citation.snippet || '').slice(0, 300),
          ts: citation.timestamp || 0,
        }))
      : filteredResults.slice(0, 25).map((result) => ({
          app: result.app_name || '',
          title: result.window_title || '',
          text: (result.ocr_text || '').slice(0, 300),
          ts: result.timestamp || 0,
        }));

    return {
      success: true,
      query,
      intent_resolved: 'broad_overview',
      retrieval_tier: screenSearchContext.retrievalTier || screenSearchContext.modeUsed || 'desktop_local',
      story_plan: stripStoryPlanMeta(structuredEvidence.recap_outline || null),
      citations: citationsSource,
      citations_count: citationsSource.length,
      time_truth: null,
      confidence: screenSearchContext.confidence || null,
      freshness: screenSearchContext.freshness || null,
      warning: compactScreenWarning(screenSearchContext.warning),
      source: 'desktop_local_fallback',
    };
  };

  try {
    const [response, calendarStyleSummary] = await Promise.all([
      fetchPythonApiPost('/api/memory/query', token, {
        query,
        intent: 'broad_overview',
        days_back: safeDaysBack,
        timezone: timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || undefined,
        group_by: 'app',
        limit: 32,
      }),
      calendarStyleSummaryPromise,
    ]);

    const hasRemoteStoryPlan = Boolean(response?.semantic_truth?.story_plan);
    const remoteCitations = Array.isArray(response?.citations) ? response.citations : [];
    if (!response || response.error || (!hasRemoteStoryPlan && remoteCitations.length === 0)) {
      const localFallback = await buildLocalFallbackPayload();
      if (localFallback) {
        if (calendarStyleSummary) {
          (localFallback as Record<string, unknown>).calendar_style_summary = calendarStyleSummary;
          (localFallback as Record<string, unknown>).calendar_style_date = recapAnchorDate;
        }
        return JSON.stringify(localFallback);
      }

      return JSON.stringify({
        success: Boolean(calendarStyleSummary),
        error: response?.error || 'Activity summary unavailable.',
        calendar_style_summary: calendarStyleSummary || null,
        calendar_style_date: recapAnchorDate,
      });
    }

    // Return both story_plan AND raw citations so the LLM can synthesize
    // directly from evidence when the story_plan is weak
    const citations = remoteCitations.slice(0, 25).map((c: any) => ({
      app: c.app_name || c.app || '',
      title: c.window_title || c.title || '',
      text: (c.text_compact || c.contextual_text_compact || c.snippet || '').slice(0, 300),
      ts: c.chunk_start_ts || c.timestamp || 0,
    }));

    // Strip internal metadata fields from story_plan before sending to LLM —
    // evidence_count, score_main_event, confidence etc. leak into output otherwise
    const rawPlan = response.semantic_truth?.story_plan || null;
    const cleanPlan = rawPlan ? stripStoryPlanMeta(rawPlan) : rawPlan;
    const richActivitySummary = await buildRichActivitySummaryFromStoryPlan(
      {
        success: true,
        story_plan: cleanPlan,
        renderer: response.semantic_truth?.renderer || cleanPlan?.renderer || null,
        results: Array.isArray(response.results) ? response.results : [],
        citations,
      },
      query,
      timezone,
      calendarStyleSummary,
    );

    return JSON.stringify({
      success: true,
      query: response.query || query,
      intent_resolved: response.intent_resolved || 'broad_overview',
      retrieval_tier: response.retrieval_tier,
      story_plan: cleanPlan,
      citations,
      citations_count: citations.length,
      time_truth: response.time_truth || null,
      confidence: response.confidence || null,
      freshness: response.freshness || null,
      rich_activity_summary: richActivitySummary || null,
      calendar_style_summary: calendarStyleSummary || null,
      calendar_style_date: recapAnchorDate,
    });
  } catch (error) {
    console.error('❌ getActivitySummary error:', error);
    const calendarStyleSummary = await calendarStyleSummaryPromise.catch(() => null);
    return JSON.stringify({
      success: Boolean(calendarStyleSummary),
      error: calendarStyleSummary ? undefined : 'Activity summary is currently unavailable.',
      details: String(error),
      query,
      intent_resolved: 'broad_overview',
      calendar_style_summary: calendarStyleSummary || null,
      calendar_style_date: recapAnchorDate,
    });
  }
}

async function executeGetDailyBiometrics(
  token: string,
  params: { day?: string },
  timezone?: string,
) {
  const day = params.day || getTimezoneYmd(new Date(), timezone);
  console.log('💓 getDailyBiometrics called:', { day });

  try {
    const response = await fetchPythonApi(
      '/api/v1/biometrics/heart-rate/day-summary',
      token,
      { day },
    );

    if (!response || response.detail) {
      return JSON.stringify({
        success: false,
        error: response?.detail || 'No heart rate data available. Heart rate tracking may not be connected.',
      });
    }

    return JSON.stringify({
      success: true,
      day: response.day || day,
      average_bpm: response.average_bpm,
      min_bpm: response.min_bpm,
      max_bpm: response.max_bpm,
      total_samples: response.total_samples,
      lowest_window: response.lowest_window,
      highest_window: response.highest_window,
      source_breakdown: response.source_breakdown,
    });
  } catch (error) {
    console.error('❌ getDailyBiometrics error:', error);
    return JSON.stringify({
      success: false,
      error: 'Heart rate data is currently unavailable. The user may not have a heart rate monitor connected.',
    });
  }
}

async function executeGetScreenTimeSummary(
  token: string,
  params: { startDate?: string; endDate?: string; daysBack?: number; appLimit?: number },
  timezone?: string,
) {
  const today = getTimezoneYmd(new Date(), timezone);
  const daysBack = params.daysBack ?? 1;
  const startDate = params.startDate || shiftYmd(today, -(daysBack - 1));
  const endDate = params.endDate || today;
  const appLimit = params.appLimit ?? 10;
  console.log('📱 getScreenTimeSummary called:', { startDate, endDate, appLimit });

  try {
    const [summaryRes, appsRes] = await Promise.all([
      fetchPythonApi('/api/screen-time/stats/summary', token, {
        start_date: startDate,
        end_date: endDate,
      }),
      fetchPythonApi('/api/screen-time/stats/top-apps', token, {
        start_date: startDate,
        end_date: endDate,
        limit: appLimit,
      }),
    ]);

    const summaryData = summaryRes?.data || summaryRes || {};
    const appsData = appsRes?.data || appsRes || [];

    return JSON.stringify({
      success: true,
      start_date: startDate,
      end_date: endDate,
      total_active_ms: summaryData.total_active_ms ?? 0,
      is_connected: summaryData.is_connected ?? false,
      has_data: summaryData.has_data ?? false,
      daily: summaryData.daily || [],
      top_apps: Array.isArray(appsData) ? appsData : [],
    });
  } catch (error) {
    console.error('❌ getScreenTimeSummary error:', error);
    return JSON.stringify({
      success: false,
      error: 'Screen time data is currently unavailable. iPhone screen time may not be connected.',
    });
  }
}

async function executeGetCalendarEvents(
  token: string,
  params: { startDate?: string; endDate?: string },
  timezone?: string,
) {
  const today = getTimezoneYmd(new Date(), timezone);
  const startDate = params.startDate || today;
  const endDate = params.endDate || today;
  console.log('📅 getCalendarEvents called:', { startDate, endDate });

  try {
    const response = await fetchPythonApi('/api/calendar/scheduled-blocks', token, {
      start_date: startDate,
      end_date: endDate,
    });

    const blocks = Array.isArray(response) ? response : (response?.data || response?.blocks || []);

    // Transform start_minutes/end_minutes to human-readable times
    const events = blocks.map((block: any) => {
      const startHour = Math.floor((block.start_minutes || 0) / 60);
      const startMin = (block.start_minutes || 0) % 60;
      const endHour = Math.floor((block.end_minutes || 0) / 60);
      const endMin = (block.end_minutes || 0) % 60;
      const fmtTime = (h: number, m: number) => {
        const period = h >= 12 ? 'PM' : 'AM';
        const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
        return `${h12}:${String(m).padStart(2, '0')} ${period}`;
      };

      return {
        title: block.title || 'Untitled',
        day: block.day || startDate,
        start_time: fmtTime(startHour, startMin),
        end_time: fmtTime(endHour, endMin),
        duration_minutes: (block.end_minutes || 0) - (block.start_minutes || 0),
      };
    });

    // Sort by start time
    events.sort((a: any, b: any) => {
      if (a.day !== b.day) return a.day < b.day ? -1 : 1;
      return (a.start_time || '') < (b.start_time || '') ? -1 : 1;
    });

    return JSON.stringify({
      success: true,
      start_date: startDate,
      end_date: endDate,
      events,
      event_count: events.length,
    });
  } catch (error) {
    console.error('❌ getCalendarEvents error:', error);
    return JSON.stringify({
      success: false,
      error: 'Calendar data is currently unavailable.',
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
      localOverviewActivity,
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

FOR COMPREHENSIVE WEEKLY HABIT RECAP QUESTIONS ("How did my habits do this week?", "weekly habit recap", "weekly habit summary", "how was my week"):
→ Use getWeeklyOverview
→ Write a CONCISE narrative summary (NOT a data dump)
→ Lead with 1-2 sentence overview of the week's highlights
→ Then mention 2-3 notable habits with specific numbers (best day, worst day, trend direction)
→ End with computer time total and top 2-3 apps
→ Keep response under 150 words — the side panel has all the detailed tables
→ Use bold for habit names and key numbers
→ DO NOT list every habit with Total/Average/Min/Max — that's what the side panel table shows

FOR DAILY HABIT RECAP QUESTIONS ("How did my habits do today?", "today habit summary", "daily habit recap", "how am I doing today"):
→ Use getDailyOverview
→ Treat "today" as the current local day in the user's timezone
→ Write a CONCISE 2-3 sentence summary of today's activity
→ Highlight only habits that have data today with specific values
→ DO NOT list habits with zero data
→ Keep response under 100 words

FOR MONTHLY/LAST-30-DAYS HABIT RECAP QUESTIONS ("How did my habits do this month?", "last 30 days of habits", "monthly habit summary", "how was my month"):
→ Use getMonthlyOverview
→ Write a CONCISE narrative summary with trends and highlights
→ Lead with overall consistency (X of 30 days had data)
→ Mention top 2-3 improving or declining habits with % changes
→ Keep response under 150 words

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

FOR ACTIVITY RECAP / DAILY SUMMARY QUESTIONS ("what did I get done today", "recap my day", "activity summary", "what happened today", "what did I do this week", "give me a summary of my day"):
→ Use getActivitySummary — it returns story_plan AND raw citations (screen evidence)
→ Prefer getActivitySummary over searchContextMemory for BROAD overview/recap questions
→ YOUR JOB IS TO SYNTHESIZE INTO A POLISHED NARRATIVE — tell the story of what the user ACCOMPLISHED, not what the watcher recorded
→ Use the citations array (app names, window titles, OCR text) as PRIMARY evidence
→ INFER the user's actual work from the evidence. Example: files like \`KanbanCard.tsx\`, \`KanbanBoard.tsx\`, \`KanbanColumn.tsx\` in Cursor = "building out the kanban board UI". Example: window "Configure | Clerk.com" in Chrome = "configuring authentication on Clerk.com"
→ Write about WHAT WAS DONE and WHY, not which apps were open. Bad: "You spent time in Cursor with 18 evidence items". Good: "You built out the kanban board, modifying \`KanbanCard.tsx\` and \`KanbanBoard.tsx\` to add drag-and-drop column support."
→ NEVER mention evidence counts, evidence items, supporting items, confidence scores, or any internal retrieval metadata in your response
→ If story_plan has good workstream titles, use them. If titles are generic (like "Cursor general work"), ignore and synthesize from citations instead
→ For a COMPREHENSIVE recap, also call getDailyBiometrics and getCalendarEvents to fold in heart rate and schedule context

FOR HEART RATE / BIOMETRICS QUESTIONS ("what was my heart rate", "biometrics today", "resting heart rate", "how was my heart rate"):
→ Use getDailyBiometrics
→ Report numbers exactly as returned (average, min, max BPM)
→ NEVER infer stress, anxiety, mood, or emotional state from heart rate data
→ High HR could be exercise, caffeine, standing, postural change, or measurement artifact
→ Say "Your heart rate averaged X BPM" NOT "You were stressed" or "You were anxious"
→ If no data, note that heart rate tracking may not be connected

FOR PHONE / MOBILE SCREEN TIME QUESTIONS ("phone usage", "screen time", "how much time on my phone", "mobile app usage"):
→ Use getScreenTimeSummary — this is iOS/phone screen time, NOT computer time
→ For computer time, use getComputerTimeSpentBreakdown instead
→ Present total time and top apps with durations

FOR CALENDAR / SCHEDULE QUESTIONS ("what's on my calendar", "what do I have scheduled", "calendar today", "upcoming events"):
→ Use getCalendarEvents
→ Present events sorted by time with start/end times
→ These are scheduled blocks from Ritual, not external calendar events

FOR CONTEXT MEMORY / SPECIFIC COMPUTER ACTIVITY QUESTIONS ("what did I work on in Cursor", "when did I look at X", "find when I was doing Y", "what apps did I use at 3pm"):
→ Use searchContextMemory with a natural language query — best for SPECIFIC topic lookups
→ The search returns structured evidence: workstreams with files, commands, git activity, time ranges
→ YOUR JOB IS TO SYNTHESIZE THIS INTO A POLISHED NARRATIVE — not dump raw data

=== MULTI-SOURCE SYNTHESIS ===
When the user asks for a comprehensive recap ("full recap of my day", "what did I get done today"):
→ Call getActivitySummary FIRST for the main narrative
→ ALSO call getDailyBiometrics to add heart rate context (if available)
→ ALSO call getCalendarEvents to add schedule context (if available)
→ Weave all sources into ONE coherent narrative. Example: "You had a productive morning on the retrieval pipeline (HR averaged 72 BPM). Your NeuroPsych exam ran from 1-4pm. After that, you briefly checked email."
→ Do NOT present each data source as a separate section — integrate them naturally

=== CONTEXT MEMORY NARRATIVE FORMAT ===
Your job is to transform raw evidence into a polished, detailed narrative that reads like a knowledgeable colleague recapping the day.

**Output format — FOLLOW THIS EXACTLY:**

1. **Opening** — One warm, natural sentence. Address the user by name if known. Example: "Here's a rundown of what you were up to yesterday, Nick!" Then a horizontal rule (---).

2. **Workstream sections** — Each section has a **bold title** followed by a narrative PARAGRAPH (not bullets). This is the core of your response:

   **Title format**: Bold text on its own line. Derive specific, descriptive titles from the actual work — files, branches, tools, projects. Good: "**Plaid / Spending Integration**", "**Kanban + Analytics UI Work**", "**Ritual App - Time Stats Debug**". Bad: "Main Event: Research and Design", "Supporting Workstreams", "Concrete Tasks Completed".

   **CROSS-APP PROJECT THREADING**: When evidence from DIFFERENT apps appears close in time (within ~15 minutes) and shares keywords, file paths, or topics, thread them into ONE workstream. Cursor editing \`vector.rs\` + Chrome reading pgvector docs + Terminal running \`cargo test\` = one "Vector Search Implementation" workstream. Derive the title from the shared project, not any single app. The evidence is chronological — use temporal proximity + shared keywords to detect project threads.

   **Body format**: Write 2-5 sentences of FLOWING PROSE as a paragraph below the title. Tell the story of what happened:
   - Explain WHAT was done and WHY, weaving file names in \`backticks\` and specific details naturally into sentences
   - Connect related changes into a coherent thread with temporal flow when available
   - For code work: mention what the changes accomplish functionally
   - For debugging: describe the error → investigation → fix arc
   - Mention specific files (\`KanbanCard.tsx\`, \`KanbanBoard.tsx\`), people, locations, and tools naturally in the prose

3. **Brief passive activities**: Single line each — "Briefly checked Gmail" or "Glanced at Slack."

4. **Closing** — A brief natural remark or follow-up question.

**HARD FORMAT RULES — VIOLATIONS WILL PRODUCE BAD OUTPUT:**
- PARAGRAPHS, NOT BULLET LISTS. Each workstream body MUST be flowing prose sentences, NOT a bulleted or numbered list. This is the single most important formatting rule.
- NO meta-category headers. NEVER use headers like "Main Event:", "Supporting Workstreams", "Concrete Tasks Completed", "Apps and Tools Used", "Strongest Evidence", or "Heart Rate Insights". These are internal categories — the user should see workstream titles only.
- NO bullet-point summaries of files, commands, or tasks. Weave all evidence into narrative paragraphs.
- NO internal metadata in output. NEVER mention "evidence items", "evidence count", "supporting evidence", "confidence score", "retrieval tier", or any other internal system metrics. These are invisible to the user.
- DESCRIBE THE WORK, NOT THE RECORDING. Bad: "You spent time in Obsidian with 18 evidence items reflecting active editing." Good: "You researched design inspirations for the Obsidian Vault, exploring typography systems and layout patterns across Paper, Figma, and Obsidian." Focus on WHAT was accomplished and HOW, not that the system observed activity.
- If biometrics/heart-rate data is available, weave it into the opening or a relevant workstream paragraph — do NOT create a separate "Heart Rate" section.
- If calendar events are available, weave them into the narrative chronologically — do NOT create a separate "Calendar" section.
- NEVER pass through [EVIDENCE FOR SYNTHESIS], [END EVIDENCE], [NARRATIVE SEEDS], or any bracketed markers to the user.
- Derive workstream titles from the ACTUAL WORK (files, branches, task descriptions), not from window titles or chat messages.
- Aim for DEPTH over BREADTH: a detailed paragraph about 4 workstreams beats thin one-liners about 8.
- If no results, suggest trying specific app names, URLs, or keywords.

=== EVIDENCE-GROUNDING RULES (STRICT — DO NOT VIOLATE) ===
1. Only claim the user "did X", "worked on X", "handled X", or "completed X" if there is DIRECT evidence: file edits, terminal commands, error messages, composed content, or commit activity. App presence alone (the app being visible on screen) is NOT sufficient to claim the user performed actions in it.
2. Brief app visits (< 2 minutes of screen time with no edit/compose/typing evidence) = "briefly checked [app]" or omit entirely. NEVER upgrade brief visits to "worked on", "handled", "managed", or "spent time in".
3. Task manager items (Things 3, Reminders, Todoist, etc.) = tasks the user VIEWED or ADDED. NEVER infer that the underlying work described by the task was actually performed unless corroborating evidence exists (e.g., file changes, terminal output, browser activity matching the task). Say "added a task to..." or "viewed tasks in..." instead of "worked on [task subject]".
4. Do NOT infer causal relationships between apps that were simultaneously open. Two apps being open at the same time does NOT mean one was used through the other. For example, Claude and Gmail being open simultaneously does NOT mean "handled emails via Claude".
5. Do NOT recycle UI chrome text (button labels, navigation items, tooltips, turn indicators) as descriptions of user activity. These are interface elements, not evidence of actions taken.
6. If you are uncertain whether an action was taken, SAY SO or OMIT IT. A shorter, accurate summary is always better than a longer hallucinated one. When in doubt, use passive language: "Gmail was open" instead of "you handled emails".
7. For email apps (Gmail, Mail, Outlook): only claim "sent", "wrote", or "replied to" emails if there is evidence of compose activity. Viewing an inbox = "checked email", not "handled email".
8. MATCH CONFIDENCE TO EVIDENCE DEPTH: When evidence includes git commits, file diffs, terminal output, semantic summaries describing specific work, or detailed OCR text showing code/content, write confident detailed narrative citing specifics. A commit message like "fix cosine similarity NaN edge case" is STRONG evidence — describe the fix confidently. When evidence is just app names and domains with no OCR or semantic summary, write brief factual statements only. Rich evidence deserves rich narrative; thin evidence deserves brevity.

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
        ? 'getActivitySummary'
      : forceDailyOverview
        ? 'getDailyOverview'
        : forceMonthlyOverview
          ? 'getMonthlyOverview'
          : forceWeeklyOverview
            ? 'getWeeklyOverview'
            : null;
    const weeklyOverviewQueryParams = resolveWeeklyOverviewParamsFromQuery(latestUserContent, timezone);
    const strictThisWeekForWeeklyOverview = weeklyOverviewQueryParams.strictThisWeek;

    // Fast path: for deterministic recap tools in text mode, skip OpenAI and
    // render directly from the tool payload so routing and structure stay stable.
    const deterministicFastPath =
      !isVoiceMode &&
      forcedToolName &&
      ['getWeeklyOverview', 'getDailyOverview', 'getMonthlyOverview', 'getActivitySummary'].includes(forcedToolName);

    if (deterministicFastPath) {
      console.log(`⚡ Fast-path: skipping OpenAI, executing ${forcedToolName} directly`);

      const toolResults: ChatToolResults = { allStats: [], allBreakdowns: [] };
      let toolResultJson: string;

      switch (forcedToolName) {
        case 'getWeeklyOverview':
          toolResultJson = await executeGetWeeklyOverview(
            token,
            {
              daysBack: weeklyOverviewQueryParams.daysBack,
              startDate: weeklyOverviewQueryParams.startDate,
              endDate: weeklyOverviewQueryParams.endDate,
            },
            timezone,
            strictThisWeekForWeeklyOverview,
            localOverviewActivity,
          );
          break;
        case 'getDailyOverview':
          toolResultJson = await executeGetDailyOverview(token, {}, timezone, localOverviewActivity);
          break;
        case 'getMonthlyOverview':
          toolResultJson = await executeGetMonthlyOverview(token, {}, timezone, localOverviewActivity);
          break;
        case 'getActivitySummary':
          toolResultJson = await executeGetActivitySummary(
            token,
            {
              query: latestUserContent,
              daysBack: inferScreenDaysBackFromQuery(latestUserContent, 7),
            },
            normalizedScreenSearchContext,
            timezone,
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
            else if (forcedToolName === 'getActivitySummary') toolResults.activitySummary = parsed;
            else toolResults.monthlyOverview = parsed;

          if (parsed.suggested_followups) {
            toolResults.suggested_followups = parsed.suggested_followups;
          }
        }
      } catch {}

      const title = getOverviewTitleFromQuery(
        forcedToolName,
        latestUserContent,
        toolResults.activitySummary || toolResults.contextMemoryRecap,
        timezone,
      );

      const overviewPayload =
        toolResults.weeklyOverview
        || toolResults.dailyOverview
        || toolResults.monthlyOverview
        || toolResults.activitySummary
        || toolResults.contextMemoryRecap;

      const finalText = overviewPayload?.success
        ? forcedToolName === 'getActivitySummary'
          ? (
              typeof toolResults.activitySummary?.rich_activity_summary === 'string'
              && toolResults.activitySummary.rich_activity_summary.trim().length > 0
            )
              ? toolResults.activitySummary.rich_activity_summary.trim()
              : (
                  typeof toolResults.activitySummary?.calendar_style_summary === 'string'
                  && toolResults.activitySummary.calendar_style_summary.trim().length > 0
                )
                  ? toolResults.activitySummary.calendar_style_summary.trim()
                  : buildContextMemoryNarrative(overviewPayload, latestUserContent, timezone)
            : await generateWeeklyOverviewNarrative(overviewPayload as WeeklyOverviewPayload, title)
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
    let response = await getOpenAIClient().chat.completions.create({
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
                {
                  ...args,
                  startDate: args?.startDate || weeklyOverviewQueryParams.startDate,
                  endDate: args?.endDate || weeklyOverviewQueryParams.endDate,
                  daysBack: args?.daysBack ?? weeklyOverviewQueryParams.daysBack,
                },
                timezone,
                strictThisWeekForWeeklyOverview,
                localOverviewActivity,
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
              result = await executeGetDailyOverview(token, args, timezone, localOverviewActivity);
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
              result = await executeGetMonthlyOverview(token, args, timezone, localOverviewActivity);
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
                const normalizedSearchContextArgs = {
                  ...args,
                  query: chooseScreenSearchQuery(args?.query, latestUserContent),
                  // Override limit for richer results — GPT defaults to 10 which is too low
                  limit: Math.max(args?.limit || 0, 30),
                  daysBack: Math.max(args?.daysBack || 0, 1),
                };
                result = await executeSearchContextMemory(token, normalizedSearchContextArgs);
                try {
                  const parsed = JSON.parse(result);
                  if (parsed.success && parsed.results) {
                    toolResults.contextMemoryRecap = parsed;
                  }
                  // Trim the result for the LLM: keep story_plan but drop raw results
                  // to avoid flooding GPT-4o-mini's context with screen dumps
                  if (parsed.success && parsed.story_plan) {
                    const richContextNarrative = buildContextMemoryNarrative(
                      {
                        success: parsed.success,
                        story_plan: parsed.story_plan,
                        renderer: parsed.renderer || null,
                        results: Array.isArray(parsed.results) ? parsed.results : [],
                      },
                      normalizedSearchContextArgs.query,
                      timezone,
                    );
                    const trimmed = {
                      success: parsed.success,
                      story_plan: parsed.story_plan,
                      renderer: parsed.renderer || null,
                      rich_context_narrative: richContextNarrative,
                      result_count: Array.isArray(parsed.results) ? parsed.results.length : 0,
                      message: parsed.message,
                    };
                    result = JSON.stringify(trimmed);
                  }
                } catch {}
              }
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
            case 'getActivitySummary':
              result = await executeGetActivitySummary(token, {
                ...args,
                query: chooseScreenSearchQuery(args?.query, latestUserContent),
              }, normalizedScreenSearchContext, timezone);
              try {
                const parsed = JSON.parse(result);
                if (parsed.success) {
                  toolResults.activitySummary = parsed;
                }
              } catch {}
              break;
            case 'getDailyBiometrics':
              result = await executeGetDailyBiometrics(token, args, timezone);
              try {
                const parsed = JSON.parse(result);
                if (parsed.success) {
                  toolResults.dailyBiometrics = parsed;
                }
              } catch {}
              break;
            case 'getScreenTimeSummary':
              result = await executeGetScreenTimeSummary(token, args, timezone);
              try {
                const parsed = JSON.parse(result);
                if (parsed.success) {
                  toolResults.screenTimeSummary = parsed;
                }
              } catch {}
              break;
            case 'getCalendarEvents':
              result = await executeGetCalendarEvents(token, args, timezone);
              try {
                const parsed = JSON.parse(result);
                if (parsed.success) {
                  toolResults.calendarEvents = parsed;
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

      response = await getOpenAIClient().chat.completions.create({
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

    // Use a dedicated synthesis pass for overview recaps so the left-side summary
    // reads like an actual interpretation instead of a telemetry dump.
    if (!isVoiceMode && toolResults.dailyOverview?.success) {
      finalText = await generateWeeklyOverviewNarrative(
        toolResults.dailyOverview as WeeklyOverviewPayload,
        'Daily Activity Overview',
      );
    } else if (!isVoiceMode && toolResults.monthlyOverview?.success) {
      finalText = await generateWeeklyOverviewNarrative(
        toolResults.monthlyOverview as WeeklyOverviewPayload,
        'Monthly Activity Overview',
      );
    } else if (!isVoiceMode && toolResults.weeklyOverview?.success) {
      finalText = await generateWeeklyOverviewNarrative(
        toolResults.weeklyOverview as WeeklyOverviewPayload,
        'Weekly Activity Overview',
      );
    } else if (
      !isVoiceMode
      && typeof toolResults.activitySummary?.rich_activity_summary === 'string'
      && toolResults.activitySummary.rich_activity_summary.trim().length > 0
    ) {
      finalText = toolResults.activitySummary.rich_activity_summary.trim();
    } else if (
      !isVoiceMode
      && typeof toolResults.activitySummary?.calendar_style_summary === 'string'
      && toolResults.activitySummary.calendar_style_summary.trim().length > 0
    ) {
      finalText = toolResults.activitySummary.calendar_style_summary.trim();
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
