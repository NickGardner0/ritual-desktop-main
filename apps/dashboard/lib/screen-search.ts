'use client';

import { invoke } from '@tauri-apps/api/tauri';

type ScreenSearchStatus = 'hybrid' | 'text-fallback' | 'text-only' | 'unavailable';
type ScreenSearchMode = 'hybrid' | 'text' | 'none' | 'unavailable';

interface HybridSearchResult {
  frame_id: number;
  timestamp: number;
  app_bundle_id: string;
  app_name: string;
  window_title: string | null;
  ocr_text: string;
  thumbnail_path: string | null;
  video_chunk_id: number | null;
  frame_offset: number | null;
  fts_matched: boolean;
  vector_distance: number;
  combined_score: number;
}

interface TextSearchResult {
  frame_id: number;
  timestamp: number;
  app_bundle_id: string;
  app_name: string;
  window_title: string | null;
  ocr_text: string;
  thumbnail_path: string | null;
  video_chunk_id: number | null;
  frame_offset: number | null;
}

interface EmbeddingStats {
  total_embeddings: number;
  frames_without_embeddings: number;
  embedding_dimension: number;
  current_model: string;
}

interface EmbeddingPipelineReadyResponse {
  initialized: boolean;
  init_error: string | null;
  total_embeddings: number;
  frames_without_embeddings: number;
  worker_running: boolean;
  worker_started: boolean;
}

export interface ScreenSearchResultItem {
  frame_id: number;
  timestamp: number;
  app_bundle_id: string;
  app_name: string;
  window_title: string | null;
  ocr_text: string;
  thumbnail_path: string | null;
  video_chunk_id: number | null;
  frame_offset: number | null;
  relevance_score: number;
  source: 'hybrid' | 'text';
  fts_matched?: boolean;
}

export interface ScreenSearchPrefetchResult {
  modeUsed: ScreenSearchMode;
  status: ScreenSearchStatus;
  results: ScreenSearchResultItem[];
  warning?: string;
  pendingEmbeddings?: number;
  totalEmbeddings?: number;
  workerRunning?: boolean;
}

export interface PrefetchScreenResultsOptions {
  limit?: number;
  minRelevance?: number;
  daysBack?: number;
  pipelineWaitMs?: number;
  pendingFallbackThreshold?: number;
}

const SCREEN_SEARCH_WARNING =
  'Some semantic results may be missing while embeddings finish processing. Showing keyword + partial matches.';
const PIPELINE_BOOT_SESSION_KEY = 'ritual.embedding.pipeline.ready.v1';
const isTauri = typeof window !== 'undefined' && Boolean(
  (window as { __TAURI__?: unknown; __TAURI_IPC__?: unknown }).__TAURI__ ||
  (window as { __TAURI__?: unknown; __TAURI_IPC__?: unknown }).__TAURI_IPC__,
);

let bootEnsurePromise: Promise<EmbeddingPipelineReadyResponse | null> | null = null;

function clampRelevance(score: number): number {
  if (!Number.isFinite(score)) return 0;
  if (score < 0) return 0;
  if (score > 1) return 1;
  return score;
}

async function invokeCommand<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(command, args);
}

function normalizeHybridResults(results: HybridSearchResult[]): ScreenSearchResultItem[] {
  return results.map((item) => ({
    frame_id: item.frame_id,
    timestamp: item.timestamp,
    app_bundle_id: item.app_bundle_id,
    app_name: item.app_name,
    window_title: item.window_title,
    ocr_text: item.ocr_text,
    thumbnail_path: item.thumbnail_path,
    video_chunk_id: item.video_chunk_id,
    frame_offset: item.frame_offset,
    relevance_score: clampRelevance(item.combined_score),
    source: 'hybrid',
    fts_matched: item.fts_matched,
  }));
}

function normalizeTextResults(results: TextSearchResult[]): ScreenSearchResultItem[] {
  return results.map((item) => ({
    frame_id: item.frame_id,
    timestamp: item.timestamp,
    app_bundle_id: item.app_bundle_id,
    app_name: item.app_name,
    window_title: item.window_title,
    ocr_text: item.ocr_text,
    thumbnail_path: item.thumbnail_path,
    video_chunk_id: item.video_chunk_id,
    frame_offset: item.frame_offset,
    relevance_score: 0.35,
    source: 'text',
  }));
}

const DAY_MS = 24 * 60 * 60 * 1000;

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<{ value: T | null; timedOut: boolean }> {
  const timeoutToken = Symbol('timeout');
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<typeof timeoutToken>((resolve) => {
    timeoutHandle = setTimeout(() => resolve(timeoutToken), timeoutMs);
  });

  try {
    const value = await Promise.race([promise, timeoutPromise]);
    const timedOut = value === timeoutToken;
    return {
      value: timedOut ? null : (value as T),
      timedOut,
    };
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

function getTimeRangeFromQuery(query: string): number {
  const lowerQuery = query.toLowerCase();
  const relativeWindowMatch = lowerQuery.match(/\b(?:last|past)\s+(\d{1,3})\s*(hour|hours|day|days|week|weeks|month|months)\b/);
  if (relativeWindowMatch) {
    const amount = Number(relativeWindowMatch[1]);
    const unit = relativeWindowMatch[2];
    if (Number.isFinite(amount) && amount > 0) {
      if (unit.startsWith('hour')) return Math.max(1, Math.ceil(amount / 24));
      if (unit.startsWith('day')) return amount;
      if (unit.startsWith('week')) return amount * 7;
      if (unit.startsWith('month')) return amount * 30;
    }
  }

  const daysAgoMatch = lowerQuery.match(/\b(\d{1,3})\s+days?\s+ago\b/);
  if (daysAgoMatch) {
    const days = Number(daysAgoMatch[1]);
    if (Number.isFinite(days) && days > 0) {
      return days + 1;
    }
  }

  if (lowerQuery.includes('this morning') || lowerQuery.includes('earlier today')) return 1;
  if (lowerQuery.includes('today')) return 1;
  if (lowerQuery.includes('yesterday')) return 2;
  if (lowerQuery.includes('this week') || lowerQuery.includes('past week') || lowerQuery.includes('last 7')) return 7;
  if (lowerQuery.includes('last week')) return 14;
  if (lowerQuery.includes('this month') || lowerQuery.includes('past month') || lowerQuery.includes('last 30')) return 30;

  return 7;
}

export function isScreenRecordingQuery(query: string): boolean {
  const lowerQuery = query.toLowerCase();

  const strongPatterns = [
    'what was i working on',
    'what was i doing',
    'what was i looking at',
    'what did i do on my computer',
    'show me what i was',
    'when did i look at',
    'when was i reading',
    'when was i looking',
    'find when i was',
    'what apps did i use',
    'which apps did i use',
    'what websites',
    'which websites',
    'what was on my screen',
    'screen history',
    'screen recording',
    'computer activity',
    'what did i browse',
    'what did i search',
    'what documents',
    'what files did i',
    'what code was i',
    'what project was i',
    'last time i had',
    'last time i was on',
    'did i use',
    'was i on',
    'did i open',
    'did i visit',
    'did i spend time',
    'where was i working',
    'which app was i',
    'which tab was i',
  ];

  for (const pattern of strongPatterns) {
    if (lowerQuery.includes(pattern)) {
      return true;
    }
  }

  const hasTechnicalContext =
    /(debug|bug|sync|localhost|settings page|designing|figma|terminal|browser|website|url|repo|pull request|typescript|react|next\.js)/.test(
      lowerQuery,
    );
  const hasTemporalIntent = /(when did i|when was i|last time|show me|what was i|what did i)/.test(lowerQuery);

  if (hasTechnicalContext && hasTemporalIntent) {
    return true;
  }

  const looksLikeUrl = /(https?:\/\/|www\.|localhost|:\d{2,5}|\.(com|io|dev|app|org|net)\b)/.test(lowerQuery);
  if (looksLikeUrl && /(when|last time|show|open|opened|visit|visited|had)/.test(lowerQuery)) {
    return true;
  }

  const hasWeakIntent = /(what was i|working on|looked at|browsing|viewing)/.test(lowerQuery);
  const hasTimeRef = /(yesterday|this morning|this afternoon|last night|earlier today|this week|last week|today|ago)/.test(
    lowerQuery,
  );

  const hasComputerEntity =
    /(screen|computer|desktop|laptop|window|tab|browser|website|site|url|app|apps|cursor|figma|github|notion|slack|chrome|safari|firefox|terminal|vscode|xcode|repo|localhost|\.(com|io|dev|app|org|net)\b)/.test(
      lowerQuery,
    );
  const hasQuestionIntent = /(what|when|where|which|did i|was i|have i|show me|find|last time|history|timeline)/.test(
    lowerQuery,
  );
  const hasActivityVerb =
    /(working|coding|debugging|browsing|reading|watching|editing|designing|searching|opened|open|using|use|visited|visit|spent|spend|doing|did|looked|looking)/.test(
      lowerQuery,
    );

  if (hasComputerEntity && (hasQuestionIntent || (hasActivityVerb && hasTimeRef))) {
    return true;
  }

  return hasWeakIntent && hasTimeRef;
}

export async function ensureEmbeddingPipelineReady(): Promise<EmbeddingPipelineReadyResponse | null> {
  if (!isTauri) return null;

  try {
    return await invokeCommand<EmbeddingPipelineReadyResponse>('ensure_embedding_pipeline_ready');
  } catch (commandError) {
    console.warn('ensure_embedding_pipeline_ready command unavailable, using fallback flow:', commandError);
  }

  try {
    const statsBefore = await invokeCommand<EmbeddingStats>('get_embedding_stats');
    let initError: string | null = null;

    try {
      await invokeCommand<string>('init_embedding_service');
    } catch (error) {
      initError = error instanceof Error ? error.message : String(error);
    }

    const statsAfter = await invokeCommand<EmbeddingStats>('get_embedding_stats');

    let workerRunning = false;
    try {
      workerRunning = await invokeCommand<boolean>('is_embedding_worker_running');
    } catch {
      workerRunning = false;
    }

    let workerStarted = false;
    if (initError === null && statsAfter.frames_without_embeddings > 0 && !workerRunning) {
      try {
        await invokeCommand<string>('start_embedding_worker');
        workerRunning = true;
        workerStarted = true;
      } catch (error) {
        console.warn('Failed to start embedding worker from fallback flow:', error);
      }
    }

    return {
      initialized: initError === null,
      init_error: initError,
      total_embeddings: statsAfter.total_embeddings ?? statsBefore.total_embeddings ?? 0,
      frames_without_embeddings: statsAfter.frames_without_embeddings ?? statsBefore.frames_without_embeddings ?? 0,
      worker_running: workerRunning,
      worker_started: workerStarted,
    };
  } catch (error) {
    console.warn('Fallback embedding pipeline readiness flow failed:', error);
    return null;
  }
}

export async function ensureEmbeddingPipelineReadyOnLaunch(): Promise<EmbeddingPipelineReadyResponse | null> {
  if (!isTauri || typeof window === 'undefined') return null;

  try {
    if (window.sessionStorage.getItem(PIPELINE_BOOT_SESSION_KEY) === '1') {
      return null;
    }
  } catch {
    // Ignore sessionStorage errors and proceed.
  }

  if (!bootEnsurePromise) {
    bootEnsurePromise = ensureEmbeddingPipelineReady()
      .then((result) => {
        try {
          window.sessionStorage.setItem(PIPELINE_BOOT_SESSION_KEY, '1');
        } catch {
          // Ignore storage errors.
        }
        return result;
      })
      .finally(() => {
        bootEnsurePromise = null;
      });
  }

  return bootEnsurePromise;
}

export async function prefetchScreenResults(
  query: string,
  opts: PrefetchScreenResultsOptions = {},
): Promise<ScreenSearchPrefetchResult> {
  if (!isTauri || !query.trim()) {
    return {
      modeUsed: 'unavailable',
      status: 'unavailable',
      results: [],
    };
  }

  const limit = opts.limit ?? 20;
  const minRelevance = opts.minRelevance ?? 0.3;
  const now = Date.now();
  const daysBack = opts.daysBack ?? getTimeRangeFromQuery(query);
  const cutoffTime = now - daysBack * DAY_MS;

  const pipelineResult = await withTimeout(ensureEmbeddingPipelineReady(), opts.pipelineWaitMs ?? 1400);
  const pipeline = pipelineResult.value;
  const pendingEmbeddings = pipeline?.frames_without_embeddings;
  const totalEmbeddings = pipeline?.total_embeddings;
  const workerRunning = pipeline?.worker_running;

  let warning: string | undefined;
  if (pipelineResult.timedOut || pipeline?.init_error) {
    warning = SCREEN_SEARCH_WARNING;
  }
  if (typeof pendingEmbeddings === 'number' && pendingEmbeddings > 0) {
    warning = warning ?? SCREEN_SEARCH_WARNING;
  }

  const pendingFallbackThreshold = opts.pendingFallbackThreshold ?? 500;
  const forceTextMode =
    pipelineResult.timedOut ||
    Boolean(pipeline?.init_error) ||
    (typeof pendingEmbeddings === 'number' &&
      typeof totalEmbeddings === 'number' &&
      totalEmbeddings === 0 &&
      pendingEmbeddings > pendingFallbackThreshold);

  if (!forceTextMode) {
    try {
      let hybridResults = await invokeCommand<HybridSearchResult[]>('hybrid_search', {
        options: {
          query,
          limit,
          min_relevance: minRelevance,
          start_time: cutoffTime,
          end_time: now,
          fts_weight: 0.3,
          vector_weight: 0.7,
        },
      });

      if (hybridResults.length === 0) {
        hybridResults = await invokeCommand<HybridSearchResult[]>('hybrid_search', {
          options: {
            query,
            limit,
            min_relevance: minRelevance,
            fts_weight: 0.3,
            vector_weight: 0.7,
          },
        });
      }

      if (hybridResults.length > 0) {
        return {
          modeUsed: 'hybrid',
          status: 'hybrid',
          results: normalizeHybridResults(hybridResults),
          warning,
          pendingEmbeddings,
          totalEmbeddings,
          workerRunning,
        };
      }
    } catch (error) {
      console.warn('Hybrid search failed, falling back to text search:', error);
      warning = warning ?? SCREEN_SEARCH_WARNING;
    }
  } else {
    warning = warning ?? SCREEN_SEARCH_WARNING;
  }

  try {
    const textResults = await invokeCommand<TextSearchResult[]>('text_search', {
      query,
      limit: Math.max(40, limit * 3),
    });
    const normalizedTextResults = normalizeTextResults(textResults);
    const inRangeTextResults = normalizedTextResults.filter((item) => item.timestamp >= cutoffTime && item.timestamp <= now);
    const boundedTextResults = (inRangeTextResults.length > 0 ? inRangeTextResults : normalizedTextResults).slice(0, limit);

    return {
      modeUsed: 'text',
      status: forceTextMode ? 'text-only' : 'text-fallback',
      results: boundedTextResults,
      warning,
      pendingEmbeddings,
      totalEmbeddings,
      workerRunning,
    };
  } catch (error) {
    console.warn('Text search failed:', error);
    return {
      modeUsed: 'unavailable',
      status: 'unavailable',
      results: [],
      warning,
      pendingEmbeddings,
      totalEmbeddings,
      workerRunning,
    };
  }
}
