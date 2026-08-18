import { useCallback, useState } from 'react';
import { useAuth, useUser } from '@clerk/nextjs';
import { useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { dashboardQueryKeys } from '@/lib/dashboard/query-keys';
import { forgetEntitySummary } from '@/lib/entities/resolve';
import { syncEntityMentions } from '@/lib/entities/sync-mentions';
import type { WeekScheduledItem, WeekScheduledItemUpdate, WeekSelectionPayload } from './calendar-week-view';
import type { TaskComposerState } from './task-composer-modal';

export function useCalendarTaskComposer(scheduledBlocksByDay: Map<string, WeekScheduledItem[]>) {
  const { getToken } = useAuth();
  const { user } = useUser();
  const queryClient = useQueryClient();
  const [taskComposer, setTaskComposer] = useState<TaskComposerState | null>(null);
  const [isSavingTaskComposer, setIsSavingTaskComposer] = useState(false);
  const [taskComposerError, setTaskComposerError] = useState<string | null>(null);

  const openTaskComposer = useCallback((selection: WeekSelectionPayload) => {
    setTaskComposerError(null);
    setTaskComposer({
      id: null,
      dayKey: selection.dayKey,
      startMinutes: selection.startMinutes,
      endMinutes: selection.endMinutes,
      title: '',
      notes: '',
      taskId: null,
    });
  }, []);

  const handleScheduledItemClick = useCallback((item: WeekScheduledItem) => {
    setTaskComposerError(null);
    setTaskComposer({
      id: item.id,
      taskId: item.taskId ?? null,
      dayKey: item.day,
      startMinutes: item.startMinutes,
      endMinutes: item.endMinutes,
      title: item.title,
      notes: item.notes ?? '',
    });
  }, []);
  const openMonthDayBlockEditor = useCallback(
    (day: Date) => {
      const dayKey = format(day, 'yyyy-MM-dd');
      const dayBlocks = scheduledBlocksByDay.get(dayKey) ?? [];

      let startMinutes = 9 * 60;
      let endMinutes = 10 * 60;

      if (dayBlocks.length > 0) {
        const latestEnd = dayBlocks.reduce(
          (latest, block) => Math.max(latest, block.endMinutes),
          0
        );
        const roundedStart = Math.ceil(latestEnd / 15) * 15;
        startMinutes = Math.max(0, Math.min(roundedStart, (24 * 60) - 30));
        endMinutes = Math.min(startMinutes + 60, 24 * 60);
        if (endMinutes <= startMinutes) {
          startMinutes = Math.max(0, (24 * 60) - 60);
          endMinutes = 24 * 60;
        }
      }

      setTaskComposerError(null);
      setTaskComposer({
        id: null,
        taskId: null,
        dayKey,
        startMinutes,
        endMinutes,
        title: '',
        notes: '',
      });
    },
    [scheduledBlocksByDay]
  );

  const invalidateTaskSurfaces = useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: ['calendar-scheduled-blocks', user?.id],
    });
    await queryClient.invalidateQueries({
      queryKey: dashboardQueryKeys.calendarReadModel.byUser(user?.id ?? 'anonymous'),
    });
    await queryClient.invalidateQueries({ queryKey: ['tasks', user?.id] });
  }, [queryClient, user?.id]);

  const handleScheduledItemUpdate = useCallback(
    async (item: WeekScheduledItem, update: WeekScheduledItemUpdate) => {
      const hasChanged =
        item.day !== update.day ||
        item.startMinutes !== update.startMinutes ||
        item.endMinutes !== update.endMinutes;

      if (!hasChanged) return;

      queryClient.setQueriesData<WeekScheduledItem[]>(
        { queryKey: ['calendar-scheduled-blocks', user?.id] },
        (previous) => {
          if (!previous) return previous;
          return previous.map((block) =>
            block.id === item.id
              ? {
                  ...block,
                  day: update.day,
                  startMinutes: update.startMinutes,
                  endMinutes: update.endMinutes,
                }
              : block
          );
        }
      );

      try {
        const token = await getToken();
        if (!token) throw new Error('Authentication token missing');

        const response = await fetch(
          `/api/calendar/scheduled-blocks/${item.id}`,
          {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              day: update.day,
              start_minutes: update.startMinutes,
              end_minutes: update.endMinutes,
            }),
          }
        );

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const detail = typeof errorData?.detail === 'string'
            ? errorData.detail
            : 'Failed to update task';
          throw new Error(detail);
        }

        setTaskComposer((prev) => {
          if (!prev || prev.id !== item.id) return prev;
          return {
            ...prev,
            dayKey: update.day,
            startMinutes: update.startMinutes,
            endMinutes: update.endMinutes,
          };
        });

        await invalidateTaskSurfaces();
        if (item.taskId) forgetEntitySummary({ type: 'task', id: item.taskId });
      } catch (error) {
        setTaskComposerError(error instanceof Error ? error.message : 'Failed to update task');
        await invalidateTaskSurfaces();
      }
    },
    [getToken, invalidateTaskSurfaces, queryClient, user?.id]
  );

  const closeTaskComposer = useCallback(() => {
    setTaskComposerError(null);
    setTaskComposer(null);
  }, []);

  const saveTaskComposer = useCallback(async () => {
    if (!taskComposer) return false;

    const normalizedTitle = taskComposer.title.trim() || 'Untitled task';
    const payload: Record<string, unknown> = {
      title: normalizedTitle,
      notes: taskComposer.notes.trim() || null,
      day: taskComposer.dayKey,
      start_minutes: Math.max(0, Math.min(taskComposer.startMinutes, 24 * 60)),
      end_minutes: Math.max(taskComposer.startMinutes + 30, Math.min(taskComposer.endMinutes, 24 * 60)),
    };
    if (!taskComposer.id) {
      payload.client_event_id = crypto.randomUUID();
    }

    setIsSavingTaskComposer(true);
    setTaskComposerError(null);

    try {
      const token = await getToken();
      if (!token) throw new Error('Authentication token missing');

      const isEditing = Boolean(taskComposer.id);
      const endpoint = isEditing
        ? `/api/calendar/scheduled-blocks/${taskComposer.id}`
        : '/api/calendar/scheduled-blocks';

      const response = await fetch(endpoint, {
        method: isEditing ? 'PUT' : 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const detail = typeof errorData?.detail === 'string'
          ? errorData.detail
          : 'Failed to save task';
        throw new Error(detail);
      }

      await invalidateTaskSurfaces();
      const saved = await response.json().catch(() => null) as { id?: string; task_id?: string | null } | null;
      const sourceId = saved?.id || taskComposer.id;
      const taskId = saved?.task_id || taskComposer.taskId;
      const notes = typeof payload.notes === 'string' ? payload.notes : null;
      if (sourceId) {
        void syncEntityMentions({
          source: { type: 'calendar_block', id: sourceId },
          text: notes,
          getToken,
          userId: user?.id,
        });
      }
      if (taskId) {
        forgetEntitySummary({ type: 'task', id: taskId });
        void syncEntityMentions({
          source: { type: 'task', id: taskId },
          text: notes,
          getToken,
          userId: user?.id,
        });
      }
      setTaskComposer(null);
    } catch (error) {
      setTaskComposerError(error instanceof Error ? error.message : 'Failed to save task');
      return false;
    } finally {
      setIsSavingTaskComposer(false);
    }
    return true;
  }, [getToken, invalidateTaskSurfaces, taskComposer, user?.id]);

  const deleteTaskComposer = useCallback(async () => {
    if (!taskComposer?.id) return false;

    setIsSavingTaskComposer(true);
    setTaskComposerError(null);

    try {
      const token = await getToken();
      if (!token) throw new Error('Authentication token missing');

      const response = await fetch(
        `/api/calendar/scheduled-blocks/${taskComposer.id}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const detail = typeof errorData?.detail === 'string'
          ? errorData.detail
          : 'Failed to delete task';
        throw new Error(detail);
      }

      if (taskComposer.taskId) forgetEntitySummary({ type: 'task', id: taskComposer.taskId });
      await invalidateTaskSurfaces();
      setTaskComposer(null);
    } catch (error) {
      setTaskComposerError(error instanceof Error ? error.message : 'Failed to delete task');
      return false;
    } finally {
      setIsSavingTaskComposer(false);
    }
    return true;
  }, [getToken, invalidateTaskSurfaces, taskComposer, user?.id]);

  return {
    taskComposer,
    setTaskComposer,
    isSavingTaskComposer,
    taskComposerError,
    setTaskComposerError,
    openTaskComposer,
    handleScheduledItemClick,
    openMonthDayBlockEditor,
    handleScheduledItemUpdate,
    closeTaskComposer,
    saveTaskComposer,
    deleteTaskComposer,
  };
}
