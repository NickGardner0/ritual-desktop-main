/**
 * Screen search helper functions shared across context-memory and computer-time executors.
 *
 * Extracted from orchestrator.ts during Phase 1 refactoring.
 * These helpers handle result ranking, merging, debug payloads, and context resolution.
 */

import type {
  ScreenRecordingResult,
  ScreenSearchContext,
  ScreenSearchDebugPayload,
  MemoryQueryApiResponse,
} from '../types';
import {
  fetchPythonApiPost,
  clampDaysBack,
  clampSearchLimit,
  compactScreenWarning,
  formatWeeklyNumber,
} from './shared-api';

// ---------------------------------------------------------------------------
// Module-level constants
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Time window parsing
// ---------------------------------------------------------------------------

export function parseRelativeTimeWindowMs(query: string): number | null {
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

export function inferScreenDaysBackFromQuery(query: string, fallbackDaysBack: number): number {
  const windowMs = parseRelativeTimeWindowMs(query);
  if (!windowMs) return fallbackDaysBack;
  const inferred = Math.ceil(windowMs / (24 * 60 * 60 * 1000));
  return Math.min(90, Math.max(1, inferred));
}

export function inferRelativeCutoffTimestamp(query: string): number | null {
  const windowMs = parseRelativeTimeWindowMs(query);
  if (!windowMs) return null;
  return Date.now() - windowMs;
}

// ---------------------------------------------------------------------------
// Token extraction
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Result ranking & merging
// ---------------------------------------------------------------------------

export function rerankScreenResultsByQuery(results: ScreenRecordingResult[], query: string): ScreenRecordingResult[] {
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

export function mergeScreenResults(
  localResults: ScreenRecordingResult[],
  prefetchedResults: ScreenRecordingResult[],
): ScreenRecordingResult[] {
  const merged = [...localResults, ...prefetchedResults];
  if (merged.length <= 1) return merged;

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

// ---------------------------------------------------------------------------
// Evidence quality checks
// ---------------------------------------------------------------------------

export function hasSubstantiveOcrEvidence(value: string): boolean {
  const text = value.trim().toLowerCase();
  if (!text) return false;
  if (text === 'unknown' || text === 'n/a') return false;
  if (text.startsWith('window:') || text.startsWith('app:')) {
    if (text.includes('url:') || text.includes('domain:')) return text.length >= 24;
    return text.length >= 48;
  }
  if (text.length < 16) return false;
  return true;
}

export function isActivityAggregateText(value: string): boolean {
  return String(value || '').trim().toLowerCase().startsWith('activity aggregate:');
}

// ---------------------------------------------------------------------------
// Debug payload builder
// ---------------------------------------------------------------------------

export function buildScreenSearchDebug(
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

// ---------------------------------------------------------------------------
// Retrieval tier mapping
// ---------------------------------------------------------------------------

export function mapRetrievalTierToStatus(
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

export function mapRetrievalTierToMode(
  retrievalTier?: string,
): ScreenSearchContext['modeUsed'] | null {
  if (!retrievalTier) return null;
  if (retrievalTier === 'semantic_full' || retrievalTier === 'semantic_frame' || retrievalTier === 'cloud_hybrid') return 'hybrid';
  if (retrievalTier === 'lexical_fts' || retrievalTier === 'cloud_lexical_only') return 'text';
  if (retrievalTier === 'activity_only') return 'activity';
  if (retrievalTier === 'unavailable') return 'unavailable';
  return null;
}

// ---------------------------------------------------------------------------
// Activity fallback row builder
// ---------------------------------------------------------------------------

export function buildActivityFallbackResults(
  response: MemoryQueryApiResponse,
  query: string,
  isScreenTimeSpentQueryFn: (text: string) => boolean,
): ScreenRecordingResult[] {
  const timeTruth = response.time_truth || undefined;
  const topBuckets = Array.isArray(timeTruth?.top_buckets) ? timeTruth?.top_buckets || [] : [];
  if (topBuckets.length === 0) {
    return [];
  }

  if (!isScreenTimeSpentQueryFn(query)) {
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

// ---------------------------------------------------------------------------
// Screen search context resolvers
// ---------------------------------------------------------------------------

export async function fetchOnDemandScreenSearchContext(
  token: string,
  params: { query: string; daysBack?: number; limit?: number },
  isScreenTimeSpentQueryFn: (text: string) => boolean,
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
      mappedResults = buildActivityFallbackResults(response, params.query, isScreenTimeSpentQueryFn);
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

export async function fetchLocalScreenSearchContext(
  _token: string,
  _params: { query: string; daysBack?: number; limit?: number },
): Promise<ScreenSearchContext | null> {
  return null;
}

export async function resolveScreenSearchContext(
  token: string,
  params: { query: string; daysBack?: number; limit?: number },
  prefetchedScreenSearchContext: ScreenSearchContext | null,
  isScreenTimeSpentQueryFn: (text: string) => boolean,
): Promise<ScreenSearchContext | null> {
  const safeDaysBack = clampDaysBack(params.daysBack);
  const safeLimit = clampSearchLimit(params.limit ?? 20);

  const onDemandContext = await fetchOnDemandScreenSearchContext(token, {
    query: params.query,
    daysBack: safeDaysBack,
    limit: safeLimit,
  }, isScreenTimeSpentQueryFn);

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

export function buildBroadOverviewEvidence(
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
