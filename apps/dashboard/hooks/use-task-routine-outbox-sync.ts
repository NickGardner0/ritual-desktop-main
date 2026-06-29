'use client';

import { useEffect } from 'react';
import { useAuth, useUser } from '@clerk/nextjs';
import { useQueryClient } from '@tanstack/react-query';

import { apiFetchWithAuth } from '@/lib/api/client';
import {
  putLocalVaultRoutine,
  putLocalVaultTask,
  putLocalVaultTaskRoutineWriteOutboxItem,
  readLocalVaultTaskRoutineWriteOutboxItems,
  tombstoneLocalVaultRoutine,
  tombstoneLocalVaultTask,
} from '@/lib/privacy/task-vault-adapter';
import {
  markTaskRoutineOutboxItemFailed,
  markTaskRoutineOutboxItemSynced,
  rewriteTaskRoutineOutboxItemEntityId,
  shouldReplayTaskRoutineOutboxItem,
  type RoutineCreateOutboxItem,
  type RoutineUpdateOutboxItem,
  type TaskCreateOutboxItem,
  type TaskRoutineWriteOutboxItem,
  type TaskUpdateOutboxItem,
} from '@/lib/tasks/local-first-writes';
import { markReadConsistencyRequired } from '@/lib/read-consistency';
import type { Routine, RoutineListResponse, Task } from '@/lib/tasks/types';

const syncingUsers = new Set<string>();
type ReplayResult = { serverEntityId?: string; task?: Task; routine?: Routine };

async function responseError(response: Response, fallback: string) {
  const text = await response.text().catch(() => '');
  return new Error(text || fallback);
}

async function replayTaskCreate(
  item: TaskCreateOutboxItem,
  getToken: (opts?: { skipCache?: boolean }) => Promise<string | null>,
): Promise<ReplayResult> {
  const response = await apiFetchWithAuth('/api/tasks', getToken, {
    method: 'POST',
    body: JSON.stringify(item.payload.input),
  });
  if (!response.ok) {
    throw await responseError(response, `Task create outbox replay failed: ${response.status}`);
  }
  const task = await response.json() as Task;
  return { serverEntityId: task.id, task };
}

async function replayTaskUpdate(
  item: TaskUpdateOutboxItem,
  getToken: (opts?: { skipCache?: boolean }) => Promise<string | null>,
): Promise<ReplayResult> {
  const response = await apiFetchWithAuth(`/api/tasks/${item.entityId}`, getToken, {
    method: 'PATCH',
    body: JSON.stringify(item.payload.patch),
  });
  if (!response.ok) {
    throw await responseError(response, `Task update outbox replay failed: ${response.status}`);
  }
  const task = await response.json() as Task;
  return { serverEntityId: task.id, task };
}

async function replayRoutineCreate(
  item: RoutineCreateOutboxItem,
  getToken: (opts?: { skipCache?: boolean }) => Promise<string | null>,
): Promise<ReplayResult> {
  const response = await apiFetchWithAuth('/api/routines', getToken, {
    method: 'POST',
    body: JSON.stringify(item.payload.input),
  });
  if (!response.ok) {
    throw await responseError(response, `Routine create outbox replay failed: ${response.status}`);
  }
  const result = await response.json() as RoutineListResponse;
  const routine = result.items[0];
  if (!routine) throw new Error('Routine create outbox replay returned no routine.');
  return { serverEntityId: routine.id, routine };
}

async function replayRoutineUpdate(
  item: RoutineUpdateOutboxItem,
  getToken: (opts?: { skipCache?: boolean }) => Promise<string | null>,
): Promise<ReplayResult> {
  const response = await apiFetchWithAuth(`/api/routines/${item.entityId}`, getToken, {
    method: 'PATCH',
    body: JSON.stringify(item.payload.patch),
  });
  if (!response.ok) {
    throw await responseError(response, `Routine update outbox replay failed: ${response.status}`);
  }
  const result = await response.json() as RoutineListResponse;
  const routine = result.items[0];
  if (!routine) throw new Error('Routine update outbox replay returned no routine.');
  return { serverEntityId: routine.id, routine };
}

async function replayTaskRoutineOutboxItem(
  item: TaskRoutineWriteOutboxItem,
  getToken: (opts?: { skipCache?: boolean }) => Promise<string | null>,
): Promise<ReplayResult> {
  if (item.kind === 'task_create') return replayTaskCreate(item, getToken);
  if (item.kind === 'task_update') return replayTaskUpdate(item, getToken);
  if (item.kind === 'routine_create') return replayRoutineCreate(item, getToken);
  return replayRoutineUpdate(item, getToken);
}

function buildServerIdMap(items: TaskRoutineWriteOutboxItem[] | null | undefined) {
  const map = new Map<string, string>();
  for (const item of items || []) {
    if ((item.kind === 'task_create' || item.kind === 'routine_create') && item.serverEntityId) {
      map.set(item.entityId, item.serverEntityId);
      map.set(item.payload.optimisticRecord.id, item.serverEntityId);
    }
  }
  return map;
}

async function persistReplayResult(userId: string, item: TaskRoutineWriteOutboxItem, result: ReplayResult) {
  if (result.task) await putLocalVaultTask(userId, result.task).catch(() => null);
  if (result.routine) await putLocalVaultRoutine(userId, result.routine).catch(() => null);
  if (!result.serverEntityId || !item.entityId.startsWith('local-')) return;
  if (item.kind === 'task_create') await tombstoneLocalVaultTask(userId, item.entityId).catch(() => null);
  if (item.kind === 'routine_create') await tombstoneLocalVaultRoutine(userId, item.entityId).catch(() => null);
}

export function useTaskRoutineOutboxSync() {
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
        const items = await readLocalVaultTaskRoutineWriteOutboxItems(userId);
        const serverIdByLocalId = buildServerIdMap(items);
        for (const item of items || []) {
          if (cancelled) continue;
          const replayItem = rewriteTaskRoutineOutboxItemEntityId(item, serverIdByLocalId.get(item.entityId));
          if (replayItem !== item) await putLocalVaultTaskRoutineWriteOutboxItem(userId, replayItem);
          if (!shouldReplayTaskRoutineOutboxItem(replayItem)) continue;
          try {
            const result = await replayTaskRoutineOutboxItem(replayItem, getToken);
            await persistReplayResult(userId, replayItem, result);
            if (result.serverEntityId) serverIdByLocalId.set(replayItem.entityId, result.serverEntityId);
            await putLocalVaultTaskRoutineWriteOutboxItem(
              userId,
              markTaskRoutineOutboxItemSynced(replayItem, Date.now(), result.serverEntityId),
            );
            syncedAny = true;
          } catch (error) {
            await putLocalVaultTaskRoutineWriteOutboxItem(
              userId,
              markTaskRoutineOutboxItemFailed(replayItem, error instanceof Error ? error.message : String(error)),
            ).catch(() => null);
          }
        }
      } finally {
        syncingUsers.delete(userId);
      }

      if (!cancelled && syncedAny) {
        markReadConsistencyRequired(userId);
        await queryClient.invalidateQueries({ queryKey: ['tasks', userId] });
        await queryClient.invalidateQueries({ queryKey: ['routines', userId] });
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
