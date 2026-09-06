'use client';

import { useEffect } from 'react';
import { useAuth, useUser } from '@clerk/nextjs';
import { useQueryClient } from '@tanstack/react-query';

import { apiOperationWithAuth } from '@/lib/api/client';
import { BackendClientError } from '@/lib/api/generated/backend-client';
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
type AuthGetter = (opts?: { skipCache?: boolean }) => Promise<string | null>;

function replayError(error: unknown, fallback: string): Error {
  if (error instanceof BackendClientError) {
    return new Error(error.responseBody || fallback);
  }
  return error instanceof Error ? error : new Error(fallback);
}

async function replayTaskCreate(
  item: TaskCreateOutboxItem,
  getToken: AuthGetter,
): Promise<ReplayResult> {
  try {
    const task = await apiOperationWithAuth(
      'create_task_api_tasks_post',
      getToken,
      { body: item.payload.input },
    ) as Task;
    return { serverEntityId: task.id, task };
  } catch (error) {
    throw replayError(error, 'Task create outbox replay failed');
  }
}

async function replayTaskUpdate(
  item: TaskUpdateOutboxItem,
  getToken: AuthGetter,
): Promise<ReplayResult> {
  try {
    const task = await apiOperationWithAuth(
      'update_task_api_tasks__task_id__patch',
      getToken,
      {
        pathParams: { task_id: item.entityId },
        body: item.payload.patch,
      },
    ) as Task;
    return { serverEntityId: task.id, task };
  } catch (error) {
    throw replayError(error, 'Task update outbox replay failed');
  }
}

async function replayRoutineCreate(
  item: RoutineCreateOutboxItem,
  getToken: AuthGetter,
): Promise<ReplayResult> {
  try {
    const result = await apiOperationWithAuth(
      'create_routine_api_routines_post',
      getToken,
      { body: item.payload.input },
    ) as RoutineListResponse;
    const routine = result.items[0];
    if (!routine) throw new Error('Routine create outbox replay returned no routine.');
    return { serverEntityId: routine.id, routine };
  } catch (error) {
    throw replayError(error, 'Routine create outbox replay failed');
  }
}

async function replayRoutineUpdate(
  item: RoutineUpdateOutboxItem,
  getToken: AuthGetter,
): Promise<ReplayResult> {
  try {
    const result = await apiOperationWithAuth(
      'update_routine_api_routines__routine_id__patch',
      getToken,
      {
        pathParams: { routine_id: item.entityId },
        body: item.payload.patch,
      },
    ) as RoutineListResponse;
    const routine = result.items[0];
    if (!routine) throw new Error('Routine update outbox replay returned no routine.');
    return { serverEntityId: routine.id, routine };
  } catch (error) {
    throw replayError(error, 'Routine update outbox replay failed');
  }
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
