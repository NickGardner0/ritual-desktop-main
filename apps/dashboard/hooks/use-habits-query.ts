/**
 * React Query Hooks for Habits
 * 
 * These hooks provide:
 * - Automatic caching
 * - Canonical post-write snapshots
 * - Background refetching
 * - Deduplication of requests
 * - Analytics tracking via OpenPanel
 * 
 * Inspired by Midday's approach
 */

'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useUser, useAuth } from '@clerk/nextjs';
import { useMemo } from 'react';
import type { Habit, HabitLog } from '@/contexts/habits-context.types';
import { useAnalytics } from '@/lib/analytics';
import { QUERY_POLICY } from '@/lib/query-policies';
import {
  applyCanonicalOverviewSnapshot,
  invalidateAfterHabitWrite,
  invalidateHabitData,
} from '@/lib/query-invalidation';
import {
  habitKeys as canonicalHabitKeys,
  habitLogKeys as canonicalHabitLogKeys,
} from '@/lib/dashboard/query-keys';
import {
  clearReadConsistencyRequirement,
  getReadConsistencyHeaders,
  markReadConsistencyRequired,
  shouldForceFreshRead,
} from '@/lib/read-consistency';

const PYTHON_API_BASE = process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';
const LOCAL_HABITS_API = '/api/habits';
const LOCAL_HABIT_LOGS_API = '/api/habit-logs';
const HABITS_SNAPSHOT_STORAGE_KEY = 'ritual:habits-snapshot:v1';
const HABIT_LOGS_SNAPSHOT_STORAGE_KEY = 'ritual:habit-logs-snapshot:v1';
const SNAPSHOT_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7;

export const habitKeys = canonicalHabitKeys;
export const habitLogKeys = canonicalHabitLogKeys;

type PersistedSnapshot<T> = {
  updatedAt: number;
  data: T;
};

type SnapshotEnvelope<T> = {
  byUser?: Record<string, PersistedSnapshot<T>>;
};

function getSuccessfulQuerySnapshot<T>(
  queryClient: ReturnType<typeof useQueryClient>,
  queryKey: readonly unknown[],
): { data: T; updatedAt: number } | null {
  const state = queryClient.getQueryState(queryKey);
  if (state?.status !== 'success' || state.data == null || state.dataUpdatedAt <= 0) {
    return null;
  }

  return {
    data: state.data as T,
    updatedAt: state.dataUpdatedAt,
  };
}

function readPersistedSnapshot<T>(
  storageKey: string,
  userId?: string | null,
): PersistedSnapshot<T> | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as SnapshotEnvelope<T>;
    if (!userId) return null;

    const candidate = parsed.byUser?.[userId];
    if (!candidate?.data || !candidate.updatedAt) return null;

    if (Date.now() - candidate.updatedAt > SNAPSHOT_MAX_AGE_MS) {
      return null;
    }

    return candidate;
  } catch (error) {
    console.warn(`Failed to restore persisted snapshot for ${storageKey}:`, error);
    return null;
  }
}

function persistSnapshot<T>(
  storageKey: string,
  data: T,
  userId?: string | null,
): void {
  if (typeof window === 'undefined') return;

  try {
    const raw = window.localStorage.getItem(storageKey);
    const parsed = raw ? JSON.parse(raw) as SnapshotEnvelope<T> : {};
    const snapshot: PersistedSnapshot<T> = {
      data,
      updatedAt: Date.now(),
    };

    const normalizedUserId = userId?.trim();
    if (!normalizedUserId) return;

    const next: SnapshotEnvelope<T> = {
      byUser: {
        ...(parsed.byUser || {}),
        [normalizedUserId]: snapshot,
      },
    };

    window.localStorage.setItem(storageKey, JSON.stringify(next));
  } catch (error) {
    console.warn(`Failed to persist snapshot for ${storageKey}:`, error);
  }
}

export function clearPersistedHabitSnapshots(): void {
  if (typeof window === 'undefined') return;

  window.localStorage.removeItem(HABITS_SNAPSHOT_STORAGE_KEY);
  window.localStorage.removeItem(HABIT_LOGS_SNAPSHOT_STORAGE_KEY);
}

/**
 * Fetch with automatic retry on 401/403 using a fresh token.
 * Reduces stale-token errors on initial load or after app was backgrounded.
 */
async function fetchWithAuthRetry(
  url: string,
  getToken: (opts?: { skipCache?: boolean }) => Promise<string | null>,
  options?: RequestInit
): Promise<Response> {
  const token = await getToken();
  if (!token) throw new Error('No auth token available');

  let response = await fetch(url, {
    ...options,
    headers: {
      ...options?.headers,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if ((response.status === 401 || response.status === 403) && response.url.includes('/api/')) {
    const freshToken = await getToken({ skipCache: true });
    if (freshToken) {
      response = await fetch(url, {
        ...options,
        headers: {
          ...options?.headers,
          Authorization: `Bearer ${freshToken}`,
          'Content-Type': 'application/json',
        },
      });
    }
  }

  return response;
}

/**
 * Fetch Habits with React Query
 * 
 * Features:
 * - Cached for 5 minutes
 * - Auto-refetch on mutation
 * - Deduplicated requests
 */
export function useHabitsQuery() {
  const { user, isLoaded } = useUser();
  const queryClient = useQueryClient();
  const bypassPersistedSnapshot = useMemo(
    () => shouldForceFreshRead(user?.id),
    [user?.id],
  );
  const fallbackSnapshot = useMemo(() => {
    if (!user?.id) return null;

    return (
      getSuccessfulQuerySnapshot<Habit[]>(queryClient, habitKeys.list(user.id))
      || readPersistedSnapshot<Habit[]>(HABITS_SNAPSHOT_STORAGE_KEY, user.id)
    );
  }, [queryClient, user?.id]);

  return useQuery({
    queryKey: habitKeys.list(user?.id || 'anonymous'),
    queryFn: async () => {
      if (!user) throw new Error('No user');

      if (process.env.NODE_ENV !== 'production') { console.log('🔄 [React Query] Fetching habits for user:', user.primaryEmailAddress?.emailAddress); }

      try {
        const response = await fetch(LOCAL_HABITS_API, {
          cache: 'no-store',
          credentials: 'include',
          headers: {
            ...getReadConsistencyHeaders(user.id),
          },
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch habits: ${response.status}`);
        }

        const habits = await response.json();
        persistSnapshot(HABITS_SNAPSHOT_STORAGE_KEY, habits as Habit[], user.id);
        clearReadConsistencyRequirement(user.id);
        if (process.env.NODE_ENV !== 'production') { console.log('✅ [React Query] Habits fetched:', habits.length); }
        return habits as Habit[];
      } catch (error) {
        if (fallbackSnapshot?.data) {
          console.warn('⚠️ [React Query] Falling back to persisted habits snapshot:', error);
          return fallbackSnapshot.data;
        }
        throw error;
      }
    },
    initialData: bypassPersistedSnapshot ? undefined : fallbackSnapshot?.data,
    initialDataUpdatedAt: bypassPersistedSnapshot ? undefined : fallbackSnapshot?.updatedAt,
    enabled: isLoaded && !!user?.id,
    staleTime: QUERY_POLICY.optimisticEntity.staleTime,
    gcTime: QUERY_POLICY.optimisticEntity.gcTime,
  });
}

/**
 * Fetch Habit Logs with React Query
 */
export function useHabitLogsQuery({
  enabled = true,
}: {
  enabled?: boolean;
} = {}) {
  const { user, isLoaded } = useUser();
  const queryClient = useQueryClient();
  const bypassPersistedSnapshot = useMemo(
    () => shouldForceFreshRead(user?.id),
    [user?.id],
  );
  const inMemorySnapshot = useMemo(() => {
    if (!enabled || !user?.id) return null;

    return getSuccessfulQuerySnapshot<HabitLog[]>(queryClient, habitLogKeys.list(user.id));
  }, [enabled, queryClient, user?.id]);
  const persistedSnapshot = useMemo(() => {
    if (!enabled || !user?.id || inMemorySnapshot) return null;

    return readPersistedSnapshot<HabitLog[]>(HABIT_LOGS_SNAPSHOT_STORAGE_KEY, user.id);
  }, [enabled, inMemorySnapshot, user?.id]);
  const fallbackSnapshot = inMemorySnapshot || persistedSnapshot;
  const bootstrappedFromPersistedSnapshot = !inMemorySnapshot && Boolean(persistedSnapshot);

  return useQuery({
    queryKey: habitLogKeys.list(user?.id || 'anonymous'),
    queryFn: async () => {
      if (!user) throw new Error('No user');

      if (process.env.NODE_ENV !== 'production') { console.log('🔄 [React Query] Fetching habit logs...'); }

      try {
        const response = await fetch(LOCAL_HABIT_LOGS_API, {
          cache: 'no-store',
          credentials: 'include',
          headers: {
            ...getReadConsistencyHeaders(user.id),
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

        persistSnapshot(HABIT_LOGS_SNAPSHOT_STORAGE_KEY, processedLogs as HabitLog[], user.id);
        clearReadConsistencyRequirement(user.id);
        if (process.env.NODE_ENV !== 'production') { console.log('✅ [React Query] Habit logs fetched:', processedLogs.length); }
        return processedLogs as HabitLog[];
      } catch (error) {
        if (fallbackSnapshot?.data) {
          console.warn('⚠️ [React Query] Falling back to persisted habit logs snapshot:', error);
          return fallbackSnapshot.data;
        }
        throw error;
      }
    },
    initialData: bypassPersistedSnapshot ? undefined : fallbackSnapshot?.data,
    initialDataUpdatedAt: bypassPersistedSnapshot ? undefined : fallbackSnapshot?.updatedAt,
    enabled: enabled && isLoaded && !!user?.id,
    // Habit logs can grow very large, so keep them warm for longer and rely on
    // explicit invalidation after mutations instead of constant background
    // polling/refetch-on-focus.
    staleTime: QUERY_POLICY.optimisticEntity.staleTime,
    gcTime: QUERY_POLICY.optimisticEntity.gcTime,
    refetchOnMount: bootstrappedFromPersistedSnapshot ? 'always' : false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: false,
    refetchIntervalInBackground: false,
  });
}

/**
 * Log Habit Mutation with canonical post-write refresh
 * 
 * Aggregate totals are updated from the backend snapshot returned by /api/logs/batch.
 */
export function useLogHabitMutation() {
  const queryClient = useQueryClient();
  const { user } = useUser();
  const { getToken } = useAuth();
  const { trackHabitLogged } = useAnalytics();

  return useMutation({
    mutationFn: async (habitLog: Omit<HabitLog, 'id'> & { habit_name?: string }) => {
      const token = await getToken();
      if (process.env.NODE_ENV !== 'production') { console.log('📝 [React Query] Logging habit:', habitLog); }

      const response = await fetch('/api/logs/batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          items: [{
            habit_id: habitLog.habit_id,
            duration: habitLog.duration,
            amount: habitLog.amount,
            date: habitLog.date,
            completed_at: habitLog.completed_at,
            unit: habitLog.unit,
            source: 'manual',
            notes: habitLog.notes,
          }],
          client_event_id: `${habitLog.habit_id}:${habitLog.date}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`,
        }),
      });

      const result = await response.json().catch(() => null);
      if (!response.ok) {
        console.error('❌ Failed to log habit:', result);
        throw new Error(result?.error || result?.detail?.message || `Failed to log habit: ${response.status}`);
      }
      if (!result?.success || !result?.results?.[0]?.success) {
        throw new Error(result?.error || result?.message || 'Failed to log habit');
      }
      if (process.env.NODE_ENV !== 'production') { console.log('✅ Habit logged and synced to Tinybird!'); }

      // Track analytics event
      trackHabitLogged({
        habitId: habitLog.habit_id,
        habitName: habitLog.habit_name || result.results?.[0]?.habit_name || 'Unknown',
        value: habitLog.amount ?? habitLog.duration ?? undefined,
        unit: habitLog.unit,
      });

      return result;
    },

    onSuccess: async (result) => {
      markReadConsistencyRequired(user?.id);
      if (user?.id && result?.overview_snapshot?.overviewStats) {
        applyCanonicalOverviewSnapshot(queryClient, user.id, result.overview_snapshot);
      }
      await invalidateAfterHabitWrite(queryClient, user?.id || 'anonymous');
      if (process.env.NODE_ENV !== 'production') { console.log('🔄 [React Query] Canonical habit data invalidated after log write.'); }
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
  const { trackHabitCreated } = useAnalytics();

  return useMutation({
    mutationFn: async (habitData: any) => {
      if (process.env.NODE_ENV !== 'production') { console.log('➕ [React Query] Creating habit:', habitData); }

      const response = await fetchWithAuthRetry(
        `${PYTHON_API_BASE}/api/habits`,
        getToken,
        {
          method: 'POST',
          body: JSON.stringify(habitData),
        }
      );

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        let detail = errText;
        try {
          const j = JSON.parse(errText) as { detail?: unknown };
          if (typeof j?.detail === 'string') detail = j.detail;
        } catch {
          /* use raw text */
        }
        throw new Error(
          detail ? `Failed to create habit (${response.status}): ${detail}` : `Failed to create habit: ${response.status}`
        );
      }

      return response.json();
    },

    onSuccess: (data) => {
      if (process.env.NODE_ENV !== 'production') { console.log('✅ [React Query] Habit created, refetching...'); }
      markReadConsistencyRequired(user?.id);
      void invalidateHabitData(queryClient, user?.id || 'anonymous');
      
      // Track analytics event
      trackHabitCreated({
        habitId: data.id,
        habitName: data.name,
        category: data.category,
        source: data.integration_source || 'manual',
      });
    },
  });
}

/**
 * Update Habit Mutation with Optimistic Metadata Updates
 */
export function useUpdateHabitMutation() {
  const queryClient = useQueryClient();
  const { user } = useUser();
  const { getToken } = useAuth();

  return useMutation({
    mutationFn: async ({
      habitId,
      updates,
    }: {
      habitId: string;
      updates: Partial<Habit>;
    }) => {
      const response = await fetchWithAuthRetry(
        `${PYTHON_API_BASE}/api/habits/${habitId}`,
        getToken,
        {
          method: 'PUT',
          body: JSON.stringify(updates),
        },
      );

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(
          errText
            ? `Failed to update habit (${response.status}): ${errText}`
            : `Failed to update habit: ${response.status}`,
        );
      }

      return response.json() as Promise<Habit>;
    },

    onMutate: async ({ habitId, updates }) => {
      const queryKey = habitKeys.list(user?.id || 'anonymous');

      await queryClient.cancelQueries({ queryKey });

      const previousHabits = queryClient.getQueryData<Habit[]>(queryKey);

      if (previousHabits) {
        queryClient.setQueryData<Habit[]>(
          queryKey,
          previousHabits.map((habit) =>
            habit.id === habitId
              ? {
                  ...habit,
                  ...updates,
                }
              : habit,
          ),
        );
      }

      return { previousHabits };
    },

    onError: (err, _vars, context) => {
      console.error('❌ [React Query] Update habit failed, rolling back:', err);
      if (context?.previousHabits) {
        queryClient.setQueryData(
          habitKeys.list(user?.id || 'anonymous'),
          context.previousHabits,
        );
      }
    },

    onSettled: async () => {
      markReadConsistencyRequired(user?.id);
      await invalidateHabitData(queryClient, user?.id || 'anonymous');
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
  const { trackHabitDeleted } = useAnalytics();

  return useMutation({
    mutationFn: async ({ habitId, habitName, category }: { habitId: string; habitName?: string; category?: string }) => {
      const token = await getToken();
      if (process.env.NODE_ENV !== 'production') { console.log('🗑️ [React Query] Deleting habit:', habitId); }

      const response = await fetch(`${PYTHON_API_BASE}/api/habits/${habitId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to delete habit: ${response.status}`);
      }

      return { habitId, habitName, category };
    },

    // Optimistic update
    onMutate: async ({ habitId }) => {
      const queryKey = habitKeys.list(user?.id || 'anonymous');

      await queryClient.cancelQueries({ queryKey });

      const previousHabits = queryClient.getQueryData<Habit[]>(queryKey);

      if (previousHabits) {
        queryClient.setQueryData<Habit[]>(
          queryKey,
          (old = []) => old.filter(habit => habit.id !== habitId)
        );
      }

      if (process.env.NODE_ENV !== 'production') { console.log('⚡ [React Query] Optimistic delete applied!'); }

      return { previousHabits };
    },

    onError: (err, { habitId }, context) => {
      console.error('❌ [React Query] Delete failed, rolling back:', err);
      if (context?.previousHabits) {
        queryClient.setQueryData(
          habitKeys.list(user?.id || 'anonymous'),
          context.previousHabits
        );
      }
    },

    onSuccess: (data) => {
      // Track analytics event
      trackHabitDeleted({
        habitId: data.habitId,
        habitName: data.habitName || 'Unknown',
        category: data.category,
      });
    },

    onSettled: () => {
      if (process.env.NODE_ENV !== 'production') { console.log('✅ [React Query] Refetching habits after delete...'); }
      markReadConsistencyRequired(user?.id);
      void invalidateHabitData(queryClient, user?.id || 'anonymous');
    },
  });
}
