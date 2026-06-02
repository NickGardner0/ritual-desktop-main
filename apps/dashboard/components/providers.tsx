'use client';

import { QueryClientProvider, dehydrate, hydrate, type Query } from '@tanstack/react-query';
import { useUser } from '@clerk/nextjs';
import * as Sentry from '@sentry/nextjs';
import { usePathname } from 'next/navigation';
import { queryClient } from '@/lib/query-client';
import { ReactNode, useEffect, useState } from 'react';
import { auditLocalStorage, auditQueryCache, perfInfo, perfWarn } from '@/lib/perf-debug';
import { clearPersistedHabitSnapshots } from '@/hooks/use-habits-query';

const QUERY_CACHE_STORAGE_KEY = 'ritual:react-query-cache:v1';
const QUERY_CACHE_MAX_AGE_MS = 1000 * 60 * 60 * 12;
const MAX_PERSISTED_QUERY_BYTES = 75_000;
const ACTIVE_QUERY_CACHE_USER_KEY = 'ritual:active-query-cache-user:v1';

function isDesktopRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as Window & { __TAURI__?: unknown; __TAURI_IPC__?: unknown };
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  return Boolean(w.__TAURI__ || w.__TAURI_IPC__ || userAgent.includes('RitualDesktop/'));
}

function getDesktopVersion(): string | undefined {
  if (typeof navigator === 'undefined') return undefined;
  return navigator.userAgent.match(/RitualDesktop\/([0-9A-Za-z.\-_]+)/)?.[1];
}

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
    'dashboard-snapshot',
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

function clearPersistedQueryCache() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(QUERY_CACHE_STORAGE_KEY);
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
  const { isLoaded, user } = useUser();
  const pathname = usePathname();
  const [cacheRestored] = useState(() => {
    restorePersistedQueryCache();
    return true;
  });

  useEffect(() => {
    if (!isLoaded) return;

    const runtime = isDesktopRuntime() ? 'desktop' : 'web';
    const desktopVersion = getDesktopVersion();
    Sentry.setTag('runtime', runtime);
    Sentry.setTag('surface', runtime === 'desktop' ? 'desktop-webview' : 'web-client');
    Sentry.setTag('route', pathname || 'unknown');
    if (desktopVersion) {
      Sentry.setTag('desktop_version', desktopVersion);
    }

    if (user?.id) {
      Sentry.setUser({
        id: user.id,
        email: user.primaryEmailAddress?.emailAddress,
      });
    } else {
      Sentry.setUser(null);
    }
  }, [isLoaded, pathname, user?.id, user?.primaryEmailAddress?.emailAddress]);

  useEffect(() => {
    if (typeof window === 'undefined' || !isLoaded) return;

    const previousUserId = window.sessionStorage.getItem(ACTIVE_QUERY_CACHE_USER_KEY);
    const currentUserId = user?.id ?? null;

    if (!previousUserId) {
      if (currentUserId) {
        window.sessionStorage.setItem(ACTIVE_QUERY_CACHE_USER_KEY, currentUserId);
      }
      return;
    }

    if (previousUserId === currentUserId) {
      return;
    }

    queryClient.clear();
    clearPersistedQueryCache();
    clearPersistedHabitSnapshots();

    if (currentUserId) {
      window.sessionStorage.setItem(ACTIVE_QUERY_CACHE_USER_KEY, currentUserId);
    } else {
      window.sessionStorage.removeItem(ACTIVE_QUERY_CACHE_USER_KEY);
    }
  }, [isLoaded, user?.id]);

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
