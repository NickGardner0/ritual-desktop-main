'use client';

import { useEffect } from 'react';
import { useAuth, useUser } from '@clerk/nextjs';
import { useQueryClient } from '@tanstack/react-query';
import { apiFetchWithAuth } from '@/lib/api/client';
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
  const token = await getToken();
  const response = await fetch('/api/logs/batch', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
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
    }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.success || !result?.results?.[0]?.success) {
    throw new Error(result?.error || result?.message || `Habit log outbox replay failed: ${response.status}`);
  }
}

async function replayHabitCreate(
  item: HabitCreateOutboxItem,
  getToken: (opts?: { skipCache?: boolean }) => Promise<string | null>,
) {
  const response = await apiFetchWithAuth('/api/habits', getToken, {
    method: 'POST',
    body: JSON.stringify(item.payload.input),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `Habit create outbox replay failed: ${response.status}`);
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
