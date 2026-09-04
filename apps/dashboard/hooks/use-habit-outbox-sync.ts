'use client';

import { useEffect } from 'react';
import { useAuth, useUser } from '@/lib/desktop-session';
import { useQueryClient } from '@tanstack/react-query';
import { apiOperationWithAuth } from '@/lib/api/client';
import { BackendClientError } from '@/lib/api/generated/backend-client';
import { invalidateHabitData } from '@/lib/query-invalidation';
import { markReadConsistencyRequired } from '@/lib/read-consistency';
import {
  putLocalVaultHabitWriteOutboxItem,
  readLocalVaultHabitWriteOutboxItems,
} from '@/lib/privacy/habit-vault-adapter';
import {
  markOutboxItemFailed,
  markOutboxItemSynced,
  shouldReplayHabitOutboxItem,
  type HabitCreateOutboxItem,
  type HabitLogCreateOutboxItem,
  type HabitWriteOutboxItem,
} from '@/lib/habits/local-first-writes';

const syncingUsers = new Set<string>();

async function replayHabitLogCreate(
  item: HabitLogCreateOutboxItem,
  getToken: (opts?: { skipCache?: boolean }) => Promise<string | null>,
) {
  const input = item.payload.input;
  let result: { success?: boolean; results?: Array<{ success?: boolean }>; error?: string; message?: string };
  try {
    result = await apiOperationWithAuth(
      'batch_log_habits_api_logs_batch_post',
      getToken,
      {
        body: {
          items: [{
            habit_id: input.habit_id,
            duration: input.duration,
            amount: input.amount,
            date: input.date,
            completed_at: input.completed_at,
            unit: input.unit,
            source: 'manual',
            notes: input.notes,
          }],
          client_event_id: item.clientEventId,
        },
      },
    ) as typeof result;
  } catch (error) {
    if (error instanceof BackendClientError) {
      throw new Error(error.responseBody || `Habit log outbox replay failed: ${error.status}`);
    }
    throw error;
  }
  if (!result?.success || !result?.results?.[0]?.success) {
    throw new Error(result?.error || result?.message || 'Habit log outbox replay failed');
  }
}

async function replayHabitCreate(
  item: HabitCreateOutboxItem,
  getToken: (opts?: { skipCache?: boolean }) => Promise<string | null>,
) {
  try {
    await apiOperationWithAuth(
      'create_habit_api_habits_post',
      getToken,
      { body: item.payload.input },
    );
  } catch (error) {
    if (error instanceof BackendClientError) {
      throw new Error(error.responseBody || `Habit create outbox replay failed: ${error.status}`);
    }
    throw error;
  }
}

async function replayHabitOutboxItem(
  item: HabitWriteOutboxItem,
  getToken: (opts?: { skipCache?: boolean }) => Promise<string | null>,
) {
  if (item.kind === 'habit_log_create') {
    await replayHabitLogCreate(item, getToken);
  } else {
    await replayHabitCreate(item, getToken);
  }
}

export function useHabitWriteOutboxSync() {
  const { user } = useUser();
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!user?.id) return;

    const userId = user.id;
    let cancelled = false;

    const run = async () => {
      if (syncingUsers.has(userId)) return;
      syncingUsers.add(userId);

      let syncedAny = false;
      try {
        const items = await readLocalVaultHabitWriteOutboxItems(userId);
        for (const item of items || []) {
          if (cancelled || !shouldReplayHabitOutboxItem(item)) continue;

          try {
            await replayHabitOutboxItem(item, getToken);
            await putLocalVaultHabitWriteOutboxItem(userId, markOutboxItemSynced(item));
            syncedAny = true;
          } catch (error) {
            await putLocalVaultHabitWriteOutboxItem(
              userId,
              markOutboxItemFailed(item, error instanceof Error ? error.message : String(error)),
            ).catch(() => null);
          }
        }
      } finally {
        syncingUsers.delete(userId);
      }

      if (!cancelled && syncedAny) {
        markReadConsistencyRequired(userId);
        await invalidateHabitData(queryClient, userId);
      }
    };

    void run();
    window.addEventListener('online', run);
    return () => {
      cancelled = true;
      window.removeEventListener('online', run);
    };
  }, [getToken, queryClient, user?.id]);
}
