'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth, useUser } from '@clerk/nextjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Calendar, CalendarClock, Check, ChevronDown, Circle, Folder, Inbox, ListFilter, Plus, RotateCw, SkipForward, X } from 'lucide-react';
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
  ReferenceHeader,
  ReferencePage,
  controlClass,
  priorityBars,
  subtleBorderClass,
} from '@/lib/tasks/reference-task-shell';
import type { Task, TaskCreateInput, TaskListResponse, TaskPriority, TaskUpdateInput } from '@/lib/tasks/types';

const TASK_CATEGORIES = ['Health', 'Work', 'Personal', 'Finance', 'Experiments', 'AI'] as const;
const CATEGORY_FILTERS = ['All', ...TASK_CATEGORIES] as const;
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

function filterTasksForPage(tasks: Task[], category: string): Task[] {
  return tasks.filter((task) => task.status !== 'archived' && (category === 'All' || task.category === category));
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

function taskComposerPriorityLabel(priority: TaskPriority) {
  if (priority === 'none') return 'No priority';
  return priority.charAt(0).toUpperCase() + priority.slice(1);
}

function formatComposerDueDate(value: string) {
  if (!value) return 'Due date';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return 'Due date';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}

export function TasksClient() {
  const { getToken } = useAuth();
  const { user } = useUser();
  const queryClient = useQueryClient();
  useTaskRoutineOutboxSync();
  const [category, setCategory] = useState<(typeof CATEGORY_FILTERS)[number]>('All');
  const [groupMode, setGroupMode] = useState<GroupMode>('category');
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerTitle, setComposerTitle] = useState('');
  const [composerNotes, setComposerNotes] = useState('');
  const [composerCategory, setComposerCategory] = useState<(typeof TASK_CATEGORIES)[number]>('Personal');
  const [composerPriority, setComposerPriority] = useState<TaskPriority>('none');
  const [composerSchedule, setComposerSchedule] = useState<'today' | 'anytime'>('today');
  const [composerDueDate, setComposerDueDate] = useState('');
  const [createMore, setCreateMore] = useState(false);
  const composerTitleRef = useRef<HTMLInputElement>(null);

  const queryKey = ['tasks', user?.id, category];

  const tasksQuery = useQuery({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '300' });
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
      return filterTasksForPage(mergeTasksWithOutbox(backendItems || vaultItems || [], outboxItems), category);
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

  const resetComposerFields = () => {
    setComposerTitle('');
    setComposerNotes('');
    setComposerPriority('none');
    setComposerCategory('Personal');
    setComposerSchedule('today');
    setComposerDueDate('');
  };

  useEffect(() => {
    if (!composerOpen) return;
    window.setTimeout(() => composerTitleRef.current?.focus(), 50);
  }, [composerOpen]);

  const handleComposerSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const title = composerTitle.trim();
    if (!title) return;
    const scheduledFor = composerSchedule === 'today' ? new Date().toISOString() : null;
    const dueAt = composerDueDate ? new Date(`${composerDueDate}T09:00:00`).toISOString() : null;

    createTaskMutation.mutate({
      title,
      notes: composerNotes.trim() || null,
      category: composerCategory,
      priority: composerPriority,
      source: 'manual',
      client_event_id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      scheduled_for: scheduledFor,
      due_at: dueAt,
    }, {
      onSuccess: () => {
        resetComposerFields();
        if (createMore) {
          window.setTimeout(() => composerTitleRef.current?.focus(), 50);
          return;
        }
        setComposerOpen(false);
      },
    });
  };

  return (
    <ReferencePage>
      <ReferenceHeader
        title="Tasks"
        eyebrow={<><Inbox className="h-4 w-4" /> Tasks</>}
        actions={(
          <button
            type="button"
            onClick={() => setComposerOpen(true)}
            className="inline-flex h-10 items-center gap-2 rounded-sm bg-[#111827] px-3.5 text-[14px] font-[650] text-white transition hover:bg-[#202938]"
          >
            <Plus className="h-4 w-4" />
            New task
          </button>
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          <ListFilter className="h-4 w-4 text-[#777f89]" />
          {CATEGORY_FILTERS.map((item) => (
            <FilterChip key={item} active={category === item} onClick={() => setCategory(item)}>
              {item}
            </FilterChip>
          ))}
          <select
            value={groupMode}
            onChange={(event) => setGroupMode(event.target.value as GroupMode)}
            className={cn('ml-auto h-8 px-2.5 text-[13px] font-[640]', controlClass)}
            aria-label="Group tasks"
          >
            {GROUP_MODES.map((item) => (
              <option key={item.id} value={item.id}>View by {item.label}</option>
            ))}
          </select>
          <button
            type="button"
            className="inline-flex h-8 items-center gap-2 rounded-sm border border-[rgba(15,23,42,0.10)] bg-white/80 px-3 text-[13px] font-[640] text-[#2f3743] transition hover:bg-[#f3f5f0] disabled:opacity-55"
            onClick={() => generateDueMutation.mutate()}
            disabled={generateDueMutation.isPending}
          >
            <RotateCw className={cn('h-4 w-4', generateDueMutation.isPending && 'animate-spin')} />
            Sync routines
          </button>
        </div>
      </ReferenceHeader>

      <div className="min-h-0 flex-1 overflow-auto px-9 py-7">
        {tasksQuery.isLoading ? (
          <div className="mx-auto max-w-[980px] space-y-2">
            {[0, 1, 2, 3].map((item) => (
              <div key={item} className="h-11 animate-pulse rounded-sm bg-[#f1f3ef]" />
            ))}
          </div>
        ) : groups.length ? (
          <div className="mx-auto max-w-[980px] space-y-8">
            {groups.map(([group, groupTasksValue]) => (
              <section key={group}>
                <div className={cn('mb-2 flex items-center gap-2 border-b pb-2', subtleBorderClass)}>
                  <span className="flex h-6 w-6 items-center justify-center rounded-full border border-[rgba(15,23,42,0.14)] bg-white">
                    <Folder className="h-3.5 w-3.5 text-[#707984]" />
                  </span>
                  <h2 className="truncate text-[18px] font-[680] tracking-[-0.02em] text-[#151922]">{group}</h2>
                  <span className="text-[13px] font-[560] text-[#8b929b]">{groupTasksValue.length}</span>
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
                      className="group/row grid min-h-[44px] grid-cols-[28px_22px_minmax(0,1fr)_auto] items-center gap-2 rounded-sm px-2.5 outline-none transition hover:bg-[#f3f5f0] focus-visible:bg-[#f3f5f0] focus-visible:ring-2 focus-visible:ring-[#111827]"
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
                            ? 'border-[#111827] bg-[#111827] text-white'
                            : 'border-[rgba(15,23,42,0.22)] bg-white text-transparent hover:border-[#111827]',
                        )}
                        aria-label={`Complete ${task.title}`}
                        aria-pressed={task.status === 'completed'}
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                      {priorityBars(task.priority, true)}
                      <div className="min-w-0">
                        <div className={cn('truncate text-[15px] font-[590] text-[#20242c]', task.status === 'completed' && 'text-[#9aa1aa] line-through')}>
                          {task.title}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[12px] font-[520] text-[#7a828c]">
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
                        <select
                          value={task.priority}
                          onChange={(event) => updateTaskMutation.mutate({
                            id: task.id,
                            patch: { priority: event.target.value as TaskPriority },
                          })}
                          className="hidden h-7 w-[78px] rounded-sm border border-transparent bg-transparent px-1.5 text-[12px] font-[560] text-[#6e7680] outline-none transition hover:bg-white focus:bg-white md:block md:opacity-0 md:group-hover/row:opacity-100 md:focus:opacity-100"
                          aria-label={`Priority for ${task.title}`}
                        >
                          {PRIORITIES.map((item) => (
                            <option key={item} value={item}>{item}</option>
                          ))}
                        </select>
                        <input
                          type="date"
                          value={dateInputValue(task.scheduled_for || task.due_at)}
                          onChange={(event) => {
                            const next = event.target.value ? new Date(`${event.target.value}T09:00:00`).toISOString() : null;
                            updateTaskMutation.mutate({ id: task.id, patch: { scheduled_for: next, due_at: next } });
                          }}
                          className="hidden h-7 w-[126px] rounded-sm border border-transparent bg-transparent px-1.5 text-[12px] font-[560] text-[#6e7680] outline-none transition hover:bg-white focus:bg-white lg:block lg:opacity-0 lg:group-hover/row:opacity-100 lg:focus:opacity-100"
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
                        {task.status === 'skipped' ? <Circle className="h-4 w-4 text-[#9ca3af]" /> : null}
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
              <Circle className="mx-auto h-8 w-8 text-[#a0a7b0]" />
              <div className="mt-3 text-[20px] font-[680] tracking-[-0.02em] text-[#141922]">No tasks yet</div>
              <p className="mt-2 text-[14px] text-[#737b86]">Create one or sync due routines.</p>
            </div>
          </div>
        )}
      </div>

      {composerOpen ? (
        <>
          <button
            type="button"
            aria-label="Close new task composer"
            className="fixed inset-0 z-50 bg-[#111827]/10 backdrop-blur-[1px]"
            onClick={() => setComposerOpen(false)}
          />
          <form
            onSubmit={handleComposerSubmit}
            className="fixed left-1/2 top-[16vh] z-50 w-[min(calc(100vw-48px),560px)] -translate-x-1/2 overflow-visible rounded-[10px] border border-[rgba(15,23,42,0.14)] bg-white shadow-[0_24px_70px_rgba(15,23,42,0.18)]"
          >
            <button
              type="button"
              onClick={() => setComposerOpen(false)}
              className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-sm text-[#8a919b] transition hover:bg-[#f1f3ef] hover:text-[#111827]"
              aria-label="Close new task composer"
            >
              <X className="h-[18px] w-[18px]" />
            </button>

            <div className="px-5 pb-4 pt-5">
              <input
                ref={composerTitleRef}
                value={composerTitle}
                onChange={(event) => setComposerTitle(event.target.value)}
                placeholder="New task"
                className="h-9 w-[calc(100%-40px)] bg-transparent text-[24px] font-[680] leading-none tracking-[-0.025em] text-[#151922] outline-none placeholder:text-[#989fa8]"
              />
              <textarea
                value={composerNotes}
                onChange={(event) => setComposerNotes(event.target.value)}
                placeholder="Add description..."
                rows={2}
                className="mt-3 min-h-[62px] w-full resize-none bg-transparent text-[14px] leading-6 text-[#4a535f] outline-none placeholder:text-[#9aa1aa]"
              />

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <label className="relative inline-flex h-8 items-center">
                  <select
                    value={composerPriority}
                    onChange={(event) => setComposerPriority(event.target.value as TaskPriority)}
                    className="h-8 appearance-none rounded-full border border-[rgba(15,23,42,0.13)] bg-white py-0 pl-3 pr-8 text-[13px] font-[620] text-[#313843] outline-none transition hover:bg-[#f7f8f5] focus:border-[rgba(15,23,42,0.28)]"
                    aria-label="Task priority"
                  >
                    {PRIORITIES.map((priority) => (
                      <option key={priority} value={priority}>{taskComposerPriorityLabel(priority)}</option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2.5 h-3.5 w-3.5 text-[#8b929b]" />
                </label>

                <label className="relative inline-flex h-8 items-center">
                  <select
                    value={composerCategory}
                    onChange={(event) => setComposerCategory(event.target.value as (typeof TASK_CATEGORIES)[number])}
                    className="h-8 appearance-none rounded-full border border-[rgba(15,23,42,0.13)] bg-white py-0 pl-3 pr-8 text-[13px] font-[620] text-[#313843] outline-none transition hover:bg-[#f7f8f5] focus:border-[rgba(15,23,42,0.28)]"
                    aria-label="Task category"
                  >
                    {TASK_CATEGORIES.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2.5 h-3.5 w-3.5 text-[#8b929b]" />
                </label>

                <label className="relative inline-flex h-8 items-center">
                  <select
                    value={composerSchedule}
                    onChange={(event) => setComposerSchedule(event.target.value as 'today' | 'anytime')}
                    className="h-8 appearance-none rounded-full border border-[rgba(15,23,42,0.13)] bg-white py-0 pl-3 pr-8 text-[13px] font-[620] text-[#313843] outline-none transition hover:bg-[#f7f8f5] focus:border-[rgba(15,23,42,0.28)]"
                    aria-label="Task schedule"
                  >
                    <option value="today">Today</option>
                    <option value="anytime">Anytime</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2.5 h-3.5 w-3.5 text-[#8b929b]" />
                </label>

                <label className="relative inline-flex h-8 items-center gap-2 rounded-full border border-[rgba(15,23,42,0.13)] bg-white pl-3 pr-2 text-[13px] font-[620] text-[#313843] transition hover:bg-[#f7f8f5] focus-within:border-[rgba(15,23,42,0.28)]">
                  <Calendar className="h-3.5 w-3.5 text-[#8b929b]" />
                  <span className="min-w-[54px]">{formatComposerDueDate(composerDueDate)}</span>
                  <input
                    type="date"
                    value={composerDueDate}
                    onChange={(event) => setComposerDueDate(event.target.value)}
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                    aria-label="Task due date"
                  />
                </label>
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-[rgba(15,23,42,0.10)] px-5 py-3">
              <button
                type="button"
                role="switch"
                aria-checked={createMore}
                onClick={() => setCreateMore((value) => !value)}
                className="inline-flex items-center gap-2 text-[13px] font-[620] text-[#68707b]"
              >
                <span className={cn(
                  'relative h-5 w-9 rounded-full border transition',
                  createMore
                    ? 'border-[#111827] bg-[#111827]'
                    : 'border-[rgba(15,23,42,0.12)] bg-[#e6e8e3]',
                )}>
                  <span className={cn(
                    'absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-white shadow-[0_1px_3px_rgba(15,23,42,0.18)] transition',
                    createMore ? 'left-[17px]' : 'left-0.5',
                  )} />
                </span>
                Create more
              </button>

              <button
                type="submit"
                disabled={!composerTitle.trim() || createTaskMutation.isPending}
                className="inline-flex h-9 items-center gap-2 rounded-sm bg-[#111827] px-4 text-[13px] font-[700] text-white shadow-[0_1px_2px_rgba(15,23,42,0.18)] transition hover:bg-[#202938] disabled:cursor-not-allowed disabled:bg-[#b8b8b2]"
              >
                Create task
              </button>
            </div>
          </form>
        </>
      ) : null}
    </ReferencePage>
  );
}
