'use client';

import { QueryClientProvider, dehydrate, hydrate, type Query } from '@tanstack/react-query';
import { queryClient } from '@/lib/query-client';
import { ReactNode, useEffect, useState } from 'react';

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
    if (!raw) return;

    const parsed = JSON.parse(raw) as {
      timestamp?: number;
      state?: unknown;
    };

    if (!parsed?.state) return;
    if (parsed.timestamp && Date.now() - parsed.timestamp > QUERY_CACHE_MAX_AGE_MS) {
      window.localStorage.removeItem(QUERY_CACHE_STORAGE_KEY);
      return;
    }

    hydrate(queryClient, parsed.state);
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

    window.localStorage.setItem(
      QUERY_CACHE_STORAGE_KEY,
      JSON.stringify({
        timestamp: Date.now(),
        state: dehydratedState,
      }),
    );
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
