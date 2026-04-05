'use client';

import { QueryClientProvider, dehydrate, hydrate, type Query } from '@tanstack/react-query';
import { queryClient } from '@/lib/query-client';
import { ReactNode, useEffect, useState } from 'react';
import { auditLocalStorage, auditQueryCache, perfInfo, perfWarn } from '@/lib/perf-debug';
import { isTauri } from '@/lib/tauri-utils';

const QUERY_CACHE_STORAGE_KEY = 'ritual:react-query-cache:v1';
const QUERY_CACHE_MAX_AGE_MS = 1000 * 60 * 60 * 12;
const MAX_PERSISTED_QUERY_BYTES = 75_000;

function getPersistedQuerySize(query: Query): number {
  try {
    return JSON.stringify(query.state.data).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function shouldPersistQuery(query: Query): boolean {
  if (query.state.status !== 'success') return false;

  const queryKey = Array.isArray(query.queryKey) ? query.queryKey : [];
  const scope = String(queryKey[0] || '');

  const persistableScopes = [
    'habits',
    'whoop-status',
    'apple-watch-status',
    'wearable-connections',
    'financial-connections',
    'computer-tracking-status',
    'integrations-overview',
  ];

  if (!persistableScopes.includes(scope)) {
    return false;
  }

  return getPersistedQuerySize(query) <= MAX_PERSISTED_QUERY_BYTES;
}

function restorePersistedQueryCache() {
  if (typeof window === 'undefined') return;

  try {
    const raw = window.localStorage.getItem(QUERY_CACHE_STORAGE_KEY);
    if (!raw) {
      perfInfo('query-provider', 'restore-cache-miss', {
        key: QUERY_CACHE_STORAGE_KEY,
      });
      return;
    }

    const parsed = JSON.parse(raw) as {
      timestamp?: number;
      state?: unknown;
    };

    if (!parsed?.state) {
      perfWarn('query-provider', 'restore-cache-empty-state', {
        key: QUERY_CACHE_STORAGE_KEY,
        bytes: raw.length,
      });
      return;
    }
    if (parsed.timestamp && Date.now() - parsed.timestamp > QUERY_CACHE_MAX_AGE_MS) {
      window.localStorage.removeItem(QUERY_CACHE_STORAGE_KEY);
      perfWarn('query-provider', 'restore-cache-expired', {
        key: QUERY_CACHE_STORAGE_KEY,
        age_ms: Date.now() - parsed.timestamp,
        bytes: raw.length,
      });
      return;
    }

    hydrate(queryClient, parsed.state);
    perfInfo('query-provider', 'restore-cache-success', {
      key: QUERY_CACHE_STORAGE_KEY,
      bytes: raw.length,
      age_ms: parsed.timestamp ? Date.now() - parsed.timestamp : undefined,
    });
    auditQueryCache('query-provider', queryClient);
  } catch (error) {
    console.warn('Failed to restore React Query cache:', error);
  }
}

function persistQueryCache() {
  if (typeof window === 'undefined') return;

  try {
    const dehydratedState = dehydrate(queryClient, {
      shouldDehydrateQuery: shouldPersistQuery,
    });

    const payload = JSON.stringify({
      timestamp: Date.now(),
      state: dehydratedState,
    });

    window.localStorage.setItem(
      QUERY_CACHE_STORAGE_KEY,
      payload,
    );
    perfInfo('query-provider', 'persist-cache-success', {
      key: QUERY_CACHE_STORAGE_KEY,
      bytes: payload.length,
      query_count: dehydratedState.queries?.length ?? 0,
    });
  } catch (error) {
    console.warn('Failed to persist React Query cache:', error);
  }
}

/**
 * React Query Provider Wrapper
 * 
 * This wraps the app with QueryClientProvider to enable:
 * - Client-side caching
 * - Optimistic updates
 * - Automatic refetching
 * - Background updates
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [cacheRestored] = useState(() => {
    restorePersistedQueryCache();
    return true;
  });

  useEffect(() => {
    if (!cacheRestored) return;
    auditLocalStorage('query-provider', [QUERY_CACHE_STORAGE_KEY]);
    auditQueryCache('query-provider', queryClient);

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const schedulePersist = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      timeoutId = setTimeout(() => {
        persistQueryCache();
      }, 300);
    };

    const unsubscribe = queryClient.getQueryCache().subscribe(() => {
      schedulePersist();
    });

    const flushPersist = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      persistQueryCache();
    };

    window.addEventListener('beforeunload', flushPersist);
    document.addEventListener('visibilitychange', flushPersist);

    return () => {
      unsubscribe();
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      window.removeEventListener('beforeunload', flushPersist);
      document.removeEventListener('visibilitychange', flushPersist);
    };
  }, [cacheRestored]);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}
