'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useAuth, useUser } from '@clerk/nextjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, CalendarClock, Check, Circle, Inbox, ListFilter, Plus, RotateCw, SkipForward } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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

function priorityBars(priority: TaskPriority) {
  const count = priority === 'high' ? 3 : priority === 'medium' ? 2 : priority === 'low' ? 1 : 0;
  return (
    <span className="flex h-4 w-5 items-end gap-[2px]" aria-label={`Priority ${priority}`}>
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className={cn(
            'w-[3px] rounded-full',
            index === 0 ? 'h-1.5' : index === 1 ? 'h-2.5' : 'h-3.5',
            index < count ? 'bg-[#ef6c2f]' : 'bg-[#d4d8d2]',
          )}
        />
      ))}
    </span>
  );
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
  const [quickCategory, setQuickCategory] = useState('Personal');

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
    <div className="flex h-full min-h-0 flex-col bg-[#f7f8f5]">
      <div className="shrink-0 border-b border-[rgba(15,23,42,0.08)] bg-white/88 px-8 py-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-[700] uppercase tracking-[0.16em] text-[#6b7280]">
              <Inbox className="h-4 w-4" />
              Tasks
            </div>
            <h1 className="mt-2 text-[34px] font-[650] tracking-[-0.04em] text-[#111827]">
              {VIEWS.find((item) => item.id === view)?.label}
            </h1>
          </div>

          <form onSubmit={handleQuickAdd} className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
            <input
              value={quickTitle}
              onChange={(event) => setQuickTitle(event.target.value)}
              placeholder="Add a task..."
              className="h-10 min-w-[280px] rounded-sm border border-[rgba(15,23,42,0.12)] bg-white px-3 text-sm text-[#111827] outline-none placeholder:text-[#9ca3af] focus:border-[#111827]"
            />
            <select
              value={quickCategory}
              onChange={(event) => setQuickCategory(event.target.value)}
              className="h-10 rounded-sm border border-[rgba(15,23,42,0.12)] bg-white px-3 text-sm text-[#4b5563] outline-none"
            >
              {CATEGORY_FILTERS.filter((item) => item !== 'All').map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
            <Button type="submit" className="h-10 bg-[#111827] text-white hover:bg-[#1f2937]" disabled={createTaskMutation.isPending}>
              <Plus className="h-4 w-4" />
              Add
            </Button>
          </form>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          {VIEWS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setView(item.id)}
              className={cn(
                'h-8 rounded-sm px-3 text-sm font-[600] transition',
                view === item.id ? 'bg-[#111827] text-white' : 'bg-white text-[#4b5563] hover:bg-[#eef1ea]',
              )}
            >
              {item.label}
            </button>
          ))}
          <span className="mx-1 h-5 w-px bg-[rgba(15,23,42,0.12)]" />
          <ListFilter className="h-4 w-4 text-[#6b7280]" />
          {CATEGORY_FILTERS.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setCategory(item)}
              className={cn(
                'h-8 rounded-sm px-3 text-sm font-[600] transition',
                category === item ? 'bg-[#e4eadf] text-[#111827]' : 'text-[#6b7280] hover:bg-white',
              )}
            >
              {item}
            </button>
          ))}
          <select
            value={groupMode}
            onChange={(event) => setGroupMode(event.target.value as GroupMode)}
            className="h-8 rounded-sm border border-[rgba(15,23,42,0.12)] bg-white px-2 text-sm font-[600] text-[#4b5563] outline-none"
            aria-label="Group tasks"
          >
            {GROUP_MODES.map((item) => (
              <option key={item.id} value={item.id}>Group: {item.label}</option>
            ))}
          </select>
          <Button
            type="button"
            variant="outline"
            className="ml-auto h-8 rounded-sm"
            onClick={() => generateDueMutation.mutate()}
            disabled={generateDueMutation.isPending}
          >
            <RotateCw className={cn('h-4 w-4', generateDueMutation.isPending && 'animate-spin')} />
            Sync routines
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-8 py-6">
        {tasksQuery.isLoading ? (
          <div className="space-y-3">
            {[0, 1, 2, 3].map((item) => (
              <div key={item} className="h-14 animate-pulse rounded-sm bg-white" />
            ))}
          </div>
        ) : groups.length ? (
          <div className="mx-auto max-w-5xl space-y-7">
            {groups.map(([group, groupTasksValue]) => (
              <section key={group}>
                <div className="mb-2 flex items-center gap-3 border-b border-[rgba(15,23,42,0.10)] pb-2">
                  <div className="text-[18px] font-[650] tracking-[-0.02em] text-[#111827]">{group}</div>
                  <div className="text-sm text-[#6b7280]">{groupTasksValue.length}</div>
                </div>
                <div className="divide-y divide-[rgba(15,23,42,0.06)] overflow-hidden rounded-sm border border-[rgba(15,23,42,0.08)] bg-white">
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
                      className="grid min-h-[54px] grid-cols-[32px_minmax(0,1fr)_auto_auto_auto] items-center gap-3 px-3 py-2 outline-none hover:bg-[#fbfcfb] focus-visible:bg-[#fbfcfb] focus-visible:ring-2 focus-visible:ring-[#111827]"
                    >
                      <Checkbox
                        checked={task.status === 'completed'}
                        onCheckedChange={(checked) => updateTaskMutation.mutate({
                          id: task.id,
                          patch: { status: checked ? 'completed' : 'open' },
                        })}
                        aria-label={`Complete ${task.title}`}
                      />
                      <div className="min-w-0">
                        <div className={cn('truncate text-sm font-[600] text-[#111827]', task.status === 'completed' && 'text-[#9ca3af] line-through')}>
                          {task.title}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-[#6b7280]">
                          <span>{task.source}</span>
                          {task.due_at || task.scheduled_for ? (
                            <span className="inline-flex items-center gap-1 text-[#b45309]">
                              <CalendarClock className="h-3.5 w-3.5" />
                              {formatTaskDate(task.scheduled_for || task.due_at)}
                            </span>
                          ) : null}
                          {task.tags.map((tag) => <span key={tag}>#{tag}</span>)}
                        </div>
                      </div>
                      <div className="hidden items-center gap-2 md:flex">
                        {priorityBars(task.priority)}
                        <select
                          value={task.priority}
                          onChange={(event) => updateTaskMutation.mutate({
                            id: task.id,
                            patch: { priority: event.target.value as TaskPriority },
                          })}
                          className="h-8 rounded-sm border border-[rgba(15,23,42,0.10)] bg-white px-2 text-xs text-[#4b5563] outline-none"
                        >
                          {PRIORITIES.map((item) => (
                            <option key={item} value={item}>{item}</option>
                          ))}
                        </select>
                      </div>
                      <input
                        type="date"
                        value={dateInputValue(task.scheduled_for || task.due_at)}
                        onChange={(event) => {
                          const next = event.target.value ? new Date(`${event.target.value}T09:00:00`).toISOString() : null;
                          updateTaskMutation.mutate({ id: task.id, patch: { scheduled_for: next, due_at: next } });
                        }}
                        className="hidden h-8 rounded-sm border border-[rgba(15,23,42,0.10)] bg-white px-2 text-xs text-[#4b5563] outline-none lg:block"
                      />
                      <div className="flex items-center gap-1">
                        {task.status === 'open' ? (
                          <button
                            type="button"
                            onClick={() => updateTaskMutation.mutate({ id: task.id, patch: { status: 'skipped' } })}
                            className="flex h-8 w-8 items-center justify-center rounded-sm text-[#6b7280] hover:bg-[#f1f3ef] hover:text-[#111827]"
                            aria-label={`Skip ${task.title}`}
                          >
                            <SkipForward className="h-4 w-4" />
                          </button>
                        ) : null}
                        {task.status !== 'archived' ? (
                          <button
                            type="button"
                            onClick={() => updateTaskMutation.mutate({ id: task.id, patch: { status: 'archived' } })}
                            className="flex h-8 w-8 items-center justify-center rounded-sm text-[#6b7280] hover:bg-[#f1f3ef] hover:text-[#111827]"
                            aria-label={`Archive ${task.title}`}
                          >
                            <Archive className="h-4 w-4" />
                          </button>
                        ) : null}
                        {task.status === 'skipped' ? <Circle className="h-4 w-4 text-[#9ca3af]" /> : null}
                        {task.status === 'completed' ? <Check className="h-4 w-4 text-[#16a34a]" /> : null}
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
              <Circle className="mx-auto h-8 w-8 text-[#9ca3af]" />
              <div className="mt-3 text-[20px] font-[650] tracking-[-0.02em] text-[#111827]">No tasks here</div>
              <p className="mt-2 text-sm text-[#6b7280]">Create one above or sync due routines.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
