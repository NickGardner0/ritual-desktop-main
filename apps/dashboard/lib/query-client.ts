import { QueryClient } from '@tanstack/react-query';
import { QUERY_POLICY } from '@/lib/query-policies';

/**
 * Query Client Configuration - Inspired by Midday
 * 
 * This configuration optimizes for:
 * - Desktop app performance (longer cache times since data is local)
 * - Minimal re-fetching (we control when to refresh)
 * - Optimistic updates (instant UI feedback)
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Default desktop-web mixed policy. Hotter or colder domains should
      // override this at the hook level.
      staleTime: QUERY_POLICY.general.staleTime,
      
      // Keep unused data in cache for 10 minutes
      gcTime: QUERY_POLICY.general.gcTime,
      
      // Don't refetch when window regains focus (desktop app behavior)
      refetchOnWindowFocus: false,
      
      // Don't refetch when reconnecting (we're always connected locally)
      refetchOnReconnect: false,
      
      // Retry transient failures once, but never retry auth errors (401/403).
      // Auth errors happen when Clerk hasn't finished refreshing the JWT
      // after an app restart — retrying just floods the backend with
      // doomed requests. The queries will naturally refetch once
      // Clerk's session refresh completes and components re-render.
      retry: (failureCount, error) => {
        if (failureCount >= 1) return false;
        const msg = (error as Error)?.message ?? '';
        if (msg.includes('401') || msg.includes('403')) return false;
        return true;
      },
      
      // Fast retry delay (100ms for localhost)
      retryDelay: 100,
    },
    mutations: {
      retry: 1,
    },
  },
});
