/**
 * React Query Hooks for Habits
 * 
 * These hooks provide:
 * - Automatic caching
 * - Optimistic updates
 * - Background refetching
 * - Deduplication of requests
 * 
 * Inspired by Midday's approach
 */

'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useUser, useAuth } from '@clerk/nextjs';
import type { Habit, HabitLog } from '@/contexts/HabitsContext';

const PYTHON_API_BASE = process.env.NEXT_PUBLIC_PYTHON_API_URL;
if (!PYTHON_API_BASE) {
  throw new Error('NEXT_PUBLIC_PYTHON_API_URL must be configured');
}

// Query Keys (following Midday's pattern)
export const habitKeys = {
  all: ['habits'] as const,
  lists: () => [...habitKeys.all, 'list'] as const,
  list: (userId: string) => [...habitKeys.lists(), userId] as const,
  details: () => [...habitKeys.all, 'detail'] as const,
  detail: (id: string) => [...habitKeys.details(), id] as const,
};

export const habitLogKeys = {
  all: ['habit-logs'] as const,
  lists: () => [...habitLogKeys.all, 'list'] as const,
  list: (userId: string) => [...habitLogKeys.lists(), userId] as const,
};

/**
 * Fetch Habits with React Query
 * 
 * Features:
 * - Cached for 5 minutes
 * - Auto-refetch on mutation
 * - Deduplicated requests
 */
export function useHabitsQuery() {
  const { user } = useUser();
  const { getToken } = useAuth();

  return useQuery({
    queryKey: habitKeys.list(user?.id || 'anonymous'),
    queryFn: async () => {
      if (!user) throw new Error('No user');

      const token = await getToken();
      console.log('🔄 [React Query] Fetching habits for user:', user.primaryEmailAddress?.emailAddress);

      const response = await fetch(`${PYTHON_API_BASE}/api/habits`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch habits: ${response.status}`);
      }

      const habits = await response.json();
      console.log('✅ [React Query] Habits fetched:', habits.length);
      return habits as Habit[];
    },
    enabled: !!user?.id,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

/**
 * Fetch Habit Logs with React Query
 */
export function useHabitLogsQuery() {
  const { user } = useUser();
  const { getToken } = useAuth();

  return useQuery({
    queryKey: habitLogKeys.list(user?.id || 'anonymous'),
    queryFn: async () => {
      if (!user) throw new Error('No user');

      const token = await getToken();
      console.log('🔄 [React Query] Fetching habit logs...');

      const response = await fetch(`${PYTHON_API_BASE}/api/habit-logs`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch habit logs: ${response.status}`);
      }

      const logs = await response.json();
      const processedLogs = logs.map((log: any) => ({
        ...log,
        duration: log.duration || 0,
      }));

      console.log('✅ [React Query] Habit logs fetched:', processedLogs.length);
      return processedLogs as HabitLog[];
    },
    enabled: !!user?.id,
    staleTime: 1000 * 60 * 2, // 2 minutes (logs change more frequently)
  });
}

/**
 * Log Habit Mutation with Optimistic Updates
 * 
 * This provides instant UI feedback while saving to the backend
 */
export function useLogHabitMutation() {
  const queryClient = useQueryClient();
  const { user } = useUser();
  const { getToken } = useAuth();

  return useMutation({
    mutationFn: async (habitLog: Omit<HabitLog, 'id'>) => {
      const token = await getToken();
      console.log('📝 [React Query] Logging habit:', habitLog);

      const response = await fetch(`${PYTHON_API_BASE}/api/habit-logs`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(habitLog),
      });

      if (!response.ok) {
        throw new Error(`Failed to log habit: ${response.status}`);
      }

      return response.json();
    },

    // Optimistic update - instant UI feedback!
    onMutate: async (newLog) => {
      const queryKey = habitLogKeys.list(user?.id || 'anonymous');

      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey });

      // Snapshot previous value
      const previousLogs = queryClient.getQueryData<HabitLog[]>(queryKey);

      // Optimistically update
      if (previousLogs) {
        queryClient.setQueryData<HabitLog[]>(queryKey, (old = []) => [
          ...old,
          { ...newLog, id: `temp-${Date.now()}` } as HabitLog,
        ]);
      }

      console.log('⚡ [React Query] Optimistic update applied!');

      return { previousLogs };
    },

    // Rollback on error
    onError: (err, newLog, context) => {
      console.error('❌ [React Query] Log failed, rolling back:', err);
      if (context?.previousLogs) {
        queryClient.setQueryData(
          habitLogKeys.list(user?.id || 'anonymous'),
          context.previousLogs
        );
      }
    },

    // Refetch after mutation completes
    onSettled: () => {
      console.log('✅ [React Query] Refetching logs after mutation...');
      queryClient.invalidateQueries({ 
        queryKey: habitLogKeys.list(user?.id || 'anonymous') 
      });
    },
  });
}

/**
 * Create Habit Mutation
 */
export function useCreateHabitMutation() {
  const queryClient = useQueryClient();
  const { user } = useUser();
  const { getToken } = useAuth();

  return useMutation({
    mutationFn: async (habitData: any) => {
      const token = await getToken();
      console.log('➕ [React Query] Creating habit:', habitData);

      const response = await fetch(`${PYTHON_API_BASE}/api/habits`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(habitData),
      });

      if (!response.ok) {
        throw new Error(`Failed to create habit: ${response.status}`);
      }

      return response.json();
    },

    onSuccess: () => {
      console.log('✅ [React Query] Habit created, refetching...');
      queryClient.invalidateQueries({ 
        queryKey: habitKeys.list(user?.id || 'anonymous') 
      });
    },
  });
}

/**
 * Delete Habit Mutation with Optimistic Update
 */
export function useDeleteHabitMutation() {
  const queryClient = useQueryClient();
  const { user } = useUser();
  const { getToken } = useAuth();

  return useMutation({
    mutationFn: async (habitId: string) => {
      const token = await getToken();
      console.log('🗑️ [React Query] Deleting habit:', habitId);

      const response = await fetch(`${PYTHON_API_BASE}/api/habits/${habitId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to delete habit: ${response.status}`);
      }

      return habitId;
    },

    // Optimistic update
    onMutate: async (habitId) => {
      const queryKey = habitKeys.list(user?.id || 'anonymous');

      await queryClient.cancelQueries({ queryKey });

      const previousHabits = queryClient.getQueryData<Habit[]>(queryKey);

      if (previousHabits) {
        queryClient.setQueryData<Habit[]>(
          queryKey,
          (old = []) => old.filter(habit => habit.id !== habitId)
        );
      }

      console.log('⚡ [React Query] Optimistic delete applied!');

      return { previousHabits };
    },

    onError: (err, habitId, context) => {
      console.error('❌ [React Query] Delete failed, rolling back:', err);
      if (context?.previousHabits) {
        queryClient.setQueryData(
          habitKeys.list(user?.id || 'anonymous'),
          context.previousHabits
        );
      }
    },

    onSettled: () => {
      console.log('✅ [React Query] Refetching habits after delete...');
      queryClient.invalidateQueries({ 
        queryKey: habitKeys.list(user?.id || 'anonymous') 
      });
    },
  });
}

