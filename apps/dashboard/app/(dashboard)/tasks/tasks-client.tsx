'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useAuth, useUser } from '@clerk/nextjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, CalendarClock, Check, Circle, Folder, Inbox, ListFilter, Plus, RotateCw, SkipForward } from 'lucide-react';
import { toast } from 'sonner';

import { apiJsonWithAuth } from '@/lib/api/client';
import { useTaskRoutineOutboxSync } from '@/hooks/use-task-routine-outbox-sync';
import { cn } from '@/lib/utils';
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
import { applyTaskOptimisticPatch } from '@/lib/tasks/optimistic';
import {
  FilterChip,
  IconButton,
  OptionMenu,
  ReferenceHeader,
  ReferencePage,
  SegmentedTabs,
  quietRowClass,
  priorityBars,
  subtleBorderClass,
} from '@/lib/tasks/reference-task-shell';
import type { Task, TaskCreateInput, TaskListResponse, TaskPriority, TaskUpdateInput } from '@/lib/tasks/types';

const VIEWS = [
  { id: 'today', label: 'Today' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'anytime', label: 'Anytime' },
  { id: 'completed', label: 'Completed' },
  { id: 'skipped', label: 'Skipped' },
  { id: 'archived', label: 'Archived' },
] as const;

const CATEGORY_FILTERS = ['All', 'Health', 'Work', 'Personal', 'Finance', 'Experiments', 'AI'] as const;
const PRIORITIES: TaskPriority[] = ['none', 'low', 'medium', 'high'];
const GROUP_MODES = [
  { id: 'category', label: 'Category' },
  { id: 'source', label: 'Source' },
  { id: 'date', label: 'Date' },
] as const;
type GroupMode = (typeof GROUP_MODES)[number]['id'];
const TASK_CATEGORY_OPTIONS = CATEGORY_FILTERS
  .filter((item) => item !== 'All')
  .map((item) => ({ value: item, label: item }));
const GROUP_MODE_OPTIONS = GROUP_MODES.map((item) => ({ value: item.id, label: `View by ${item.label}` }));
const TASK_PRIORITY_OPTIONS = PRIORITIES.map((priority) => ({ value: priority, label: priority }));

function formatTaskDate(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}

function dateInputValue(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function isTaskInView(task: Task, view: (typeof VIEWS)[number]['id']): boolean {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const tomorrowStart = todayStart + 24 * 60 * 60 * 1000;
  const scheduled = task.scheduled_for ? new Date(task.scheduled_for).getTime() : null;
  const due = task.due_at ? new Date(task.due_at).getTime() : null;
  if (view === 'completed') return task.status === 'completed';
  if (view === 'skipped') return task.status === 'skipped';
  if (view === 'archived') return task.status === 'archived';
  if (task.status !== 'open') return false;
  if (view === 'anytime') return !scheduled && !due;
  if (view === 'upcoming') return Boolean((scheduled && scheduled >= tomorrowStart) || (due && due >= tomorrowStart));
  return Boolean((scheduled && scheduled < tomorrowStart) || (due && due < tomorrowStart));
}

function filterTasksForView(tasks: Task[], view: (typeof VIEWS)[number]['id'], category: string): Task[] {
  return tasks.filter((task) => isTaskInView(task, view) && (category === 'All' || task.category === category));
}

function groupTasks(tasks: Task[], groupMode: GroupMode) {
  const groups = new Map<string, Task[]>();
  for (const task of tasks) {
    const key = groupMode === 'source'
      ? task.source
      : groupMode === 'date'
        ? formatTaskDate(task.scheduled_for || task.due_at) || 'Unscheduled'
        : task.project || task.category || 'Inbox';
    groups.set(key, [...(groups.get(key) || []), task]);
  }
  return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
}

export function TasksClient() {
  const { getToken } = useAuth();
  const { user } = useUser();
  const queryClient = useQueryClient();
  useTaskRoutineOutboxSync();
  const [view, setView] = useState<(typeof VIEWS)[number]['id']>('today');
  const [category, setCategory] = useState<(typeof CATEGORY_FILTERS)[number]>('All');
  const [groupMode, setGroupMode] = useState<GroupMode>('category');
  const [quickTitle, setQuickTitle] = useState('');
  const [quickCategory, setQuickCategory] = useState<(typeof CATEGORY_FILTERS)[number]>('Personal');

  const queryKey = ['tasks', user?.id, view, category];

  const tasksQuery = useQuery({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({ view, limit: '300' });
      if (category !== 'All') params.set('category', category);
      let backendItems: Task[] | null = null;
      try {
        const response = await apiJsonWithAuth<TaskListResponse>(`/api/tasks?${params.toString()}`, getToken, {
          userId: user?.id,
        });
        backendItems = response.items;
      } catch (error) {
        console.warn('[Tasks] Backend task read failed; using local vault fallback', error);
      }

      const [vaultItems, outboxItems] = user?.id
        ? await Promise.all([
            backendItems ? Promise.resolve(null) : readLocalVaultTasks(user.id),
            readLocalVaultTaskRoutineWriteOutboxItems(user.id),
          ])
        : [null, null] as const;
      return filterTasksForView(mergeTasksWithOutbox(backendItems || vaultItems || [], outboxItems), view, category);
    },
    enabled: Boolean(user?.id),
    staleTime: 15_000,
  });

  const generateDueMutation = useMutation({
    mutationFn: () => apiJsonWithAuth('/api/routines/generate-due', getToken, { method: 'POST', userId: user?.id }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tasks', user?.id] });
      void queryClient.invalidateQueries({ queryKey: ['routines', user?.id] });
    },
  });

  useEffect(() => {
    if (!user?.id) return;
    generateDueMutation.mutate();
  }, [user?.id]);

  const createTaskMutation = useMutation({
    mutationFn: async (input: TaskCreateInput) => {
      try {
        return await apiJsonWithAuth<Task>('/api/tasks', getToken, {
          method: 'POST',
          body: JSON.stringify(input),
          userId: user?.id,
        });
      } catch (error) {
        if (!user?.id) throw error;
        const optimistic = buildOptimisticTask(input, user.id);
        await putLocalVaultTask(user.id, optimistic);
        await putLocalVaultTaskRoutineWriteOutboxItem(
          user.id,
          buildTaskCreateOutboxItem(user.id, input, optimistic),
        );
        toast.message('Task saved locally. It will sync when the backend is available.');
        return optimistic;
      }
    },
    onSuccess: (task) => {
      setQuickTitle('');
      void queryClient.invalidateQueries({ queryKey: ['tasks', user?.id] });
      if (user?.id) void putLocalVaultTask(user.id, task).catch(() => undefined);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Failed to create task.'),
  });

  const updateTaskMutation = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: TaskUpdateInput }) => {
      try {
        return await apiJsonWithAuth<Task>(`/api/tasks/${id}`, getToken, {
          method: 'PATCH',
          body: JSON.stringify(patch),
          userId: user?.id,
        });
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
    onSuccess: (task) => {
      void queryClient.invalidateQueries({ queryKey: ['tasks', user?.id] });
      if (user?.id) void putLocalVaultTask(user.id, task).catch(() => undefined);
    },
  });

  const tasks = tasksQuery.data || [];
  const groups = useMemo(() => groupTasks(tasks, groupMode), [tasks, groupMode]);

  const handleQuickAdd = (event: React.FormEvent) => {
    event.preventDefault();
    const title = quickTitle.trim();
    if (!title) return;
    createTaskMutation.mutate({
      title,
      category: quickCategory,
      priority: 'none',
      source: 'manual',
      client_event_id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      scheduled_for: view === 'today' ? new Date().toISOString() : null,
    });
  };

  return (
    <ReferencePage>
      <ReferenceHeader
        className="mx-auto w-full max-w-[980px] px-6 pt-7 lg:px-8"
        title={VIEWS.find((item) => item.id === view)?.label || 'Tasks'}
        eyebrow={<><Inbox className="h-4 w-4" /> Tasks</>}
        actions={(
          <form onSubmit={handleQuickAdd} className={cn('flex h-10 min-w-[360px] max-w-[520px] flex-1 items-center gap-1.5 px-2', quietRowClass)}>
            <input
              value={quickTitle}
              onChange={(event) => setQuickTitle(event.target.value)}
              placeholder="Add a task..."
              className="min-w-0 flex-1 bg-transparent px-1 text-[15px] font-normal text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
            />
            <OptionMenu
              value={quickCategory}
              options={TASK_CATEGORY_OPTIONS}
              onChange={setQuickCategory}
              className="h-8 w-[118px] bg-white/60"
              ariaLabel="Task category"
            />
            <IconButton
              className="h-8 w-8 bg-[rgba(39,37,30,0.045)] text-[var(--text-primary)] disabled:opacity-55"
              disabled={createTaskMutation.isPending}
              aria-label="Add task"
            >
              <Plus className="h-4 w-4" />
            </IconButton>
          </form>
        )}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <SegmentedTabs value={view} options={VIEWS} onChange={setView} />
          <span className="mx-1 hidden h-4 w-px bg-[var(--border-subtle)] md:block" />
          <ListFilter className="h-4 w-4 text-[var(--icon-muted)]" />
          {CATEGORY_FILTERS.map((item) => (
            <FilterChip key={item} active={category === item} onClick={() => setCategory(item)}>
              {item}
            </FilterChip>
          ))}
          <OptionMenu
            value={groupMode}
            options={GROUP_MODE_OPTIONS}
            onChange={setGroupMode}
            className="ml-auto w-[142px] text-[13px]"
            ariaLabel="Group tasks"
          />
          <button
            type="button"
            className="inline-flex h-8 items-center gap-2 rounded-sm bg-[rgba(39,37,30,0.024)] px-2.5 text-[13px] font-normal text-[var(--text-primary)] transition hover:bg-[var(--row-hover)] disabled:opacity-55"
            onClick={() => generateDueMutation.mutate()}
            disabled={generateDueMutation.isPending}
          >
            <RotateCw className={cn('h-4 w-4', generateDueMutation.isPending && 'animate-spin')} />
            Sync routines
          </button>
        </div>
      </ReferenceHeader>

      <div className="min-h-0 flex-1 overflow-auto px-6 py-6 lg:px-8">
        {tasksQuery.isLoading ? (
          <div className="mx-auto max-w-[980px] space-y-2">
            {[0, 1, 2, 3].map((item) => (
              <div key={item} className="h-10 animate-pulse rounded-sm bg-[rgba(39,37,30,0.024)]" />
            ))}
          </div>
        ) : groups.length ? (
          <div className="mx-auto max-w-[980px] space-y-8">
            {groups.map(([group, groupTasksValue]) => (
              <section key={group}>
                <div className={cn('mb-2 flex items-center gap-2 border-b pb-2', subtleBorderClass)}>
                  <span className="flex h-5 w-5 items-center justify-center text-[var(--icon-muted)]">
                    <Folder className="h-3.5 w-3.5" />
                  </span>
                  <h2 className="truncate text-sm font-normal text-[var(--text-primary)]">{group}</h2>
                  <span className="text-[12px] font-normal text-[var(--text-muted)]">{groupTasksValue.length}</span>
                </div>
                <div className="space-y-0.5">
                  {groupTasksValue.map((task) => (
                    <div
                      key={task.id}
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget) return;
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          updateTaskMutation.mutate({
                            id: task.id,
                            patch: { status: task.status === 'completed' ? 'open' : 'completed' },
                          });
                        } else if (event.key.toLowerCase() === 's') {
                          updateTaskMutation.mutate({ id: task.id, patch: { status: 'skipped' } });
                        } else if (event.key.toLowerCase() === 'a') {
                          updateTaskMutation.mutate({ id: task.id, patch: { status: 'archived' } });
                        }
                      }}
                      className="group/row grid min-h-[42px] grid-cols-[28px_22px_minmax(0,1fr)_auto] items-center gap-2 rounded-sm px-2.5 outline-none transition hover:bg-[var(--row-hover)] focus-visible:bg-[var(--row-hover)] focus-visible:ring-1 focus-visible:ring-[rgba(15,23,42,0.18)]"
                    >
                      <button
                        type="button"
                        onClick={() => updateTaskMutation.mutate({
                          id: task.id,
                          patch: { status: task.status === 'completed' ? 'open' : 'completed' },
                        })}
                        className={cn(
                          'flex h-[19px] w-[19px] items-center justify-center rounded-[5px] border transition',
                          task.status === 'completed'
                            ? 'border-[var(--text-primary)] bg-[var(--text-primary)] text-white'
                            : 'border-[rgba(15,23,42,0.22)] bg-white text-transparent hover:border-[var(--text-primary)]',
                        )}
                        aria-label={`Complete ${task.title}`}
                        aria-pressed={task.status === 'completed'}
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                      {priorityBars(task.priority, true)}
                      <div className="min-w-0">
                        <div className={cn('truncate text-[15px] font-normal text-[var(--text-primary)]', task.status === 'completed' && 'text-[var(--text-muted)] line-through')}>
                          {task.title}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[12px] font-normal text-[var(--text-muted)]">
                          <span>{task.source}</span>
                          {task.due_at || task.scheduled_for ? (
                            <span className="inline-flex items-center gap-1 text-[#b15d2b]">
                              <CalendarClock className="h-3.5 w-3.5" />
                              {formatTaskDate(task.scheduled_for || task.due_at)}
                            </span>
                          ) : null}
                          {task.tags.slice(0, 3).map((tag) => <span key={tag}>#{tag}</span>)}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <OptionMenu
                          value={task.priority}
                          options={TASK_PRIORITY_OPTIONS}
                          onChange={(priority) => updateTaskMutation.mutate({
                            id: task.id,
                            patch: { priority },
                          })}
                          className="hidden h-7 w-[84px] bg-transparent px-1.5 text-[12px] text-[var(--text-secondary)] md:inline-flex md:opacity-0 md:group-hover/row:opacity-100 md:focus:opacity-100"
                          contentClassName="min-w-[120px]"
                          aria-label={`Priority for ${task.title}`}
                        />
                        <input
                          type="date"
                          value={dateInputValue(task.scheduled_for || task.due_at)}
                          onChange={(event) => {
                            const next = event.target.value ? new Date(`${event.target.value}T09:00:00`).toISOString() : null;
                            updateTaskMutation.mutate({ id: task.id, patch: { scheduled_for: next, due_at: next } });
                          }}
                          className="hidden h-7 w-[126px] rounded-sm border border-transparent bg-transparent px-1.5 text-[12px] font-normal text-[var(--text-secondary)] outline-none transition hover:bg-white focus:bg-white lg:block lg:opacity-0 lg:group-hover/row:opacity-100 lg:focus:opacity-100"
                          aria-label={`Date for ${task.title}`}
                        />
                        {task.status === 'open' ? (
                          <IconButton
                            onClick={() => updateTaskMutation.mutate({ id: task.id, patch: { status: 'skipped' } })}
                            className="opacity-0 group-hover/row:opacity-100 focus:opacity-100"
                            aria-label={`Skip ${task.title}`}
                          >
                            <SkipForward className="h-4 w-4" />
                          </IconButton>
                        ) : null}
                        {task.status !== 'archived' ? (
                          <IconButton
                            onClick={() => updateTaskMutation.mutate({ id: task.id, patch: { status: 'archived' } })}
                            className="opacity-0 group-hover/row:opacity-100 focus:opacity-100"
                            aria-label={`Archive ${task.title}`}
                          >
                            <Archive className="h-4 w-4" />
                          </IconButton>
                        ) : null}
                        {task.status === 'skipped' ? <Circle className="h-4 w-4 text-[var(--icon-muted)]" /> : null}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-center">
            <div>
              <Circle className="mx-auto h-7 w-7 text-[var(--icon-muted)]" strokeWidth={1.5} />
              <div className="mt-3 text-[17px] font-semibold text-[var(--text-primary)]">No tasks here</div>
              <p className="mt-2 text-sm text-[var(--text-muted)]">Create one above or sync due routines.</p>
            </div>
          </div>
        )}
      </div>
    </ReferencePage>
  );
}
