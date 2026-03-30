/**
 * Activity summary and calendar-style recap narrative builders.
 *
 * Extracted from orchestrator.ts -- contains inferRecapAnchorDate,
 * buildCalendarStyleActivitySummary, buildRichActivitySummaryFromStoryPlan,
 * and all supporting helpers for structured recap workstream construction.
 */

import OpenAI from 'openai';
import { fetchPythonApi, getTimezoneYmd, shiftYmd } from '../executors/shared-api';
import { buildContextMemoryNarrative } from './context-memory';

// ---------------------------------------------------------------------------
// Local types (these differ from the shared types.ts definitions)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// OpenAI client
// ---------------------------------------------------------------------------

function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured');
  }
  return new OpenAI({ apiKey });
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

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

function formatActivityRangeMs(ms: number): string {
  const totalMin = Math.round(ms / 60000);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
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

// ---------------------------------------------------------------------------
// Token & extraction helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Evidence & workstream construction
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Outline & title derivation
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Exported: buildRichActivitySummaryFromStoryPlan
// ---------------------------------------------------------------------------

export async function buildRichActivitySummaryFromStoryPlan(
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
- Prefer 4-8 substantive workstreams, but widen coverage when the scaffold shows a fuller day.
- Cover more of the evidenced day instead of stopping after the first few items.
- Treat chronology as a hard requirement: if the scaffold shows multiple time blocks, cover them in order.
- Use the chronological coverage block as a checklist. Do not skip later-day work just because one early workstream has stronger evidence.
- Use concrete verbs and concrete nouns from the evidence: repos, files, products, domains, APIs, commits, settings pages, documents, commands.
- Preserve chronology from earliest to latest workstream.
- Merge tiny fragments into a short "Other things" section instead of dropping them.

Output format:
- Start directly with the work summary. No greeting or preamble.
- If the scaffold spans multiple dayparts or time blocks, use chronological section labels like **Morning**, **Midday**, **Afternoon**, **Evening** and nest the workstreams underneath them in order.
- For each main workstream:
  **Specific title**
  *7:12 AM – 7:57 AM*
  2-4 sentences that actually say what was built, debugged, configured, deployed, researched, or decided.
- End with **Other things:** bullet points if there are smaller evidenced items left over.

Quality bar:
- Be more comprehensive than a shallow screen-only summary.
- Do not invent details or outcomes.
- Do not write generic filler like "you worked on", "you explored", "this involved", "focused on", "various".
- If the evidence shows concrete implementation/debugging/configuration work, say that plainly.
- Mention later-day workstreams if they are in the evidence, even when the early morning block is strongest.
- Pull concrete files, commands, domains, commits, and artifacts into the prose so each section feels grounded.
- If a lower-quality draft summary is provided, use it only as supporting context. Prefer the evidence scaffold when there is any conflict or missing detail.

Evidence scaffold:
${evidenceScaffold}

Supporting draft summary:
${calendarStyleSummary?.trim() || '(none)'}`;

    const response = await getOpenAIClient().chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.2,
      max_tokens: 3000,
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
