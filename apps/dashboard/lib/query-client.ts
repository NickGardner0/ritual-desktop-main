import { QueryClient } from '@tanstack/react-query';

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
      // Cache data for 5 minutes (desktop app, local data)
      staleTime: 1000 * 60 * 5,
      
      // Keep unused data in cache for 10 minutes
      gcTime: 1000 * 60 * 10,
      
      // Don't refetch when window regains focus (desktop app behavior)
      refetchOnWindowFocus: false,
      
      // Don't refetch when reconnecting (we're always connected locally)
      refetchOnReconnect: false,
      
      // Retry failed requests once (local API should be reliable)
      retry: 1,
      
      // Fast retry delay (100ms for localhost)
      retryDelay: 100,
    },
    mutations: {
      // Retry mutations once if they fail
      retry: 1,
    },
  },
});

