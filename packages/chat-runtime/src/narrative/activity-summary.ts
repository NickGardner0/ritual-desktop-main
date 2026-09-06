/**
 * Activity summary and calendar-style recap narrative builders.
 *
 * Extracted from orchestrator.ts -- contains inferRecapAnchorDate,
 * buildCalendarStyleActivitySummary, buildRichActivitySummaryFromStoryPlan,
 * and all supporting helpers for project-time recap construction.
 */

import { fetchPythonApi, getTimezoneYmd, shiftYmd } from '../executors/shared-api.js';
import { collectModelEngineResponse, defaultModelEngine } from '../model-engine/index.js';

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

function clipContextText(value: unknown, limit = 160): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(limit - 3, 1)).trimEnd()}...`;
}

export function formatNarrativeDateLabel(
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

function formatActivityRangeMs(ms: number): string {
  const totalMin = Math.round(ms / 60000);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function buildRecapEnrichmentContext(payload: any): string {
  const lines: string[] = [];

  const biometrics = payload?.daily_biometrics;
  if (biometrics?.success) {
    const averageBpm = Number(biometrics.average_bpm || 0);
    const minBpm = Number(biometrics.min_bpm || 0);
    const maxBpm = Number(biometrics.max_bpm || 0);
    const totalSamples = Number(biometrics.total_samples || 0);
    const day = String(biometrics.day || '').trim();
    const biometricsBits = [
      averageBpm > 0 ? `average ${averageBpm.toFixed(1)} bpm` : '',
      minBpm > 0 ? `min ${minBpm.toFixed(1)}` : '',
      maxBpm > 0 ? `max ${maxBpm.toFixed(1)}` : '',
      totalSamples > 0 ? `${totalSamples} samples` : '',
    ].filter(Boolean);
    if (biometricsBits.length > 0) {
      lines.push(`Biometrics${day ? ` for ${day}` : ''}: ${biometricsBits.join(', ')}.`);
    }
  }

  const calendarEvents = Array.isArray(payload?.calendar_events?.events)
    ? payload.calendar_events.events
    : [];
  if (calendarEvents.length > 0) {
    const topEvents = calendarEvents
      .slice(0, 6)
      .map((event: any) => {
        const title = clipContextText(event?.title || 'Untitled', 64);
        const formatTime = (value: unknown) => {
          const parsed = new Date(String(value || ''));
          return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        };
        const startTime = event?.all_day ? 'All day' : formatTime(event?.start);
        const endTime = event?.all_day ? '' : formatTime(event?.end);
        const timeRange = [startTime, endTime].filter(Boolean).join(' - ');
        return timeRange ? `${timeRange}: ${title}` : title;
      })
      .filter(Boolean);
    if (topEvents.length > 0) {
      lines.push(`Calendar context: ${topEvents.join('; ')}.`);
    }
  }

  return lines.join('\n');
}

function appendRecapEnrichment(summary: string, payload: any): string {
  const enrichment = buildRecapEnrichmentContext(payload);
  if (!enrichment) return summary.trim();
  return `${summary.trim()}\n\n**Additional context**\n${enrichment
    .split('\n')
    .filter(Boolean)
    .map((line) => `- ${line}`)
    .join('\n')}`.trim();
}

// ---------------------------------------------------------------------------
// Date parsing
// ---------------------------------------------------------------------------

export function parseExplicitRecapAnchorDate(
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

// ---------------------------------------------------------------------------
// Exported: inferRecapAnchorDate
// ---------------------------------------------------------------------------

export function inferRecapAnchorDate(
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

function buildProjectTimeRecapOutline(
  date: string,
  timezone: string | undefined,
  projectRollups: any,
  projectSessions: any,
  appsData: any,
  domainsData: any,
  gitData: any,
): string | null {
  const sessions = Array.isArray(projectSessions?.data) ? projectSessions.data : [];
  const rollups = Array.isArray(projectRollups?.data) ? projectRollups.data : [];
  const commits = Array.isArray(gitData?.commits) ? gitData.commits : [];
  if (sessions.length === 0 && rollups.length === 0 && commits.length === 0) {
    return null;
  }

  const topApps = Array.isArray(appsData?.apps || appsData?.data)
    ? (appsData.apps || appsData.data).slice(0, 8)
    : [];
  const topDomains = Array.isArray(domainsData?.domains || domainsData?.data)
    ? (domainsData.domains || domainsData.data).slice(0, 6)
    : [];

  const sections: string[] = [
    `Date: ${date}`,
    timezone ? `Timezone: ${timezone}` : '',
    `Project-time rows: ${rollups.length}`,
    `Compact sessions: ${sessions.length}`,
  ].filter(Boolean);

  if (rollups.length > 0) {
    sections.push(
      `Project/task totals: ${rollups
        .slice(0, 10)
        .map((row: any) => {
          const label = [row.project_name || 'Unclassified', row.task_name || 'General'].join(' / ');
          return `${label} (${formatActivityRangeMs(Number(row.active_ms || 0))})`;
        })
        .join(', ')}`,
    );
  }

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

  sessions.slice(0, 14).forEach((session: any, index: number) => {
    const apps = Array.isArray(session.apps)
      ? session.apps.slice(0, 4).map((item: any) => item.name).filter(Boolean)
      : [];
    const domains = Array.isArray(session.domains)
      ? session.domains.slice(0, 4).map((item: any) => item.name).filter(Boolean)
      : [];
    sections.push('');
    sections.push(`WORKSTREAM ${index + 1}`);
    sections.push(`Title hint: ${clipContextText([session.project_name, session.task_name].filter(Boolean).join(' / ') || 'Unclassified work', 110)}`);
    sections.push(`Time range: ${formatWorkstreamTimeRange(session.start_ts, session.end_ts, timezone)}`);
    sections.push(`Active time: ${formatActivityRangeMs(Number(session.active_ms || 0))}`);
    sections.push(`Classification: ${session.classification_source || 'rules'} (${Math.round(Math.max(0, Math.min(1, Number(session.confidence || 0))) * 100)}% confidence)`);
    if (apps.length > 0) sections.push(`Apps: ${apps.join(', ')}`);
    if (domains.length > 0) sections.push(`Domains: ${domains.join(', ')}`);
    if (session.summary_text) sections.push(`Summary: ${clipContextText(session.summary_text, 180)}`);
  });

  if (commits.length > 0) {
    sections.push('');
    sections.push('GIT COMMITS');
    commits.slice(0, 12).forEach((commit: any) => {
      sections.push(`- ${commit.time || ''} ${commit.message || ''}`.trim());
    });
  }

  return sections.join('\n');
}

// ---------------------------------------------------------------------------
// Sanitizer
// ---------------------------------------------------------------------------

function sanitizeCalendarStyleActivitySummary(text: string): string {
  const lines = text
    .split('\n')
    .map((line) => line.trimEnd());

  const stripped = [...lines];
  while (stripped.length > 0) {
    const first = stripped[0].trim();
    if (
      first.length === 0 ||
      /^(let me dig through|here'?s (a rundown|what you)|looked through your context|i'?ll walk you through|let me walk you through|looking at your|based on your)/i.test(first)
    ) {
      stripped.shift();
      continue;
    }
    break;
  }

  const cleaned = stripped.join('\n').trim();

  const sanitized = cleaned
    .replace(/\bHere'?s a rundown of what you (?:were up to|accomplished)(?: (?:today|yesterday|on [^!.\n]+))?!?\s*/gi, '')
    .replace(/\bHere'?s what you (?:got done|were up to|accomplished|worked on)[^.!?\n]*[.!?]?\s*/gi, '')
    .replace(/\bLet me dig through [^.!?\n]+[.!?]?\s*/gi, '')
    .replace(/\bLooked through your context\b\s*›?/gi, '')
    .replace(/\bI'?ll walk you through [^.!?\n]+[.!?]?\s*/gi, '')
    .trim();

  // Ensure section titles are bold-wrapped using context-aware detection.
  // A title line is identified by being followed by an italic time range (*HH:MM...*)
  // or a paragraph of prose, and being short enough to be a heading.
  return ensureBoldSectionHeaders(sanitized);
}

/**
 * Context-aware bold header enforcement.
 * Walks lines and detects title-like lines by checking what follows:
 * - Followed by an italic time range (e.g. *7:12 AM – 8:00 AM*)
 * - Short line followed by a longer paragraph line
 * - Daypart headers like "Morning", "Afternoon", etc.
 */
function ensureBoldSectionHeaders(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Already bold or a bullet/list item — keep as-is
    if (!trimmed || /^\s*[-*•]/.test(trimmed) || /^\*\*/.test(trimmed)) {
      result.push(line);
      continue;
    }

    // Check if this looks like a section title that needs bolding
    if (isSectionTitle(trimmed, lines, i)) {
      result.push(`**${trimmed}**`);
    } else {
      result.push(line);
    }
  }

  return result.join('\n');
}

function isSectionTitle(trimmed: string, lines: string[], index: number): boolean {
  // Must start with a letter or digit
  if (!/^[A-Za-z0-9]/.test(trimmed)) return false;

  // Too long to be a title
  if (trimmed.length > 100) return false;

  // Too many words — likely a sentence
  const words = trimmed.split(/\s+/);
  if (words.length > 12) return false;

  // Daypart headers (Morning, Afternoon, etc.) should always be bold
  if (/^(Morning|Midday|Afternoon|Evening|Night|Other things:?)$/i.test(trimmed)) return true;

  // Look at the next non-empty line
  let nextLine = '';
  for (let j = index + 1; j < lines.length && j <= index + 2; j++) {
    if (lines[j].trim()) {
      nextLine = lines[j].trim();
      break;
    }
  }

  // If followed by an italic time range like *7:12 AM – 8:00 AM*, this is a title
  if (/^\*\d/.test(nextLine) || /^\*\d.*\*$/.test(nextLine)) return true;

  // If followed by a longer paragraph (prose), and this line is short, it's likely a title
  if (nextLine.length > trimmed.length && words.length <= 8 && !/[.!?]$/.test(trimmed)) return true;

  // Short lines (<=6 words) that don't end with punctuation and aren't the last line
  if (words.length <= 6 && !/[.!?]$/.test(trimmed) && index < lines.length - 1) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Exported: buildCalendarStyleActivitySummary
// ---------------------------------------------------------------------------

export async function buildCalendarStyleActivitySummary(
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

    const [projectRollups, projectSessions, appsData, domainsData, gitData] = await Promise.all([
      fetchPythonApi('/api/watcher/project-time/rollups', token, {
        start_date: date,
        end_date: date,
        group_by: 'task',
        limit: 24,
      }).catch(() => null),
      fetchPythonApi('/api/watcher/project-time/sessions', token, {
        start_date: date,
        end_date: date,
        limit: 48,
      }).catch(() => null),
      fetchPythonApi('/api/watcher/stats/top-apps', token, params).catch(() => null),
      fetchPythonApi('/api/watcher/stats/top-domains', token, params).catch(() => null),
      fetchPythonApi('/api/watcher/git-commits', token, { date }).catch(() => null),
    ]);

    const outline = buildProjectTimeRecapOutline(
      date,
      timezone,
      projectRollups,
      projectSessions,
      appsData,
      domainsData,
      gitData,
    );
    if (!outline) {
      return null;
    }

    const prompt = `You are rewriting a compact project-time workday outline into a concrete, Littlebird-style work summary.

The workstreams are already grouped and ordered chronologically by local project/task attribution. Your job is to turn them into clean prose, not to invent new structure from scratch.

Rules:
- Cover the full evidenced day from the earliest workstream to the latest one.
- Keep the workstreams in chronological order.
- Prefer 4-8 main workstreams. If there are extra small items, merge them into **Other things** bullet points.
- CRITICAL: Every section title MUST use markdown bold syntax: **Title Here**. Never write a bare title without ** markers.
- Each main workstream should use this format:
  **Specific title**
  *7:12 AM – 7:57 AM*
  2-4 sentences
- Use the "Title hint" only as a starting point. Improve it when the project/task label, app/domain mix, or commits support a more specific title.
- The first sentence of each section must say exactly what was done using a concrete verb like edited, deployed, configured, compared, fixed, tested, scheduled, debugged, reviewed, or bought.
- Prefer explicit objects from the outline: file names, repos, domains, commits, settings pages, products, APIs, meeting subjects, commands.
- If a workstream only has thin evidence, keep it short or move it into **Other things**.
- Do not invent outcomes or blockers that are not in the outline.
- Do not write generic filler. Avoid phrases like "you worked on", "focusing on", "this involved", "you explored", "you managed", "significant", "various", "overall productivity".
- Do not add greetings or corny lead-ins. Start directly with the summary sections.

Use the strongest evidence first:
1. Commit messages
2. Project/task labels and safe compact session summaries
3. Apps/domains and active-time totals

Here is the structured outline:

${outline}`;

    const response = await collectModelEngineResponse(defaultModelEngine, {
      model: 'gpt-4o',
      temperature: 0.2,
      maxTokens: 2200,
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: `Rewrite this outline into a concrete work summary for ${date}. Preserve chronology and cover the full evidenced day.` },
      ],
    });

    const content = response.content?.trim();
    return content ? sanitizeCalendarStyleActivitySummary(content) : null;
  } catch (error) {
    console.error('❌ buildCalendarStyleActivitySummary error:', error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Exported: buildRichActivitySummaryFromStoryPlan
// ---------------------------------------------------------------------------

export async function buildRichActivitySummaryFromStoryPlan(
  payload: any,
  _query: string,
  _timezone?: string,
  calendarStyleSummary?: string | null,
): Promise<string | null> {
  try {
    const fallback = calendarStyleSummary?.trim() || null;
    return fallback ? appendRecapEnrichment(fallback, payload) : null;
  } catch (error) {
    console.error('❌ buildRichActivitySummaryFromStoryPlan error:', error);
    const fallback = calendarStyleSummary?.trim() || null;
    return fallback ? appendRecapEnrichment(fallback, payload) : null;
  }
}
