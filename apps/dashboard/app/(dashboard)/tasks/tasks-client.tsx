'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth, useUser } from '@clerk/nextjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { play as playCuelume } from 'cuelume';
import { syncEntityMentions } from '@/lib/entities/sync-mentions';
import { playInteractionSound } from '@/lib/interaction-sounds';

import { apiOperationWithAuth } from '@/lib/api/client';
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
  mergeTasksWithOutbox,
} from '@/lib/tasks/local-first-writes';
import {
  defaultScheduleForView,
  isTaskViewId,
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
import { TaskPageShell, taskContentMaxClass } from '@/lib/tasks/task-ui-shell';
import { TaskDetailSheet } from '@/lib/tasks/task-detail-sheet';
import { rememberEntitySummary, summaryFromTask } from '@/lib/entities/resolve';
import { dashboardQueryKeys } from '@/lib/dashboard/query-keys';
import {
  buildSeedTasks,
  readDemoGeneratedTasks,
  sortTasksForDisplay,
  subscribeDemoRoutineGeneration,
} from '@/lib/tasks/seed-data';
import type { Task, TaskUpdateInput } from '@/lib/tasks/types';
import { cn } from '@/lib/utils';

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

function isTaskInView(task: Task, view: TaskViewId): boolean {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const tomorrowStart = todayStart + 24 * 60 * 60 * 1000;
  const scheduled = task.scheduled_for ? new Date(task.scheduled_for).getTime() : null;
  const due = task.due_at ? new Date(task.due_at).getTime() : null;
  if (view === 'completed') return task.status === 'completed';
  if (view === 'skipped') return task.status === 'canceled' || task.status === 'skipped';
  if (view === 'archived') return task.status === 'archived';
  if (!['open', 'in_progress', 'in_review'].includes(task.status)) return false;
  if (view === 'anytime') return !scheduled && !due;
  if (view === 'upcoming') return Boolean((scheduled && scheduled >= tomorrowStart) || (due && due >= tomorrowStart));
  return Boolean((scheduled && scheduled < tomorrowStart) || (due && due < tomorrowStart));
}

function filterTasksForView(tasks: Task[], view: TaskViewId, category: string): Task[] {
  return tasks.filter((task) => isTaskInView(task, view) && (category === 'All' || task.category === category));
}

function dedupeTasksByIdentity(tasks: Task[]): Task[] {
  const ids = new Set<string>();
  const clientEventIds = new Set<string>();
  return tasks.filter((task) => {
    if (ids.has(task.id)) return false;
    if (task.client_event_id && clientEventIds.has(task.client_event_id)) return false;
    ids.add(task.id);
    if (task.client_event_id) clientEventIds.add(task.client_event_id);
    return true;
  });
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
    void queryClient.invalidateQueries({ queryKey: ['calendar-scheduled-blocks', user?.id] });
    void queryClient.invalidateQueries({
      queryKey: dashboardQueryKeys.calendarReadModel.byUser(user?.id ?? 'anonymous'),
    });
  }, [queryClient, user?.id]);

  const invalidateTaskDerivedSurfaces = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['calendar-scheduled-blocks', user?.id] });
    void queryClient.invalidateQueries({
      queryKey: dashboardQueryKeys.calendarReadModel.byUser(user?.id ?? 'anonymous'),
    });
  }, [queryClient, user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    const refreshDemoTasks = () => setDemoGeneratedTasks(readDemoGeneratedTasks(user.id));
    refreshDemoTasks();
    return subscribeDemoRoutineGeneration(refreshDemoTasks);
  }, [user?.id]);

  const tasksQuery = useQuery({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({ view, limit: '300' });
      if (category !== 'All') params.set('category', category);
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
            backendItems ? Promise.resolve(null) : readLocalVaultTasks(user.id),
            readLocalVaultTaskRoutineWriteOutboxItems(user.id),
          ])
        : [null, null] as const;
      const merged = mergeTasksWithOutbox(backendItems || vaultItems || [], outboxItems);
      const filtered = filterTasksForView(merged, view, category);
      if (filtered.length) return sortTasksForDisplay(filtered);
      return sortTasksForDisplay(filterTasksForView(buildSeedTasks(user?.id || 'visual-seed'), view, category));
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
      try {
        return await apiOperationWithAuth(
          'update_task_api_tasks__task_id__patch',
          getToken,
          { pathParams: { task_id: id }, body: patch },
          user?.id,
        ) as Task;
      } catch (error) {
        if (!user?.id) throw error;
        const current = (queryClient.getQueryData<Task[]>(queryKey) || []).find((task) => task.id === id);
        if (!current) throw error;
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
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<Task[]>(queryKey);
      queryClient.setQueryData<Task[]>(queryKey, (current) =>
        applyTaskOptimisticPatch(current || [], id, patch),
      );
      return { previous };
    },
    onError: (error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
      toast.error(error instanceof Error ? error.message : 'Failed to update task.');
    },
    onSuccess: (task, variables) => {
      if (variables.patch.status === 'completed') playInteractionSound('taskCompleted');
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
    const demoTasks = filterTasksForView(demoGeneratedTasks, view, category);
    const sortedTasks = sortTasksForDisplay(dedupeTasksByIdentity([...(tasksQuery.data || []), ...demoTasks]));
    const recentTasks = filterTasksForView(recentlyCreatedTasks, view, category);
    return dedupeTasksByIdentity([...recentTasks, ...sortedTasks]);
  }, [category, demoGeneratedTasks, recentlyCreatedTasks, tasksQuery.data, view]);
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

  const hasTasks = tasks.length > 0;

  const rowHandlers = {
    menuTaskId,
    onMenuTaskChange: setMenuTaskId,
    onComplete: (task: Task) => updateTaskMutation.mutate({
      id: task.id,
      patch: { status: task.status === 'completed' ? 'open' : 'completed' },
    }),
    onUpdate: (id: string, patch: TaskUpdateInput) => updateTaskMutation.mutate({ id, patch }),
    onOpen: openTask,
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
          ) : hasTasks ? (
            displayMode === 'board' ? (
              <TaskBoard groups={boardGroups} {...rowHandlers} />
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
