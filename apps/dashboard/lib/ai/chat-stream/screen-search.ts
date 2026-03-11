import { PYTHON_API_BASE } from './core';

// Screen recording search types
interface ScreenRecordingResult {
  frame_id: number;
  chunk_id?: number;
  session_id?: number;
  timestamp: number;
  app_bundle_id: string;
  app_name: string;
  window_title: string | null;
  ocr_text: string;
  relevance_score: number;
  capture_quality?: number;
  source_type?: string;
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

interface MemoryQueryApiResponse {
  success: boolean;
  retrieval_tier?:
    | 'semantic_full'
    | 'semantic_frame'
    | 'lexical_fts'
    | 'cloud_hybrid'
    | 'cloud_lexical_only'
    | 'activity_only'
    | 'unavailable'
    | string;
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
  days_back?: number;
  start_date?: string;
  end_date?: string;
  semantic_truth?: {
    mode_used?: string;
    warning?: string;
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
  } | null;
  citations?: Array<{
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
  warning?: string;
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

export function clampDaysBack(daysBack?: number): number {
  if (!Number.isFinite(daysBack) || !daysBack || daysBack <= 0) return 7;
  return Math.min(Math.max(Math.round(daysBack), 1), 90);
}

export function clampSearchLimit(limit?: number): number {
  if (!Number.isFinite(limit) || !limit || limit <= 0) return 10;
  return Math.min(Math.max(Math.round(limit), 1), 50);
}

export function extractScreenSearchTokens(query: string): string[] {
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

export function normalizeScreenSearchContext(
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
    if (text.includes('url:') || text.includes('domain:')) return text.length >= 24;
    return text.length >= 48;
  }
  if (text.length < 16) return false;
  return true;
}

async function fetchPythonApiPost(
  endpoint: string,
  token: string,
  body: Record<string, unknown>,
) {
  const url = `${PYTHON_API_BASE}${endpoint}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API error: ${response.status} - ${errorText}`);
  }
  return response.json();
}

export async function fetchOnDemandScreenSearchContext(
  token: string,
  params: { query: string; daysBack?: number; limit?: number },
): Promise<ScreenSearchContext | null> {
  try {
    const response = await fetchPythonApiPost('/api/memory/query', token, {
      query: params.query,
      intent: 'semantic_lookup',
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
      : semanticHighlights.some((item) => item?.app_name || item?.window_title || hasSubstantiveOcrEvidence(String(item?.snippet || '')))
        ? semanticHighlights
        : citations;

    const mappedResults: ScreenRecordingResult[] = sourceRows
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
          relevance_score: Math.max(0, Math.min(1, Number((item as any).relevance_score ?? item.score ?? 0))),
          source: item.source === 'activity' ? 'activity' : 'hybrid',
          fts_matched: item.source !== 'activity',
        } as ScreenRecordingResult;
      })
      .filter((item): item is ScreenRecordingResult => Boolean(item));

    const retrievalTier = response.retrieval_tier as ScreenSearchContext['retrievalTier'] | undefined;
    const retrievalTierMode = mapRetrievalTierToMode(retrievalTier);
    const retrievalTierStatus = mapRetrievalTierToStatus(retrievalTier);

    const modeRaw = response.semantic_truth?.mode_used || '';
    const modeUsed: ScreenSearchContext['modeUsed'] = retrievalTierMode || (
      modeRaw.includes('hybrid')
        ? 'hybrid'
        : modeRaw.includes('activity')
          ? 'activity'
          : mappedResults.length > 0
            ? 'text'
            : 'none'
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
      warning: [response.warning, response.semantic_truth?.warning].filter(Boolean).join(' ') || undefined,
      freshness: response.freshness,
      confidence: response.confidence,
      citations,
      semanticTruth: response.semantic_truth || undefined,
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

export async function executeSearchScreenRecordings(
  token: string,
  params: { query: string; daysBack?: number; limit?: number },
  _prefetchedScreenSearchContext: ScreenSearchContext | null
): Promise<string> {
  console.log('🖥️ searchScreenRecordings called:', params);
  return executeSearchContextMemory(token, params);
}

export async function executeSearchContextMemory(
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

    const results = Array.isArray(response?.results) ? response.results : [];
    return JSON.stringify({
      success: Boolean(response?.success),
      query: params.query,
      days_searched: Number(response?.days_back || safeDaysBack),
      result_count: Number(response?.result_count || results.length),
      results,
      status: response?.status || 'unavailable',
      mode_used: response?.mode_used || 'none',
      warning: response?.warning,
      retrieval_tier: response?.retrieval_tier,
      debug: response?.debug || null,
      message:
        results.length > 0
          ? undefined
          : `No context memory matches found for "${params.query}".`,
    });
  } catch (error) {
    console.warn('Context memory search failed:', error);
    return JSON.stringify({
      success: false,
      error: 'Context memory search is currently unavailable.',
      hint: 'Make sure context awareness capture has recent snapshots.',
    });
  }
}
