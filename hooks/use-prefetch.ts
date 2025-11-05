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

const PYTHON_API_BASE = process.env.NEXT_PUBLIC_PYTHON_API_URL;
if (!PYTHON_API_BASE) {
  throw new Error('NEXT_PUBLIC_PYTHON_API_URL must be configured');
}

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
        const token = await getToken();
        console.log('⚡ [Prefetch] Loading habits in background...');

        const response = await fetch(`${PYTHON_API_BASE}/api/habits`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) throw new Error('Failed to prefetch habits');

        const habits = await response.json();
        console.log('✅ [Prefetch] Habits loaded!');
        return habits;
      },
      staleTime: 1000 * 60 * 5, // 5 minutes
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
        const token = await getToken();
        console.log('⚡ [Prefetch] Loading habit logs in background...');

        const response = await fetch(`${PYTHON_API_BASE}/api/habit-logs`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) throw new Error('Failed to prefetch logs');

        const logs = await response.json();
        console.log('✅ [Prefetch] Habit logs loaded!');
        return logs;
      },
      staleTime: 1000 * 60 * 2, // 2 minutes
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
  const prefetchLogs = usePrefetchHabitLogs();

  return {
    onMouseEnter: () => {
      prefetchHabits.onMouseEnter();
      prefetchLogs.onMouseEnter();
    },
    onFocus: () => {
      prefetchHabits.onFocus();
      prefetchLogs.onFocus();
    },
  };
}

/**
 * Prefetch analytics page data
 */
export function usePrefetchAnalytics() {
  const prefetchHabits = usePrefetchHabits();
  const prefetchLogs = usePrefetchHabitLogs();

  return {
    onMouseEnter: () => {
      console.log('⚡ [Prefetch] Preloading analytics data...');
      prefetchHabits.onMouseEnter();
      prefetchLogs.onMouseEnter();
    },
    onFocus: () => {
      prefetchHabits.onFocus();
      prefetchLogs.onFocus();
    },
  };
}

/**
 * Prefetch calendar page data
 */
export function usePrefetchCalendar() {
  const prefetchHabits = usePrefetchHabits();
  const prefetchLogs = usePrefetchHabitLogs();

  return {
    onMouseEnter: () => {
      console.log('⚡ [Prefetch] Preloading calendar data...');
      prefetchHabits.onMouseEnter();
      prefetchLogs.onMouseEnter();
    },
    onFocus: () => {
      prefetchHabits.onFocus();
      prefetchLogs.onFocus();
    },
  };
}

/**
 * Prefetch timer page data
 */
export function usePrefetchTimer() {
  const prefetchHabits = usePrefetchHabits();

  return {
    onMouseEnter: () => {
      console.log('⚡ [Prefetch] Preloading timer data...');
      prefetchHabits.onMouseEnter();
    },
    onFocus: () => {
      prefetchHabits.onFocus();
    },
  };
}

