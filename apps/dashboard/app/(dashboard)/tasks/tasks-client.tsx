'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth, useUser } from '@clerk/nextjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { play as playCuelume } from 'cuelume';
import { syncEntityMentions } from '@/lib/entities/sync-mentions';
import { playInteractionSound } from '@/lib/interaction-sounds';

import { apiOperationWithAuth } from '@/lib/api/client';
import { BackendClientError } from '@/lib/api/generated/backend-client';
import { useTaskRoutineOutboxSync } from '@/hooks/use-task-routine-outbox-sync';
import {
  putLocalVaultTask,
  putLocalVaultTaskRoutineWriteOutboxItem,
  readLocalVaultTaskRoutineWriteOutboxItems,
  readLocalVaultTasks,
} from '@/lib/privacy/task-vault-adapter';
import {
  buildOptimisticTask,
  buildOptimisticTaskUpdate,
  buildTaskCreateOutboxItem,
  buildTaskUpdateOutboxItem,
  mergeTaskSources,
} from '@/lib/tasks/local-first-writes';
import {
  defaultScheduleForView,
  isTaskViewId,
  readStoredTaskDisplayMode,
  writeStoredTaskDisplayMode,
  type TaskDisplayMode,
  type TaskPriorityFilter,
  type TaskSortId,
  type TaskViewId,
} from '@/lib/tasks/task-constants';
import {
  NewTaskComposer,
  type NewTaskComposerSubmit,
} from '@/lib/tasks/new-task-composer';
import { applyTaskOptimisticPatch } from '@/lib/tasks/optimistic';
import { taskCompleteHoldMs } from '@/lib/tasks/task-complete-effect';
import { TaskPageShell, taskContentMaxClass } from '@/lib/tasks/task-ui-shell';
import { TaskDetailSheet } from '@/lib/tasks/task-detail-sheet';
import { rememberEntitySummary, summaryFromTask } from '@/lib/entities/resolve';
import { dashboardQueryKeys } from '@/lib/dashboard/query-keys';
import {
  buildVisibleSeedTasks,
  readDemoGeneratedTasks,
  rememberDismissedSeedTaskId,
  sortTasksForDisplay,
  subscribeDemoRoutineGeneration,
} from '@/lib/tasks/seed-data';
import {
  createInputFromTask,
  dedupeTasksByIdentity,
  isSeedTaskId,
  isTaskInView,
  mergeVisibleTasksForView,
  selectTasksForQuery,
} from '@/lib/tasks/task-view';
import type { Task, TaskUpdateInput } from '@/lib/tasks/types';
import { cn } from '@/lib/utils';

import { CompletedTaskLog } from './completed-task-log';
import { TaskTodoList } from './tasks-todo-list';

import {
  CATEGORY_FILTERS,
  TaskBoard,
  TaskGroupSection,
  TaskListSection,
  TaskTableHeader,
  TasksCategoryPills,
  TasksEmptyState,
  TasksLoadingSkeleton,
  TasksToolbarActions,
  type ListLayoutMode,
} from './tasks-ui';

const TASK_CREATE_TIMEOUT_MS = 10_000;

type CreateTaskResult = {
  task: Task;
  syncStatus: 'remote' | 'local';
};

async function withTaskCreateTimeout<T>(request: Promise<T>): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => reject(new Error('Task creation timed out')), TASK_CREATE_TIMEOUT_MS);
  });

  try {
    return await Promise.race([request, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function findCachedTask(
  queryClient: { getQueriesData: (filters: { queryKey: unknown[] }) => Array<[unknown, unknown]> },
  userId: string | undefined,
  taskId: string,
): Task | undefined {
  const queries = queryClient.getQueriesData({ queryKey: ['tasks', userId] });
  for (const [, data] of queries) {
    if (!Array.isArray(data)) continue;
    const match = (data as Task[]).find((task) => task.id === taskId);
    if (match) return match;
  }
  return undefined;
}

function replaceTaskInList(tasks: Task[], previousId: string, next: Task): Task[] {
  let replaced = false;
  const mapped = tasks.map((task) => {
    if (task.id !== previousId) return task;
    replaced = true;
    return next;
  });
  const withoutDuplicate = mapped.filter((task, index) => (
    mapped.findIndex((item) => item.id === task.id) === index
  ));
  return replaced ? withoutDuplicate : dedupeTasksByIdentity([next, ...tasks]);
}

function applyActiveOverlayPatch(
  tasks: Task[],
  id: string,
  patch: TaskUpdateInput,
  replacement?: Task,
): Task[] {
  const patched = applyTaskOptimisticPatch(tasks, id, patch);
  const next = replacement ? replaceTaskInList(patched, id, replacement) : patched;
  return next.filter((task) => (
    task.status === 'open' || task.status === 'in_progress' || task.status === 'in_review'
  ));
}

const PRIORITY_ORDER: Record<Task['priority'], number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  none: 4,
};

function taskDateValue(task: Task): number {
  const value = task.due_at || task.scheduled_for;
  if (!value) return Number.POSITIVE_INFINITY;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function taskUpdatedValue(task: Task): number {
  const value = task.updated_at || task.created_at;
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function taskCreatedValue(task: Task): number {
  if (!task.created_at) return 0;
  const parsed = new Date(task.created_at).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function filterAndSortTasks(
  tasks: Task[],
  priorityFilter: TaskPriorityFilter,
  sortMode: TaskSortId,
): Task[] {
  const filtered = tasks.filter((task) => priorityFilter === 'all' || task.priority === priorityFilter);

  if (sortMode === 'smart') return filtered;
  return filtered.slice().sort((a, b) => {
    if (sortMode === 'created') return taskCreatedValue(b) - taskCreatedValue(a);
    if (sortMode === 'due') return taskDateValue(a) - taskDateValue(b);
    if (sortMode === 'priority') {
      return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
        || taskDateValue(a) - taskDateValue(b);
    }
    if (sortMode === 'updated') return taskUpdatedValue(b) - taskUpdatedValue(a);
    return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
  });
}

function groupTasksForLayout(tasks: Task[], layoutMode: ListLayoutMode) {
  if (layoutMode === 'priority') {
    const labels: Record<Task['priority'], string> = {
      urgent: 'Urgent',
      high: 'High priority',
      medium: 'Medium priority',
      low: 'Low priority',
      none: 'No priority',
    };
    return (['urgent', 'high', 'medium', 'low', 'none'] as const)
      .map((priority) => [labels[priority], tasks.filter((task) => task.priority === priority)] as const)
      .filter(([, items]) => items.length > 0);
  }

  const groups = new Map<string, Task[]>();
  for (const task of tasks) {
    const key = task.project || task.category || 'Inbox';
    groups.set(key, [...(groups.get(key) || []), task]);
  }
  return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
}

export function TasksClient() {
  const { getToken } = useAuth();
  const { user } = useUser();
  const queryClient = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  useTaskRoutineOutboxSync();

  const viewParam = searchParams.get('view');
  const view: TaskViewId = isTaskViewId(viewParam) ? viewParam : 'today';
  const selectedTaskId = searchParams.get('task');

  const [category, setCategory] = useState<(typeof CATEGORY_FILTERS)[number]>('All');
  const [layoutMode, setLayoutMode] = useState<ListLayoutMode>('list');
  const [displayMode, setDisplayMode] = useState<TaskDisplayMode>('list');
  const [priorityFilter, setPriorityFilter] = useState<TaskPriorityFilter>('all');
  const [sortMode, setSortMode] = useState<TaskSortId>('smart');
  const [composerOpen, setComposerOpen] = useState(false);
  const [menuTaskId, setMenuTaskId] = useState<string | null>(null);
  const [demoGeneratedTasks, setDemoGeneratedTasks] = useState<Task[]>([]);
  const [recentlyCreatedTasks, setRecentlyCreatedTasks] = useState<Task[]>([]);
  const [completingById, setCompletingById] = useState<Record<string, Task>>({});
  const recentlyCreatedTasksRef = useRef(recentlyCreatedTasks);
  const demoGeneratedTasksRef = useRef(demoGeneratedTasks);
  const completingTimersRef = useRef(new Map<string, number>());
  recentlyCreatedTasksRef.current = recentlyCreatedTasks;
  demoGeneratedTasksRef.current = demoGeneratedTasks;

  useEffect(() => {
    setDisplayMode(readStoredTaskDisplayMode());
  }, []);

  useEffect(() => {
    if (searchParams.get('create') !== '1') return;

    const params = new URLSearchParams(searchParams.toString());
    params.delete('create');
    const query = params.toString();
    router.replace(query ? `/tasks?${query}` : '/tasks', { scroll: false });
    queueMicrotask(() => setComposerOpen(true));
  }, [router, searchParams]);

  const queryKey = ['tasks', user?.id, view, category];

  const invalidateTaskSurfaces = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['tasks', user?.id] });
    void queryClient.invalidateQueries({ queryKey: ['calendar-v2', user?.id] });
    void queryClient.invalidateQueries({
      queryKey: dashboardQueryKeys.calendarReadModel.byUser(user?.id ?? 'anonymous'),
    });
  }, [queryClient, user?.id]);

  const invalidateTaskDerivedSurfaces = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['calendar-v2', user?.id] });
    void queryClient.invalidateQueries({
      queryKey: dashboardQueryKeys.calendarReadModel.byUser(user?.id ?? 'anonymous'),
    });
  }, [queryClient, user?.id]);

  const releaseCompletingTask = useCallback((taskId: string) => {
    const timer = completingTimersRef.current.get(taskId);
    if (timer) window.clearTimeout(timer);
    completingTimersRef.current.delete(taskId);
    setCompletingById((current) => {
      if (!(taskId in current)) return current;
      const next = { ...current };
      delete next[taskId];
      return next;
    });
  }, []);

  useEffect(() => () => {
    completingTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    completingTimersRef.current.clear();
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    const refreshDemoTasks = () => setDemoGeneratedTasks(readDemoGeneratedTasks(user.id));
    refreshDemoTasks();
    return subscribeDemoRoutineGeneration(refreshDemoTasks);
  }, [user?.id]);

  const tasksQuery = useQuery({
    queryKey,
    queryFn: async () => {
      let backendItems: Task[] | null = null;
      try {
        const response = await apiOperationWithAuth(
          'get_tasks_api_tasks_get',
          getToken,
          { query: { view, limit: 300, category: category === 'All' ? null : category } },
          user?.id,
        );
        backendItems = (response.items ?? []) as Task[];
      } catch (error) {
        console.warn('[Tasks] Backend task read failed; using local vault fallback', error);
      }

      const [vaultItems, outboxItems] = user?.id
        ? await Promise.all([
            readLocalVaultTasks(user.id),
            readLocalVaultTaskRoutineWriteOutboxItems(user.id),
          ])
        : [null, null] as const;
      const merged = mergeTaskSources(backendItems, vaultItems, outboxItems);
      return sortTasksForDisplay(selectTasksForQuery({
        stored: merged,
        seeds: buildVisibleSeedTasks(user?.id || 'visual-seed'),
        view,
        category,
      }));
    },
    enabled: Boolean(user?.id),
    staleTime: 15_000,
  });

  const createTaskMutation = useMutation({
    mutationFn: async (input: NewTaskComposerSubmit) => {
      const { createMore: _createMore, ...payload } = input;
      try {
        const task = await withTaskCreateTimeout(
          apiOperationWithAuth(
            'create_task_api_tasks_post',
            getToken,
            { body: payload },
            user?.id,
          ) as Promise<Task>,
        );
        return { task, syncStatus: 'remote' } satisfies CreateTaskResult;
      } catch (error) {
        if (!user?.id) throw error;
        const optimistic = buildOptimisticTask(payload, user.id);
        try {
          await putLocalVaultTask(user.id, optimistic);
          await putLocalVaultTaskRoutineWriteOutboxItem(
            user.id,
            buildTaskCreateOutboxItem(user.id, payload, optimistic),
          );
          toast.message('Task saved locally. It will sync when the backend is available.');
        } catch (persistenceError) {
          console.error('[Tasks] Could not persist the optimistic task locally', persistenceError);
          toast.warning('Task added for this session, but local sync is temporarily unavailable.');
        }
        return { task: optimistic, syncStatus: 'local' } satisfies CreateTaskResult;
      }
    },
    onSuccess: ({ task, syncStatus }, variables) => {
      playInteractionSound('taskCreated');
      invalidateTaskDerivedSurfaces();
      if (user?.id) void putLocalVaultTask(user.id, task).catch(() => undefined);
      rememberEntitySummary(summaryFromTask(task));
      if (syncStatus === 'remote') {
        void syncEntityMentions({
          source: { type: 'task', id: task.id },
          text: task.notes,
          getToken,
          userId: user?.id,
        });
      }
      if (!variables.createMore) setComposerOpen(false);
    },
    onError: (error) => {
      playCuelume('error');
      toast.error(error instanceof Error ? error.message : 'Failed to create task.');
    },
  });

  const updateTaskMutation = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: TaskUpdateInput }) => {
      const current = findCachedTask(queryClient, user?.id, id);
      if (isSeedTaskId(id)) {
        if (!current) throw new Error('Task not found');
        const input = createInputFromTask(current, patch);
        try {
          const created = await apiOperationWithAuth(
            'create_task_api_tasks_post',
            getToken,
            { body: input },
            user?.id,
          ) as Task;
          if (user?.id) {
            rememberDismissedSeedTaskId(user.id, id);
            await putLocalVaultTask(user.id, created).catch(() => undefined);
          }
          return created;
        } catch (createError) {
          if (!user?.id) throw createError;
          const optimistic = buildOptimisticTask(input, user.id);
          await putLocalVaultTask(user.id, optimistic);
          await putLocalVaultTaskRoutineWriteOutboxItem(
            user.id,
            buildTaskCreateOutboxItem(
              user.id,
              { ...input, client_event_id: optimistic.client_event_id },
              optimistic,
            ),
          );
          rememberDismissedSeedTaskId(user.id, id);
          toast.message('Task update saved locally. It will sync when the backend is available.');
          return optimistic;
        }
      }

      try {
        return await apiOperationWithAuth(
          'update_task_api_tasks__task_id__patch',
          getToken,
          { pathParams: { task_id: id }, body: patch },
          user?.id,
        ) as Task;
      } catch (error) {
        if (!user?.id) throw error;
        if (!current) throw error;
        if (error instanceof BackendClientError && error.status === 404) {
          const input = createInputFromTask(current, patch);
          try {
            const created = await apiOperationWithAuth(
              'create_task_api_tasks_post',
              getToken,
              { body: input },
              user.id,
            ) as Task;
            rememberDismissedSeedTaskId(user.id, id);
            await putLocalVaultTask(user.id, created).catch(() => undefined);
            return created;
          } catch (createError) {
            const optimistic = buildOptimisticTask(input, user.id);
            await putLocalVaultTask(user.id, optimistic);
            await putLocalVaultTaskRoutineWriteOutboxItem(
              user.id,
              buildTaskCreateOutboxItem(
                user.id,
                { ...input, client_event_id: optimistic.client_event_id },
                optimistic,
              ),
            );
            rememberDismissedSeedTaskId(user.id, id);
            toast.message('Task update saved locally. It will sync when the backend is available.');
            return optimistic;
          }
        }
        const optimistic = buildOptimisticTaskUpdate(current, patch, user.id);
        await putLocalVaultTask(user.id, optimistic);
        await putLocalVaultTaskRoutineWriteOutboxItem(
          user.id,
          buildTaskUpdateOutboxItem(user.id, patch, optimistic),
        );
        toast.message('Task update saved locally. It will sync when the backend is available.');
        return optimistic;
      }
    },
    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({ queryKey: ['tasks', user?.id] });
      const completedKey = ['tasks', user?.id, 'completed', 'All'] as const;
      const previousQueries = queryClient.getQueriesData<Task[]>({ queryKey: ['tasks', user?.id] });
      const previousCompleted = queryClient.getQueryData<Task[]>(completedKey);
      const previousRecent = recentlyCreatedTasksRef.current;
      const previousDemo = demoGeneratedTasksRef.current;
      const existing = findCachedTask(queryClient, user?.id, id);
      queryClient.setQueriesData<Task[]>({ queryKey: ['tasks', user?.id] }, (current) => {
        if (!Array.isArray(current)) return current;
        return applyTaskOptimisticPatch(current, id, patch);
      });
      setRecentlyCreatedTasks((current) => applyActiveOverlayPatch(current, id, patch));
      setDemoGeneratedTasks((current) => applyActiveOverlayPatch(current, id, patch));
      if (existing && patch.status === 'completed') {
        const completedTask = applyTaskOptimisticPatch([existing], id, patch)[0];
        queryClient.setQueryData<Task[]>(completedKey, (current = []) => (
          dedupeTasksByIdentity([completedTask, ...current.filter((task) => task.id !== id)])
        ));
      } else if (existing && patch.status && patch.status !== 'completed') {
        queryClient.setQueryData<Task[]>(completedKey, (current) => (
          (current || []).filter((task) => task.id !== id)
        ));
      }
      return { previousQueries, previousCompleted, completedKey, previousRecent, previousDemo };
    },
    onError: (error, variables, context) => {
      for (const [key, data] of context?.previousQueries || []) {
        queryClient.setQueryData(key, data);
      }
      if (context?.completedKey) {
        queryClient.setQueryData(context.completedKey, context.previousCompleted);
      }
      if (context) {
        setRecentlyCreatedTasks(context.previousRecent);
        setDemoGeneratedTasks(context.previousDemo);
      }
      if (variables.patch.status === 'completed') releaseCompletingTask(variables.id);
      toast.error(error instanceof Error ? error.message : 'Failed to update task.');
    },
    onSuccess: (task, variables) => {
      if (task && task.id !== variables.id) {
        queryClient.setQueriesData<Task[]>({ queryKey: ['tasks', user?.id] }, (current) => {
          if (!Array.isArray(current)) return current;
          return replaceTaskInList(current, variables.id, task);
        });
      }
      setRecentlyCreatedTasks((current) => (
        applyActiveOverlayPatch(current, variables.id, variables.patch, task)
      ));
      setDemoGeneratedTasks((current) => (
        applyActiveOverlayPatch(current, variables.id, variables.patch, task && current.some((item) => item.id === variables.id) ? task : undefined)
      ));
      invalidateTaskSurfaces();
      if (user?.id) void putLocalVaultTask(user.id, task).catch(() => undefined);
      if (task) rememberEntitySummary(summaryFromTask(task));
      if (task && 'notes' in variables.patch) {
        void syncEntityMentions({
          source: { type: 'task', id: task.id },
          text: task.notes,
          getToken,
          userId: user?.id,
        });
      }
    },
  });

  const tasksForView = useMemo(() => {
    return sortTasksForDisplay(mergeVisibleTasksForView({
      stored: tasksQuery.data || [],
      recent: recentlyCreatedTasks,
      demo: demoGeneratedTasks,
      held: Object.values(completingById),
      view,
      category,
    }));
  }, [category, completingById, demoGeneratedTasks, recentlyCreatedTasks, tasksQuery.data, view]);
  const tasks = useMemo(
    () => filterAndSortTasks(tasksForView, priorityFilter, sortMode),
    [priorityFilter, sortMode, tasksForView],
  );
  const groups = useMemo(
    () => groupTasksForLayout(tasks, layoutMode),
    [layoutMode, tasks],
  );
  const boardGroups = useMemo(
    () => groupTasksForLayout(tasks, layoutMode === 'list' ? 'priority' : layoutMode),
    [layoutMode, tasks],
  );
  const selectedTask = useMemo(
    () => (selectedTaskId ? tasks.find((task) => task.id === selectedTaskId) || null : null),
    [selectedTaskId, tasks],
  );

  const selectedTaskQuery = useQuery({
    queryKey: ['tasks', user?.id, 'detail', selectedTaskId],
    enabled: Boolean(user?.id && selectedTaskId && !selectedTask),
    queryFn: async () => {
      const response = await apiOperationWithAuth(
        'get_tasks_api_tasks_get',
        getToken,
        { query: { limit: 500 } },
        user?.id,
      );
      return ((response.items ?? []) as Task[]).find((task) => task.id === selectedTaskId) ?? null;
    },
  });
  const sheetTask = selectedTask || selectedTaskQuery.data || null;

  useEffect(() => {
    for (const task of tasks) rememberEntitySummary(summaryFromTask(task));
    if (sheetTask) rememberEntitySummary(summaryFromTask(sheetTask));
  }, [sheetTask, tasks]);

  const closeTask = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('task');
    const query = params.toString();
    router.replace(query ? `/tasks?${query}` : '/tasks', { scroll: false });
  };

  const openTask = (task: Task) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('task', task.id);
    const query = params.toString();
    router.replace(query ? `/tasks?${query}` : '/tasks', { scroll: false });
  };

  const selectView = (nextView: TaskViewId) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('view', nextView);
    params.delete('task');
    router.replace(`/tasks?${params.toString()}`, { scroll: false });
    setMenuTaskId(null);
  };

  const clearTaskFilters = () => {
    setPriorityFilter('all');
    setCategory('All');
    if (view !== 'today') selectView('today');
  };

  const selectDisplayMode = (nextMode: TaskDisplayMode) => {
    setDisplayMode(nextMode);
    writeStoredTaskDisplayMode(nextMode);
    if (nextMode === 'board' && layoutMode === 'list') setLayoutMode('priority');
  };

  const handleComposerSubmit = (values: NewTaskComposerSubmit) => {
    if (!user?.id) {
      createTaskMutation.mutate(values);
      return;
    }

    const { createMore: _createMore, ...payload } = values;
    const optimisticTask = buildOptimisticTask(payload, user.id);
    const previousTasks = queryClient.getQueryData<Task[]>(queryKey);
    const belongsInCurrentView = isTaskInView(optimisticTask, view)
      && (category === 'All' || optimisticTask.category === category);

    if (belongsInCurrentView) {
      queryClient.setQueryData<Task[]>(queryKey, (current = []) => (
        dedupeTasksByIdentity([optimisticTask, ...current])
      ));
    }
    setRecentlyCreatedTasks((current) => dedupeTasksByIdentity([optimisticTask, ...current]));
    if (!values.createMore) setComposerOpen(false);

    createTaskMutation.mutate(values, {
      onSuccess: ({ task: createdTask }) => {
        setRecentlyCreatedTasks((current) => {
          const withoutOptimistic = current.filter((task) => (
            task.id !== optimisticTask.id
            && task.client_event_id !== optimisticTask.client_event_id
          ));
          return dedupeTasksByIdentity([createdTask, ...withoutOptimistic]);
        });
        if (belongsInCurrentView) queryClient.setQueryData<Task[]>(queryKey, (current = []) => {
          const withoutOptimistic = current.filter((task) => (
            task.id !== optimisticTask.id
            && task.client_event_id !== optimisticTask.client_event_id
          ));
          return dedupeTasksByIdentity([createdTask, ...withoutOptimistic]);
        });
      },
      onError: () => {
        if (belongsInCurrentView) queryClient.setQueryData(queryKey, previousTasks);
        setRecentlyCreatedTasks((current) => current.filter((task) => task.id !== optimisticTask.id));
        if (!values.createMore) setComposerOpen(true);
      },
    });
  };

  const completingIds = useMemo(() => new Set(Object.keys(completingById)), [completingById]);

  const hasTasks = tasks.length > 0;

  const completeTask = (task: Task) => {
    if (task.status === 'completed') {
      updateTaskMutation.mutate({ id: task.id, patch: { status: 'open' } });
      return;
    }
    if (completingTimersRef.current.has(task.id) || completingById[task.id]) return;

    playInteractionSound('taskCompleted');
    setCompletingById((current) => ({ ...current, [task.id]: task }));
    updateTaskMutation.mutate({ id: task.id, patch: { status: 'completed' } });
    const timer = window.setTimeout(() => {
      releaseCompletingTask(task.id);
    }, taskCompleteHoldMs());
    completingTimersRef.current.set(task.id, timer);
  };

  const rowHandlers = {
    menuTaskId,
    onMenuTaskChange: setMenuTaskId,
    onComplete: completeTask,
    onUpdate: (id: string, patch: TaskUpdateInput) => {
      if (patch.status === 'completed') {
        const task = tasks.find((item) => item.id === id) || completingById[id];
        if (task && task.status !== 'completed') {
          completeTask(task);
          return;
        }
      }
      updateTaskMutation.mutate({ id, patch });
    },
    onOpen: openTask,
    completingIds,
  };

  return (
    <TaskPageShell>
      <TasksToolbarActions
        onNewTask={() => setComposerOpen(true)}
      />

      <div className="min-h-0 flex-1 overflow-auto pb-16 pt-3">
        <div className={cn(taskContentMaxClass, 'px-8 lg:px-10')}>
          <TasksCategoryPills
            category={category}
            onCategoryChange={setCategory}
            displayMode={displayMode}
            onDisplayModeChange={selectDisplayMode}
            layoutMode={layoutMode}
            onLayoutModeChange={setLayoutMode}
            view={view}
            onViewChange={selectView}
            priorityFilter={priorityFilter}
            onPriorityFilterChange={setPriorityFilter}
            sortMode={sortMode}
            onSortModeChange={setSortMode}
            onClearFilters={clearTaskFilters}
          />
          {tasksQuery.isLoading ? (
            <TasksLoadingSkeleton />
          ) : view === 'completed' ? (
            hasTasks ? (
              <CompletedTaskLog
                tasks={tasks}
                onComplete={rowHandlers.onComplete}
                onOpen={rowHandlers.onOpen}
              />
            ) : (
              <TasksEmptyState
                onNewTask={() => setComposerOpen(true)}
                onClearFilters={clearTaskFilters}
                filtered={category !== 'All' || priorityFilter !== 'all'}
                title="No completed tasks"
                description="Checked-off tasks will show up here, grouped by the month you finished them."
              />
            )
          ) : hasTasks ? (
            displayMode === 'board' ? (
              <TaskBoard groups={boardGroups} {...rowHandlers} />
            ) : displayMode === 'todo' ? (
              <TaskTodoList tasks={tasks} {...rowHandlers} />
            ) : (
              <>
                <TaskTableHeader />
                {layoutMode === 'list' ? (
                  <TaskListSection tasks={tasks} {...rowHandlers} />
                ) : (
                  groups.map(([group, groupTasksValue]) => (
                    <TaskGroupSection
                      key={group}
                      group={group}
                      tasks={[...groupTasksValue]}
                      {...rowHandlers}
                    />
                  ))
                )}
              </>
            )
          ) : (
            <TasksEmptyState
              onNewTask={() => setComposerOpen(true)}
              onClearFilters={clearTaskFilters}
              filtered={tasksForView.length > 0 || view !== 'today' || category !== 'All' || priorityFilter !== 'all'}
            />
          )}
        </div>
      </div>

      <NewTaskComposer
        open={composerOpen}
        onClose={() => setComposerOpen(false)}
        onSubmit={handleComposerSubmit}
        pending={createTaskMutation.isPending}
        defaultSchedule={defaultScheduleForView(view)}
      />
      <TaskDetailSheet
        taskId={selectedTaskId}
        task={sheetTask}
        onClose={closeTask}
        onUpdate={(id, patch) => updateTaskMutation.mutate({ id, patch })}
      />
    </TaskPageShell>
  );
}
