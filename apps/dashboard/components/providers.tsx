'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/query-client';
import { ReactNode } from 'react';

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
  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}

