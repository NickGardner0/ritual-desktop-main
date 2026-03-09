import { PYTHON_API_BASE } from './core';

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
  pendingEmbeddings?: number;
  totalEmbeddings?: number;
  workerRunning?: boolean;
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
  days_back?: number;
  start_date?: string;
  end_date?: string;
  semantic_truth?: {
    mode_used?: string;
    warning?: string;
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
}

interface ScreenSearchDebugPayload {
  enabled: true;
  mode_used: ScreenSearchContext['modeUsed'];
  status: ScreenSearchContext['status'];
  retrieval_tier?: ScreenSearchContext['retrievalTier'];
  warning?: string;
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
  if (text.startsWith('window:') || text.startsWith('app:')) return false;
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
    const sourceRows = semanticHighlights.length > 0 ? semanticHighlights : citations;

    const mappedResults: ScreenRecordingResult[] = sourceRows
      .map((item) => {
        const timestamp = Number(item.timestamp || 0);
        if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
        return {
          frame_id: Number(item.frame_id || 0),
          timestamp,
          app_bundle_id: '',
          app_name: item.app_name || 'Unknown',
          window_title: item.window_title || null,
          ocr_text: item.snippet || '',
          relevance_score: Math.max(0, Math.min(1, Number(item.score || 0))),
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
  prefetchedScreenSearchContext: ScreenSearchContext | null
): Promise<string> {
  console.log('🖥️ searchScreenRecordings called:', params);
  console.log('🖥️ prefetched screenRecordingResults count:', prefetchedScreenSearchContext?.results?.length ?? 0);

  const safeDaysBack = clampDaysBack(params.daysBack);
  const safeLimit = clampSearchLimit(params.limit);

  const onDemandContext = await fetchOnDemandScreenSearchContext(token, {
    query: params.query,
    daysBack: safeDaysBack,
    limit: Math.max(safeLimit * 2, 20),
  });

  let screenSearchContext: ScreenSearchContext | null = onDemandContext ?? prefetchedScreenSearchContext;
  if (onDemandContext && prefetchedScreenSearchContext) {
    const mergedResults = mergeScreenResults(onDemandContext.results ?? [], prefetchedScreenSearchContext.results ?? []);
    const hasHybridResult = mergedResults.some((result) => result.source === 'hybrid');
    const warnings = [onDemandContext.warning, prefetchedScreenSearchContext.warning].filter(Boolean);
    screenSearchContext = {
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

  // Distinguish between "service not available" (null/undefined) and "no results" (empty array)
  if (screenSearchContext === null || screenSearchContext === undefined) {
    return JSON.stringify({
      success: false,
      error: 'Screen history search is currently unavailable.',
      hint: 'Make sure screen recording is active and local indexing is still processing.',
    });
  }

  const screenRecordingResults = screenSearchContext.results ?? [];
  const resolvedDaysBack = screenSearchContext.resolvedDaysBack ?? safeDaysBack;
  if (screenRecordingResults.length === 0 && screenSearchContext.status === 'unavailable') {
    return JSON.stringify({
      success: false,
      error: 'Screen history search is currently unavailable.',
      hint: 'Make sure computer tracking is enabled and local screen indexing has produced data.',
      warning: screenSearchContext.warning,
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
      warning: screenSearchContext.warning,
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
      warning: screenSearchContext.warning,
      debug: buildScreenSearchDebug(screenSearchContext, filteredResults),
      message: `No screen recordings found matching "${params.query}" in the requested time range.`,
    });
  }

  const confidenceLevel = screenSearchContext.confidence?.level || 'low';
  const confidenceScore = Number(screenSearchContext.confidence?.score || 0);
  const corroboratingChunks = Number(screenSearchContext.confidence?.corroborating_chunks || 0);
  const substantiveEvidenceCount = filteredResults.filter((item) => hasSubstantiveOcrEvidence(item.ocr_text)).length;
  const strongMatchCount = filteredResults.filter((item) => item.relevance_score >= 0.6).length;
  const weakEvidenceOnly = (
    confidenceLevel === 'low'
    || confidenceScore < 0.6
    || strongMatchCount === 0
    || substantiveEvidenceCount === 0
    || corroboratingChunks < 1
  );

  if (weakEvidenceOnly) {
    const weakEvidenceWarning = [
      'Only weak semantic evidence is currently available for this query.',
      'Avoid topic-specific claims until stronger OCR citations are present.',
      screenSearchContext.warning,
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
      message: 'Evidence is too weak for a reliable topic-specific answer right now.',
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
    warning: screenSearchContext.warning,
    freshness: screenSearchContext.freshness,
    confidence: screenSearchContext.confidence,
    debug: buildScreenSearchDebug(screenSearchContext, filteredResults),
    results: formattedResults,
  });
}
