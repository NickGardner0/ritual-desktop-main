/**
 * Hooks for Semantic Search powered by ritual-db with vector embeddings
 * 
 * Provides AI-powered search across screen recordings using libSQL vector search.
 */

import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/tauri';

// ============================================================
// TYPES
// ============================================================

export interface SemanticSearchResult {
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
}

export interface HybridSearchResult {
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

export interface TextSearchResult {
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

export interface RitualDbStats {
  activity_event_count: number;
  ocr_frame_count: number;
  embedding_count: number;
  video_chunk_count: number;
  sync_queue_pending: number;
  db_size_mb: number;
}

export interface EmbeddingStats {
  total_embeddings: number;
  frames_without_embeddings: number;
  embedding_dimension: number;
  current_model: string;
}

export interface MigrationStatus {
  ritual_db_exists: boolean;
  legacy_watcher_db_exists: boolean;
  legacy_frames_db_exists: boolean;
  watcher_migrated: boolean;
  frames_migrated: boolean;
  is_fully_migrated: boolean;
}

export interface ProcessEmbeddingsResult {
  processed: number;
  remaining: number;
  failed: number;
  message: string;
}

export interface EmbeddingWorkerStatus {
  isRunning: boolean;
}

export interface SemanticSearchOptions {
  query: string;
  limit?: number;
  min_relevance?: number;
  start_time?: number;
  end_time?: number;
  app_filter?: string[];
}

export interface HybridSearchOptions extends SemanticSearchOptions {
  fts_weight?: number;
  vector_weight?: number;
}

// ============================================================
// TAURI INVOCATION HELPERS
// ============================================================

const isTauri = typeof window !== 'undefined' && (window as any).__TAURI__;

async function invokeCommand<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri) {
    console.warn(`Tauri command ${command} called in non-Tauri environment`);
    throw new Error('Not running in Tauri');
  }
  return invoke<T>(command, args);
}

// ============================================================
// DATABASE INITIALIZATION
// ============================================================

/**
 * Hook for initializing the ritual database
 */
export function useRitualDatabase() {
  const [isInitialized, setIsInitialized] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initialize = useCallback(async () => {
    if (!isTauri) {
      setError('Not running in Tauri');
      return false;
    }

    setIsInitializing(true);
    setError(null);

    try {
      await invokeCommand<string>('init_ritual_database');
      setIsInitialized(true);
      return true;
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      setError(errorMsg);
      console.error('Failed to initialize ritual database:', errorMsg);
      return false;
    } finally {
      setIsInitializing(false);
    }
  }, []);

  return {
    isInitialized,
    isInitializing,
    error,
    initialize,
  };
}

/**
 * Hook for database statistics
 */
export function useRitualDbStats() {
  const [stats, setStats] = useState<RitualDbStats | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    if (!isTauri) return null;

    setIsLoading(true);
    setError(null);

    try {
      const result = await invokeCommand<RitualDbStats>('get_ritual_db_stats');
      setStats(result);
      return result;
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      setError(errorMsg);
      console.error('Failed to get ritual db stats:', errorMsg);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  return {
    stats,
    isLoading,
    error,
    refetch: fetchStats,
  };
}

/**
 * Hook for migration status
 */
export function useMigrationStatus() {
  const [status, setStatus] = useState<MigrationStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkStatus = useCallback(async () => {
    if (!isTauri) return null;

    setIsLoading(true);
    setError(null);

    try {
      const result = await invokeCommand<MigrationStatus>('check_migration_status');
      setStatus(result);
      return result;
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      setError(errorMsg);
      console.error('Failed to check migration status:', errorMsg);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  return {
    status,
    isLoading,
    error,
    refetch: checkStatus,
  };
}

// ============================================================
// EMBEDDING SERVICE
// ============================================================

/**
 * Hook for managing the embedding service
 */
export function useEmbeddingService() {
  const [isInitialized, setIsInitialized] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [stats, setStats] = useState<EmbeddingStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const initialize = useCallback(async () => {
    if (!isTauri) {
      setError('Not running in Tauri');
      return false;
    }

    setIsInitializing(true);
    setError(null);

    try {
      await invokeCommand<string>('init_embedding_service');
      setIsInitialized(true);
      
      // Fetch stats after initialization
      const embeddingStats = await invokeCommand<EmbeddingStats>('get_embedding_stats');
      setStats(embeddingStats);
      
      return true;
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      setError(errorMsg);
      console.error('Failed to initialize embedding service:', errorMsg);
      return false;
    } finally {
      setIsInitializing(false);
    }
  }, []);

  const refreshStats = useCallback(async () => {
    if (!isTauri) return null;

    try {
      const result = await invokeCommand<EmbeddingStats>('get_embedding_stats');
      setStats(result);
      return result;
    } catch (e) {
      console.error('Failed to get embedding stats:', e);
      return null;
    }
  }, []);

  const processEmbeddings = useCallback(async (batchSize?: number): Promise<ProcessEmbeddingsResult | null> => {
    if (!isTauri) return null;

    try {
      const result = await invokeCommand<ProcessEmbeddingsResult>('process_embeddings', { 
        batchSize: batchSize ?? 50 
      });
      
      // Refresh stats after processing
      await refreshStats();
      
      return result;
    } catch (e) {
      console.error('Failed to process embeddings:', e);
      return null;
    }
  }, [refreshStats]);

  return {
    isInitialized,
    isInitializing,
    stats,
    error,
    initialize,
    refreshStats,
    processEmbeddings,
  };
}

/**
 * Hook for controlling the background embedding worker
 */
export function useEmbeddingWorker() {
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkStatus = useCallback(async () => {
    if (!isTauri) return false;

    try {
      const running = await invokeCommand<boolean>('is_embedding_worker_running');
      setIsRunning(running);
      return running;
    } catch (e) {
      console.error('Failed to check worker status:', e);
      return false;
    }
  }, []);

  const startWorker = useCallback(async () => {
    if (!isTauri) return false;

    setError(null);
    try {
      await invokeCommand<string>('start_embedding_worker');
      setIsRunning(true);
      return true;
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      setError(errorMsg);
      console.error('Failed to start embedding worker:', errorMsg);
      return false;
    }
  }, []);

  const stopWorker = useCallback(async () => {
    if (!isTauri) return false;

    setError(null);
    try {
      await invokeCommand<string>('stop_embedding_worker');
      // Worker will stop asynchronously, check status after a delay
      setTimeout(() => checkStatus(), 1000);
      return true;
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      setError(errorMsg);
      console.error('Failed to stop embedding worker:', errorMsg);
      return false;
    }
  }, [checkStatus]);

  // Check status on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      void checkStatus();
    }, 0);
    return () => clearTimeout(timer);
  }, [checkStatus]);

  return {
    isRunning,
    error,
    startWorker,
    stopWorker,
    checkStatus,
  };
}

// ============================================================
// SEMANTIC SEARCH
// ============================================================

/**
 * Hook for semantic (AI-powered) search
 */
export function useSemanticSearch() {
  const [results, setResults] = useState<SemanticSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async (options: SemanticSearchOptions): Promise<SemanticSearchResult[]> => {
    if (!isTauri || !options.query.trim()) {
      setResults([]);
      return [];
    }

    setIsSearching(true);
    setError(null);

    try {
      const result = await invokeCommand<SemanticSearchResult[]>('semantic_search', { options });
      setResults(result);
      return result;
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      setError(errorMsg);
      console.error('Semantic search failed:', errorMsg);
      setResults([]);
      return [];
    } finally {
      setIsSearching(false);
    }
  }, []);

  const clearResults = useCallback(() => {
    setResults([]);
    setError(null);
  }, []);

  return {
    results,
    isSearching,
    error,
    search,
    clearResults,
  };
}

/**
 * Hook for hybrid search (FTS + vector, recommended default)
 */
export function useHybridSearch() {
  const [results, setResults] = useState<HybridSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async (options: HybridSearchOptions): Promise<HybridSearchResult[]> => {
    if (!isTauri || !options.query.trim()) {
      setResults([]);
      return [];
    }

    setIsSearching(true);
    setError(null);

    try {
      const result = await invokeCommand<HybridSearchResult[]>('hybrid_search', {
        options: {
          ...options,
          fts_weight: options.fts_weight ?? 0.35,
          vector_weight: options.vector_weight ?? 0.65,
        },
      });
      setResults(result);
      return result;
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      setError(errorMsg);
      console.error('Hybrid search failed:', errorMsg);
      setResults([]);
      return [];
    } finally {
      setIsSearching(false);
    }
  }, []);

  const clearResults = useCallback(() => {
    setResults([]);
    setError(null);
  }, []);

  return {
    results,
    isSearching,
    error,
    search,
    clearResults,
  };
}

/**
 * Hook for text (FTS) search via ritual-db
 */
export function useTextSearch() {
  const [results, setResults] = useState<TextSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async (query: string, limit?: number): Promise<TextSearchResult[]> => {
    if (!isTauri || !query.trim()) {
      setResults([]);
      return [];
    }

    setIsSearching(true);
    setError(null);

    try {
      const result = await invokeCommand<TextSearchResult[]>('text_search', { query, limit });
      setResults(result);
      return result;
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      setError(errorMsg);
      console.error('Text search failed:', errorMsg);
      setResults([]);
      return [];
    } finally {
      setIsSearching(false);
    }
  }, []);

  const clearResults = useCallback(() => {
    setResults([]);
    setError(null);
  }, []);

  return {
    results,
    isSearching,
    error,
    search,
    clearResults,
  };
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

/**
 * Format relevance score as percentage
 */
export function formatRelevance(score: number): string {
  return `${Math.round(score * 100)}%`;
}

/**
 * Get relevance badge color based on score
 */
export function getRelevanceColor(score: number): 'destructive' | 'secondary' | 'default' {
  if (score >= 0.8) return 'default';
  if (score >= 0.6) return 'secondary';
  return 'destructive';
}
