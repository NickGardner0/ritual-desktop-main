'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useUser, useAuth } from '@clerk/nextjs';
import { useMemo } from 'react';
import type { CreateHabitInput, HabitRecord } from '@ritual/shared-contracts';
import type { Habit, HabitLog } from '@/contexts/habits-context.types';
import { useAnalytics } from '@/lib/analytics';
import { QUERY_POLICY } from '@/lib/query-policies';
import { applyCanonicalOverviewSnapshot, applyOptimisticOverviewStatDelta, invalidateAfterHabitWrite, invalidateHabitData } from '@/lib/query-invalidation';
import { habitKeys as canonicalHabitKeys, habitLogKeys as canonicalHabitLogKeys } from '@/lib/dashboard/query-keys';
import { clearReadConsistencyRequirement, markReadConsistencyRequired, shouldForceFreshRead } from '@/lib/read-consistency';
import { apiOperationWithAuth } from '@/lib/api/client';
import { BackendClientError } from '@/lib/api/generated/backend-client';
import { putLocalVaultHabit, putLocalVaultHabitLog, putLocalVaultHabitWriteOutboxItem, readLocalVaultHabitLogs, readLocalVaultHabits, readLocalVaultHabitWriteOutboxItems } from '@/lib/privacy/habit-vault-adapter';
import { buildHabitCreateOutboxItem, buildHabitLogCreateOutboxItem, buildOptimisticHabit, buildOptimisticHabitLog, createHabitClientEventId, getHabitLogOptimisticDelta, getHabitLogOptimisticUnit, markOutboxItemFailed, markOutboxItemSynced, mergeHabitLogsWithOutbox, mergeHabitsWithOutbox, upsertById, type HabitLogMutationInput, type HabitWriteOutboxItem, type OptimisticHabit, type OptimisticHabitLog } from '@/lib/habits/local-first-writes';
import { useHabitWriteOutboxSync } from './use-habit-outbox-sync';
import { playInteractionSound } from '@/lib/interaction-sounds';

const HABITS_SNAPSHOT_STORAGE_KEY = 'ritual:habits-snapshot:v1';
const HABIT_LOGS_SNAPSHOT_STORAGE_KEY = 'ritual:habit-logs-snapshot:v1';
const SNAPSHOT_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7;

export const habitKeys = canonicalHabitKeys;
export const habitLogKeys = canonicalHabitLogKeys;

type PersistedSnapshot<T> = { updatedAt: number; data: T };
type SnapshotEnvelope<T> = { byUser?: Record<string, PersistedSnapshot<T>> };
type MutationErrorWithStatus = Error & { status?: number };
type BatchLogResult = {
  success?: boolean;
  results?: Array<{ success?: boolean; habit_name?: string }>;
  error?: string;
  message?: string;
  overview_snapshot?: unknown;
};
type LogHabitMutationContext = { previousLogs?: HabitLog[]; rollbackOverview?: () => void; optimisticLog?: OptimisticHabitLog; outboxItem?: HabitWriteOutboxItem; hadLocalVaultLogs?: boolean };
type CreateHabitMutationContext = { previousHabits?: Habit[]; optimisticHabit?: OptimisticHabit; outboxItem?: HabitWriteOutboxItem; hadLocalVaultHabits?: boolean };

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

function getMutationErrorStatus(error: unknown): number | undefined {
  if (error instanceof BackendClientError) return error.status;
  return typeof (error as MutationErrorWithStatus | undefined)?.status === 'number'
    ? (error as MutationErrorWithStatus).status
    : undefined;
}

function shouldRollbackOptimisticWrite(error: unknown): boolean {
  const status = getMutationErrorStatus(error);
  return Boolean(status && status >= 400 && status < 500);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function clearPersistedHabitSnapshots(): void {
  if (typeof window === 'undefined') return;

  window.localStorage.removeItem(HABITS_SNAPSHOT_STORAGE_KEY);
  window.localStorage.removeItem(HABIT_LOGS_SNAPSHOT_STORAGE_KEY);
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
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  useHabitWriteOutboxSync();
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

      const outboxItems = await readLocalVaultHabitWriteOutboxItems(user.id);
      const localVaultHabits = await readLocalVaultHabits(user.id);
      if (localVaultHabits) {
        const mergedHabits = mergeHabitsWithOutbox(localVaultHabits, outboxItems);
        persistSnapshot(HABITS_SNAPSHOT_STORAGE_KEY, mergedHabits, user.id);
        clearReadConsistencyRequirement(user.id);
        return mergedHabits;
      }

      if (process.env.NODE_ENV !== 'production') { console.log('🔄 [React Query] Fetching habits for user:', user.primaryEmailAddress?.emailAddress); }

      try {
        const habits = await apiOperationWithAuth(
          'get_habits_api_habits_get',
          getToken,
          {},
          user.id,
        );
        const mergedHabits = mergeHabitsWithOutbox(habits as Habit[], outboxItems);
        persistSnapshot(HABITS_SNAPSHOT_STORAGE_KEY, mergedHabits, user.id);
        clearReadConsistencyRequirement(user.id);
        if (process.env.NODE_ENV !== 'production') { console.log('✅ [React Query] Habits fetched:', mergedHabits.length); }
        return mergedHabits;
      } catch (error) {
        if (fallbackSnapshot?.data) {
          console.warn('⚠️ [React Query] Falling back to persisted habits snapshot:', error);
          return mergeHabitsWithOutbox(fallbackSnapshot.data, outboxItems);
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
  const { getToken } = useAuth();
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

      const outboxItems = await readLocalVaultHabitWriteOutboxItems(user.id);
      const localVaultLogs = await readLocalVaultHabitLogs(user.id);
      if (localVaultLogs) {
        const mergedLogs = mergeHabitLogsWithOutbox(localVaultLogs, outboxItems);
        persistSnapshot(HABIT_LOGS_SNAPSHOT_STORAGE_KEY, mergedLogs, user.id);
        clearReadConsistencyRequirement(user.id);
        return mergedLogs;
      }

      if (process.env.NODE_ENV !== 'production') { console.log('🔄 [React Query] Fetching habit logs...'); }

      try {
        const logs = await apiOperationWithAuth(
          'get_all_habit_logs_api_habit_logs_get',
          getToken,
          {},
          user.id,
        );
        const processedLogs = logs.map((log) => ({
          ...log,
          duration: log.duration || 0,
        }));

        const mergedLogs = mergeHabitLogsWithOutbox(processedLogs as HabitLog[], outboxItems);
        persistSnapshot(HABIT_LOGS_SNAPSHOT_STORAGE_KEY, mergedLogs, user.id);
        clearReadConsistencyRequirement(user.id);
        if (process.env.NODE_ENV !== 'production') { console.log('✅ [React Query] Habit logs fetched:', mergedLogs.length); }
        return mergedLogs;
      } catch (error) {
        if (fallbackSnapshot?.data) {
          console.warn('⚠️ [React Query] Falling back to persisted habit logs snapshot:', error);
          return mergeHabitLogsWithOutbox(fallbackSnapshot.data, outboxItems);
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

  return useMutation<any, Error, HabitLogMutationInput, LogHabitMutationContext>({
    mutationFn: async (habitLog) => {
      if (!user?.id) throw new Error('No user');
      habitLog.client_event_id = habitLog.client_event_id || createHabitClientEventId({
        kind: 'habit_log_create',
        entityId: habitLog.habit_id,
        date: habitLog.date,
      });
      if (process.env.NODE_ENV !== 'production') { console.log('📝 [React Query] Logging habit:', habitLog); }

      let result: BatchLogResult;
      try {
        result = await apiOperationWithAuth(
          'batch_log_habits_api_logs_batch_post',
          getToken,
          {
            body: {
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
              client_event_id: habitLog.client_event_id,
            },
          },
          user.id,
        ) as BatchLogResult;
      } catch (error) {
        if (error instanceof BackendClientError) {
          let parsed: BatchLogResult | null = null;
          try { parsed = JSON.parse(error.responseBody) as BatchLogResult; } catch { parsed = null; }
          console.error('❌ Failed to log habit:', parsed);
          const failed = new Error(parsed?.error || `Failed to log habit: ${error.status}`) as MutationErrorWithStatus;
          failed.status = error.status;
          throw failed;
        }
        throw error;
      }
      if (!result?.success || !result?.results?.[0]?.success) {
        const error = new Error(result?.error || result?.message || 'Failed to log habit') as MutationErrorWithStatus;
        error.status = 400;
        throw error;
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

    onMutate: async (habitLog) => {
      if (!user?.id) return {};

      const userId = user.id;
      const queryKey = habitLogKeys.list(userId);
      const habits = queryClient.getQueryData<Habit[]>(habitKeys.list(userId)) || [];
      const habit = habits.find((candidate) => candidate.id === habitLog.habit_id);
      const clientEventId = habitLog.client_event_id || createHabitClientEventId({
        kind: 'habit_log_create',
        entityId: habitLog.habit_id,
        date: habitLog.date,
      });
      habitLog.client_event_id = clientEventId;

      const optimisticLog = buildOptimisticHabitLog(habitLog, userId, { clientEventId });
      const outboxItem = buildHabitLogCreateOutboxItem(userId, habitLog, optimisticLog);

      await queryClient.cancelQueries({ queryKey });
      const previousLogs = queryClient.getQueryData<HabitLog[]>(queryKey);
      const nextLogs = upsertById(previousLogs || [], optimisticLog);
      queryClient.setQueryData<HabitLog[]>(queryKey, nextLogs);
      persistSnapshot(HABIT_LOGS_SNAPSHOT_STORAGE_KEY, nextLogs, userId);

      const rollbackOverview = optimisticLog.status === 'completed'
        ? applyOptimisticOverviewStatDelta(queryClient, userId, {
            habitId: optimisticLog.habit_id,
            habitName: habitLog.habit_name || habit?.name || 'Habit',
            unit: getHabitLogOptimisticUnit(optimisticLog, habit),
            delta: getHabitLogOptimisticDelta(optimisticLog),
            date: optimisticLog.date,
          })
        : undefined;

      const [hadLocalVaultLogs] = await Promise.all([
        readLocalVaultHabitLogs(userId).then((logs) => Boolean(logs?.length)).catch(() => false),
        putLocalVaultHabitWriteOutboxItem(userId, outboxItem).catch((error) => {
          console.warn('⚠️ [React Query] Failed to persist local habit log outbox item:', error);
          return null;
        }),
      ]);

      if (process.env.NODE_ENV !== 'production') { console.log('⚡ [React Query] Optimistic habit log applied locally.'); }
      return {
        previousLogs,
        rollbackOverview,
        optimisticLog,
        outboxItem,
        hadLocalVaultLogs,
      };
    },

    onError: async (err, _vars, context) => {
      console.error('❌ [React Query] Log habit failed:', err);
      if (shouldRollbackOptimisticWrite(err)) {
        if (context?.previousLogs) {
          queryClient.setQueryData(habitLogKeys.list(user?.id || 'anonymous'), context.previousLogs);
          persistSnapshot(HABIT_LOGS_SNAPSHOT_STORAGE_KEY, context.previousLogs, user?.id);
        }
        context?.rollbackOverview?.();
      } else if (user?.id && context?.outboxItem) {
        await putLocalVaultHabitWriteOutboxItem(
          user.id,
          markOutboxItemFailed(context.outboxItem, getErrorMessage(err)),
        ).catch((error) => {
          console.warn('⚠️ [React Query] Failed to mark local habit log outbox item failed:', error);
        });
      }
    },

    onSuccess: async (result, _vars, context) => {
      playInteractionSound('habitLogCreated');
      markReadConsistencyRequired(user?.id);
      if (user?.id && result?.overview_snapshot?.overviewStats) {
        applyCanonicalOverviewSnapshot(queryClient, user.id, result.overview_snapshot);
      }

      if (user?.id && context?.optimisticLog) {
        const serverLogId = result?.results?.[0]?.log_id;
        const syncedLog: HabitLog = {
          ...context.optimisticLog,
          id: serverLogId || context.optimisticLog.id,
          duration: context.optimisticLog.duration || 0,
        };
        const queryKey = habitLogKeys.list(user.id);
        const previousLogs = queryClient.getQueryData<HabitLog[]>(queryKey) || [];
        const nextLogs = upsertById(
          previousLogs.filter((log) => log.id !== context.optimisticLog?.id),
          syncedLog,
        );
        queryClient.setQueryData<HabitLog[]>(queryKey, nextLogs);
        persistSnapshot(HABIT_LOGS_SNAPSHOT_STORAGE_KEY, nextLogs, user.id);

        if (context.hadLocalVaultLogs) {
          void putLocalVaultHabitLog(user.id, syncedLog).catch((error) => {
            console.warn('⚠️ [React Query] Failed to persist synced habit log to local vault:', error);
          });
        }
      }

      if (user?.id && context?.outboxItem) {
        await putLocalVaultHabitWriteOutboxItem(
          user.id,
          markOutboxItemSynced(context.outboxItem),
        ).catch((error) => {
          console.warn('⚠️ [React Query] Failed to mark local habit log outbox item synced:', error);
        });
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

  return useMutation<HabitRecord, Error, CreateHabitInput, CreateHabitMutationContext>({
    mutationFn: async (habitData: CreateHabitInput): Promise<HabitRecord> => {
      if (!user?.id) throw new Error('No user');
      if (process.env.NODE_ENV !== 'production') { console.log('➕ [React Query] Creating habit:', habitData); }

      try {
        return await apiOperationWithAuth(
          'create_habit_api_habits_post',
          getToken,
          { body: habitData },
          user.id,
        ) as HabitRecord;
      } catch (error) {
        if (error instanceof BackendClientError) {
          let detail = error.responseBody;
          try {
            const parsed = JSON.parse(error.responseBody) as { detail?: unknown };
            if (typeof parsed?.detail === 'string') detail = parsed.detail;
          } catch {
            /* use raw text */
          }
          const failed = new Error(
            detail ? `Failed to create habit (${error.status}): ${detail}` : `Failed to create habit: ${error.status}`,
          ) as MutationErrorWithStatus;
          failed.status = error.status;
          throw failed;
        }
        throw error;
      }
    },

    onMutate: async (habitData) => {
      if (!user?.id) return {};

      const userId = user.id;
      const queryKey = habitKeys.list(userId);
      const optimisticHabit = buildOptimisticHabit(habitData, userId);
      const outboxItem = buildHabitCreateOutboxItem(userId, habitData, optimisticHabit);

      await queryClient.cancelQueries({ queryKey });
      const previousHabits = queryClient.getQueryData<Habit[]>(queryKey);
      const nextHabits = upsertById(previousHabits || [], optimisticHabit);
      queryClient.setQueryData<Habit[]>(queryKey, nextHabits);
      persistSnapshot(HABITS_SNAPSHOT_STORAGE_KEY, nextHabits, userId);

      const [hadLocalVaultHabits] = await Promise.all([
        readLocalVaultHabits(userId).then((habits) => Boolean(habits?.length)).catch(() => false),
        putLocalVaultHabitWriteOutboxItem(userId, outboxItem).catch((error) => {
          console.warn('⚠️ [React Query] Failed to persist local habit create outbox item:', error);
          return null;
        }),
      ]);

      if (process.env.NODE_ENV !== 'production') { console.log('⚡ [React Query] Optimistic habit create applied locally.'); }
      return {
        previousHabits,
        optimisticHabit,
        outboxItem,
        hadLocalVaultHabits,
      };
    },

    onError: async (err, _vars, context) => {
      console.error('❌ [React Query] Create habit failed:', err);
      if (shouldRollbackOptimisticWrite(err)) {
        if (context?.previousHabits) {
          queryClient.setQueryData(habitKeys.list(user?.id || 'anonymous'), context.previousHabits);
          persistSnapshot(HABITS_SNAPSHOT_STORAGE_KEY, context.previousHabits, user?.id);
        }
      } else if (user?.id && context?.outboxItem) {
        await putLocalVaultHabitWriteOutboxItem(
          user.id,
          markOutboxItemFailed(context.outboxItem, getErrorMessage(err)),
        ).catch((error) => {
          console.warn('⚠️ [React Query] Failed to mark local habit create outbox item failed:', error);
        });
      }
    },

    onSuccess: async (data, _vars, context) => {
      if (process.env.NODE_ENV !== 'production') { console.log('✅ [React Query] Habit created, refetching...'); }
      markReadConsistencyRequired(user?.id);

      if (user?.id && context?.optimisticHabit) {
        const canonicalHabit = data as Habit;
        const queryKey = habitKeys.list(user.id);
        const previousHabits = queryClient.getQueryData<Habit[]>(queryKey) || [];
        const nextHabits = upsertById(
          previousHabits.filter((habit) => habit.id !== context.optimisticHabit?.id),
          canonicalHabit,
        );
        queryClient.setQueryData<Habit[]>(queryKey, nextHabits);
        persistSnapshot(HABITS_SNAPSHOT_STORAGE_KEY, nextHabits, user.id);

        if (context.hadLocalVaultHabits) {
          void putLocalVaultHabit(user.id, canonicalHabit).catch((error) => {
            console.warn('⚠️ [React Query] Failed to persist synced habit to local vault:', error);
          });
        }
      }

      if (user?.id && context?.outboxItem) {
        await putLocalVaultHabitWriteOutboxItem(
          user.id,
          markOutboxItemSynced(context.outboxItem),
        ).catch((error) => {
          console.warn('⚠️ [React Query] Failed to mark local habit create outbox item synced:', error);
        });
      }

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
      if (!user?.id) throw new Error('No user');
      try {
        return await apiOperationWithAuth(
          'update_habit_api_habits__habit_id__put',
          getToken,
          {
            pathParams: { habit_id: habitId },
            body: {
              name: updates.name,
              category: updates.category,
              icon: updates.icon,
              integration_source: updates.integration_source,
              is_custom: updates.is_custom,
              metric_type: updates.metric_type,
              unit_type: updates.unit_type,
            },
          },
          user.id,
        ) as Habit;
      } catch (error) {
        if (error instanceof BackendClientError) {
          throw new Error(
            error.responseBody
              ? `Failed to update habit (${error.status}): ${error.responseBody}`
              : `Failed to update habit: ${error.status}`,
          );
        }
        throw error;
      }
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
      if (!user?.id) throw new Error('No user');
      if (process.env.NODE_ENV !== 'production') { console.log('🗑️ [React Query] Deleting habit:', habitId); }

      try {
        await apiOperationWithAuth(
          'delete_habit_api_habits__habit_id__delete',
          getToken,
          { pathParams: { habit_id: habitId } },
          user.id,
        );
      } catch (error) {
        if (error instanceof BackendClientError) {
          throw new Error(`Failed to delete habit: ${error.status}`);
        }
        throw error;
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
