/**
 * Prefetching Hooks
 * 
 * These hooks prefetch data on hover, making navigation feel instant!
 * Inspired by Midday's approach.
 */

'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useUser, useAuth } from '@clerk/nextjs';
import { habitKeys, habitLogKeys } from './use-habits-query';
import { QUERY_POLICY } from '@/lib/query-policies';
import { apiFetchWithAuth } from '@/lib/api/client';

/**
 * Prefetch habits on hover
 * 
 * Usage:
 * <Link href="/dashboard" {...usePrefetchHabits()}>
 *   Dashboard
 * </Link>
 */
export function usePrefetchHabits() {
  const queryClient = useQueryClient();
  const { user } = useUser();
  const { getToken } = useAuth();

  const prefetchHabits = async () => {
    if (!user) return;

    await queryClient.prefetchQuery({
      queryKey: habitKeys.list(user.id),
      queryFn: async () => {
        console.log('⚡ [Prefetch] Loading habits in background...');

        const response = await apiFetchWithAuth('/api/habits', getToken);

        if (!response.ok) throw new Error('Failed to prefetch habits');

        const habits = await response.json();
        console.log('✅ [Prefetch] Habits loaded!');
        return habits;
      },
      staleTime: QUERY_POLICY.staticResource.staleTime,
    });
  };

  return {
    onMouseEnter: prefetchHabits,
    onFocus: prefetchHabits,
  };
}

/**
 * Prefetch habit logs on hover
 */
export function usePrefetchHabitLogs() {
  const queryClient = useQueryClient();
  const { user } = useUser();
  const { getToken } = useAuth();

  const prefetchLogs = async () => {
    if (!user) return;

    await queryClient.prefetchQuery({
      queryKey: habitLogKeys.list(user.id),
      queryFn: async () => {
        console.log('⚡ [Prefetch] Loading habit logs in background...');

        const response = await apiFetchWithAuth('/api/habit-logs', getToken);

        if (!response.ok) throw new Error('Failed to prefetch logs');

        const logs = await response.json();
        console.log('✅ [Prefetch] Habit logs loaded!');
        return logs;
      },
      staleTime: QUERY_POLICY.general.staleTime,
    });
  };

  return {
    onMouseEnter: prefetchLogs,
    onFocus: prefetchLogs,
  };
}

/**
 * Prefetch both habits and logs (for dashboard)
 */
export function usePrefetchDashboard() {
  const prefetchHabits = usePrefetchHabits();

  return {
    onMouseEnter: () => {
      prefetchHabits.onMouseEnter();
    },
    onFocus: () => {
      prefetchHabits.onFocus();
    },
  };
}

/**
 * Prefetch analytics page data
 */
export function usePrefetchAnalytics() {
  const prefetchHabits = usePrefetchHabits();

  return {
    onMouseEnter: () => {
      console.log('⚡ [Prefetch] Preloading analytics data...');
      prefetchHabits.onMouseEnter();
    },
    onFocus: () => {
      prefetchHabits.onFocus();
    },
  };
}
