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

const PYTHON_API_BASE = process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';

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
  const queryClient = useQueryClient();
  const { user } = useUser();
  const { getToken } = useAuth();
  const prefetchHabits = usePrefetchHabits();
  const prefetchLogs = usePrefetchHabitLogs();

  const prefetchAnalyticsSummary = async () => {
    if (!user) return;
    
    await queryClient.prefetchQuery({
      queryKey: ['analytics-summary', user.id],
      queryFn: async () => {
        const token = await getToken();
        const backendUrl = process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';
        
        console.log('⚡ [Prefetch] Loading analytics summary...');
        
        // Fetch habits and logs in parallel
        const [habitsRes, logsRes] = await Promise.all([
          fetch(`${backendUrl}/api/habits`, {
            headers: { 'Authorization': `Bearer ${token}` }
          }),
          fetch(`${backendUrl}/api/habit-logs`, {
            headers: { 'Authorization': `Bearer ${token}` }
          })
        ]);
        
        const habits = await habitsRes.json();
        const logs = await logsRes.json();
        
        // Calculate summary metrics
        const totalLogs = logs.length;
        const completedLogs = logs.filter((log: any) => log.status === 'completed').length;
        const completionRate = totalLogs > 0 ? Math.round((completedLogs / totalLogs) * 100) : 0;
        
        console.log('✅ [Prefetch] Analytics summary loaded!');
        
        return {
          habits,
          summaryMetrics: {
            totalHabits: habits.length,
            totalLogs,
            completionRate,
            bestHabit: habits[0] ? { name: habits[0].name, rate: 100 } : null
          }
        };
      },
      staleTime: QUERY_POLICY.staticResource.staleTime,
    });
  };

  return {
    onMouseEnter: () => {
      console.log('⚡ [Prefetch] Preloading analytics data...');
      prefetchAnalyticsSummary();
      prefetchHabits.onMouseEnter();
      prefetchLogs.onMouseEnter();
    },
    onFocus: () => {
      prefetchAnalyticsSummary();
      prefetchHabits.onFocus();
      prefetchLogs.onFocus();
    },
  };
}
