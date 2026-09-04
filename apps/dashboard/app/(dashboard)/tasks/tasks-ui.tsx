'use client';

import React, { useState } from 'react';
import {
  Archive,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleCheck,
  CircleDashed,
  CircleDotDashed,
  CircleGauge,
  CircleX,
  Flag,
  MoreHorizontal,
  Plus,
} from 'lucide-react';

import { Button } from '@ritual/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@ritual/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@ritual/ui/popover';
import { dateInputValue } from '@/lib/tasks/date-format';
import {
  CATEGORY_FILTERS,
  LIST_LAYOUT_MODES,
  PRIORITIES,
  TASK_STATUS_OPTIONS,
  TASK_VIEWS,
  isTaskViewId,
  type ListLayoutMode,
  type TaskViewId,
} from '@/lib/tasks/task-constants';
import {
  HeaderPortal,
  InlineFieldInput,
  PillSelect,
  priorityBars,
  TaskRowShell,
} from '@/lib/tasks/task-ui-shell';
import type { Task, TaskPriority, TaskStatus, TaskUpdateInput } from '@/lib/tasks/types';
import { relativeDayLabel } from '@/lib/tasks/seed-data';
import { TaskCompleteShell, TaskCompleteTitle } from '@/lib/tasks/task-complete-effect';
import { checklistProgress, splitTaskNotes } from '@/lib/tasks/checklist';
import { cn } from '@/lib/utils';

export {
  CATEGORY_FILTERS,
  LIST_LAYOUT_MODES,
  PRIORITIES,
  TASK_VIEWS,
  isTaskViewId,
  type ListLayoutMode,
  type TaskViewId,
};

export { TasksCategoryPills } from './tasks-filters';

export function TasksToolbarActions({
  onNewTask,
}: {
  onNewTask: () => void;
}) {
  return (
    <HeaderPortal>
      <Button
        type="button"
        variant="brand"
        size="compact"
        onClick={onNewTask}
        className="h-7 !rounded-full px-3 font-medium [&_svg]:size-3.5"
        data-cuelume-release="bloom"
      >
        <Plus className="h-3.5 w-3.5" />
        New task
      </Button>
    </HeaderPortal>
  );
}

function ProjectGroupHeader({
  name,
  count,
  collapsed,
  onToggle,
  overdueLabel,
}: {
  name: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  overdueLabel?: string | null;
}) {
  return (
    <div className="mb-1.5 mt-5 flex items-center gap-2 first:mt-0">
      <button
        type="button"
        onClick={onToggle}
        className="flex min-w-0 items-center gap-1.5 rounded-[var(--radius-row)] px-1.5 py-1 text-left hover:bg-[var(--row-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ritual-focus-ring)]"
        aria-expanded={!collapsed}
      >
        {collapsed ? (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--icon-muted)]" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--icon-muted)]" />
        )}
        <h2 className="truncate text-[13px] font-medium text-[var(--text-secondary)]">{name}</h2>
        <span className="text-[11px] tabular-nums text-[var(--text-muted)]">{count}</span>
      </button>
      <div className="h-px min-w-[16px] flex-1 bg-[var(--border-subtle)]" />
      {overdueLabel ? (
        <span className="flex shrink-0 items-center gap-1 text-[11px] text-[#c44d3a]">
          <Flag className="h-3 w-3" />
          {overdueLabel}
        </span>
      ) : null}
    </div>
  );
}

function groupOverdueLabel(tasks: Task[]): string | null {
  for (const task of tasks) {
    const label = relativeDayLabel(task.due_at);
    if (label.endsWith('ago')) return label;
  }
  return null;
}

const TASK_ROW_GRID_CLASS = cn(
  'grid w-full min-w-0 items-center gap-2',
  'grid-cols-[minmax(0,1fr)_minmax(108px,auto)_1.75rem]',
  'md:grid-cols-[minmax(0,1fr)_112px_92px_72px_1.75rem]',
  'lg:grid-cols-[minmax(0,1fr)_112px_92px_72px_88px_1.75rem]',
);

const emptyCompletingIds: ReadonlySet<string> = new Set();

function formatTaskCreatedDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const currentYear = new Date().getFullYear();
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() === currentYear ? {} : { year: 'numeric' }),
  }).format(date);
}

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  none: 'None',
  urgent: 'Urgent',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

function TaskStatusIcon({ status }: { status: TaskStatus }) {
  if (status === 'in_progress') return <CircleGauge className="h-3.5 w-3.5 text-[var(--ritual-status-warning)]" />;
  if (status === 'in_review') return <CircleDotDashed className="h-3.5 w-3.5 text-[var(--ritual-status-info)]" />;
  if (status === 'completed') return <CircleCheck className="h-3.5 w-3.5 text-[var(--ritual-status-success)]" />;
  if (status === 'canceled' || status === 'skipped') {
    return <CircleX className="h-3.5 w-3.5 text-[var(--icon-muted)]" />;
  }
  if (status === 'archived') return <Archive className="h-3.5 w-3.5 text-[var(--icon-muted)]" />;
  return <Circle className="h-3.5 w-3.5 text-[var(--icon-default)]" />;
}

function TaskStatusControl({
  task,
  onUpdate,
}: {
  task: Task;
  onUpdate: (patch: TaskUpdateInput) => void;
}) {
  const label = TASK_STATUS_OPTIONS.find((option) => option.value === task.status)?.label
    || (task.status === 'skipped' ? 'Canceled' : task.status === 'archived' ? 'Archived' : task.status);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          onClick={(event) => event.stopPropagation()}
          className="flex h-7 min-w-0 items-center gap-1.5 rounded-full border border-transparent px-2 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--row-hover)] hover:text-[var(--text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ritual-focus-ring)] data-[state=open]:border-[var(--border-floating)] data-[state=open]:bg-[var(--surface-raised)]"
          aria-label={`Change status for ${task.title}`}
        >
          <TaskStatusIcon status={task.status} />
          <span className="truncate">{label}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-40">
        {TASK_STATUS_OPTIONS.map((option) => (
          <DropdownMenuItem key={option.value} onSelect={() => onUpdate({ status: option.value })}>
            <TaskStatusIcon status={option.value} />
            {option.label}
            {task.status === option.value ? <Check className="ml-auto h-3.5 w-3.5" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TaskPriorityControl({
  task,
  onUpdate,
}: {
  task: Task;
  onUpdate: (patch: TaskUpdateInput) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          onClick={(event) => event.stopPropagation()}
          className="flex h-7 min-w-0 items-center gap-1.5 rounded-full border border-transparent px-2 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--row-hover)] hover:text-[var(--text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ritual-focus-ring)] data-[state=open]:border-[var(--border-floating)] data-[state=open]:bg-[var(--surface-raised)]"
          aria-label={`Change priority for ${task.title}`}
        >
          {task.priority === 'none' ? (
            <CircleDashed className="h-3.5 w-3.5 text-[var(--icon-muted)]" />
          ) : (
            priorityBars(task.priority, true)
          )}
          <span className="truncate">{PRIORITY_LABELS[task.priority]}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-40">
        {PRIORITIES.map((priority) => (
          <DropdownMenuItem key={priority} onSelect={() => onUpdate({ priority })}>
            {priority === 'none' ? (
              <CircleDashed className="h-3.5 w-3.5 text-[var(--icon-muted)]" />
            ) : (
              priorityBars(priority)
            )}
            {PRIORITY_LABELS[priority]}
            {task.priority === priority ? <Check className="ml-auto h-3.5 w-3.5" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TaskTableHeader() {
  return (
    <div
      className={cn(
        TASK_ROW_GRID_CLASS,
        'mb-1 min-h-8 border-b border-[var(--border-subtle)] px-2.5 text-[11px] font-medium text-[var(--text-muted)]',
      )}
      aria-hidden="true"
    >
      <span>Task</span>
      <span>Status</span>
      <span className="hidden md:block">Priority</span>
      <span className="hidden text-right md:block">Created</span>
      <span className="hidden text-right lg:block">Deadline</span>
      <span />
    </div>
  );
}

export function TaskGroupSection({
  group,
  tasks,
  menuTaskId,
  onMenuTaskChange,
  onComplete,
  onUpdate,
  onOpen,
  completingIds = emptyCompletingIds,
}: {
  group: string;
  tasks: Task[];
  menuTaskId: string | null;
  onMenuTaskChange: (taskId: string | null) => void;
  onComplete: (task: Task) => void;
  onUpdate: (id: string, patch: TaskUpdateInput) => void;
  onOpen: (task: Task) => void;
  completingIds?: ReadonlySet<string>;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const overdueLabel = groupOverdueLabel(tasks);

  return (
    <section style={{ marginBottom: 'var(--task-group-gap, 32px)' }}>
      <ProjectGroupHeader
        name={group}
        count={tasks.length}
        collapsed={collapsed}
        onToggle={() => setCollapsed((value) => !value)}
        overdueLabel={overdueLabel}
      />
      {!collapsed ? (
        <div className="space-y-0.5">
          {tasks.map((task) => (
            <TaskCompleteShell key={task.id} completing={completingIds.has(task.id)}>
              <TaskRow
                task={task}
                completing={completingIds.has(task.id)}
                menuOpen={menuTaskId === task.id}
                onMenuOpenChange={(open) => onMenuTaskChange(open ? task.id : null)}
                onComplete={() => onComplete(task)}
                onUpdate={(patch) => onUpdate(task.id, patch)}
                onOpen={() => onOpen(task)}
              />
            </TaskCompleteShell>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function TaskListSection({
  tasks,
  menuTaskId,
  onMenuTaskChange,
  onComplete,
  onUpdate,
  onOpen,
  completingIds = emptyCompletingIds,
}: {
  tasks: Task[];
  menuTaskId: string | null;
  onMenuTaskChange: (taskId: string | null) => void;
  onComplete: (task: Task) => void;
  onUpdate: (id: string, patch: TaskUpdateInput) => void;
  onOpen: (task: Task) => void;
  completingIds?: ReadonlySet<string>;
}) {
  return (
    <div className="space-y-0.5">
      {tasks.map((task) => (
        <TaskCompleteShell key={task.id} completing={completingIds.has(task.id)}>
          <TaskRow
            task={task}
            completing={completingIds.has(task.id)}
            menuOpen={menuTaskId === task.id}
            onMenuOpenChange={(open) => onMenuTaskChange(open ? task.id : null)}
            onComplete={() => onComplete(task)}
            onUpdate={(patch) => onUpdate(task.id, patch)}
            onOpen={() => onOpen(task)}
          />
        </TaskCompleteShell>
      ))}
    </div>
  );
}

export function TaskRow({
  task,
  completing = false,
  menuOpen,
  onMenuOpenChange,
  onComplete,
  onUpdate,
  onOpen,
}: {
  task: Task;
  completing?: boolean;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  onComplete: () => void;
  onUpdate: (patch: TaskUpdateInput) => void;
  onOpen: () => void;
}) {
  const createdLabel = formatTaskCreatedDate(task.created_at);
  const deadlineLabel = relativeDayLabel(task.due_at);
  const progress = checklistProgress(splitTaskNotes(task.notes).items);
  const checked = completing || task.status === 'completed';

  return (
    <Popover open={menuOpen} onOpenChange={onMenuOpenChange}>
      <TaskRowShell
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === 'Enter') {
            event.preventDefault();
            onOpen();
          }
        }}
        className={cn(TASK_ROW_GRID_CLASS, 'min-h-10 cursor-default px-2.5 py-1')}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              if (!completing) onComplete();
            }}
            className={cn(
              'flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border',
              checked
                ? 'border-[#27251E] bg-[#27251E] text-white'
                : 'border-[rgba(39,37,30,0.38)] bg-white text-transparent hover:border-[#27251E]',
            )}
            aria-label={`Complete ${task.title}`}
            aria-pressed={checked}
            disabled={completing}
          >
            <Check className={cn('h-3 w-3', completing && 'ritual-task-complete-check')} />
          </button>
          <div className="flex min-w-0 items-center gap-2">
            {completing ? (
              <TaskCompleteTitle
                title={task.title}
                className="block max-w-full min-w-0 truncate text-[14px] font-normal leading-5"
              />
            ) : (
              <div
                className={cn(
                  'min-w-0 truncate text-[14px] font-normal leading-5 text-[var(--text-primary)]',
                  task.status === 'completed' && 'text-[var(--text-muted)] line-through',
                )}
              >
                {task.title}
              </div>
            )}
            {progress.total > 0 ? (
              <span className="shrink-0 tabular-nums text-[11px] text-[var(--text-muted)]">
                {progress.done}/{progress.total}
              </span>
            ) : null}
          </div>
        </div>

        <TaskStatusControl task={task} onUpdate={onUpdate} />

        <div className="hidden min-w-0 md:block">
          <TaskPriorityControl task={task} onUpdate={onUpdate} />
        </div>

        <span className="hidden min-w-0 truncate text-right text-[12px] tabular-nums text-[var(--text-muted)] md:block">
          {createdLabel}
        </span>

        <span className="hidden min-w-0 truncate text-right text-[12px] tabular-nums text-[var(--text-muted)] lg:block">
          {deadlineLabel || '—'}
        </span>

        <PopoverTrigger asChild>
          <button
            type="button"
            onClick={(event) => event.stopPropagation()}
            className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-row)] text-[var(--icon-muted)] opacity-0 hover:bg-[var(--row-hover)] hover:text-[var(--text-primary)] focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ritual-focus-ring)] group-hover/row:opacity-100 data-[state=open]:bg-[var(--row-hover)] data-[state=open]:opacity-100"
            aria-label={`More options for ${task.title}`}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </PopoverTrigger>
      </TaskRowShell>
      <TaskRowMenu task={task} onUpdate={onUpdate} />
    </Popover>
  );
}

function TaskBoardCard({
  task,
  completing = false,
  menuOpen,
  onMenuOpenChange,
  onComplete,
  onUpdate,
  onOpen,
}: {
  task: Task;
  completing?: boolean;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  onComplete: () => void;
  onUpdate: (patch: TaskUpdateInput) => void;
  onOpen: () => void;
}) {
  const contextLabel = task.project || task.category || 'Inbox';
  const checked = completing || task.status === 'completed';

  return (
    <Popover open={menuOpen} onOpenChange={onMenuOpenChange}>
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(event) => {
          if (event.target === event.currentTarget && event.key === 'Enter') onOpen();
        }}
        className="group rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-3 transition-colors hover:border-[var(--border-floating)] hover:bg-[var(--row-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ritual-focus-ring)]"
      >
        <div className="flex items-start gap-2.5">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              if (!completing) onComplete();
            }}
            className={cn(
              'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border',
              checked
                ? 'border-[var(--text-primary)] bg-[var(--text-primary)] text-[var(--surface-raised)]'
                : 'border-[var(--border-floating)] bg-[var(--surface-raised)] text-transparent',
            )}
            aria-label={`Complete ${task.title}`}
            aria-pressed={checked}
            disabled={completing}
          >
            <Check className={cn('h-3 w-3', completing && 'ritual-task-complete-check')} />
          </button>
          {completing ? (
            <TaskCompleteTitle
              title={task.title}
              className="block max-w-full min-w-0 flex-1 truncate text-[13px] font-medium leading-5"
            />
          ) : (
            <span className="min-w-0 flex-1 text-[13px] font-medium leading-5 text-[var(--text-primary)]">
              {task.title}
            </span>
          )}
          <PopoverTrigger asChild>
            <button
              type="button"
              onClick={(event) => event.stopPropagation()}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--radius-row)] text-[var(--icon-muted)] opacity-0 hover:bg-[var(--surface-panel)] hover:text-[var(--text-primary)] focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ritual-focus-ring)] group-hover:opacity-100 data-[state=open]:opacity-100"
              aria-label={`More options for ${task.title}`}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </PopoverTrigger>
        </div>
        <div className="mt-3 flex items-center justify-between gap-2 pl-6 text-[11px] text-[var(--text-muted)]">
          <span className="truncate">{contextLabel}</span>
          <span className="shrink-0 tabular-nums">{formatTaskCreatedDate(task.created_at)}</span>
        </div>
      </div>
      <TaskRowMenu task={task} onUpdate={onUpdate} />
    </Popover>
  );
}

export function TaskBoard({
  groups,
  menuTaskId,
  onMenuTaskChange,
  onComplete,
  onUpdate,
  onOpen,
  completingIds = emptyCompletingIds,
}: {
  groups: Array<readonly [string, Task[]]>;
  menuTaskId: string | null;
  onMenuTaskChange: (taskId: string | null) => void;
  onComplete: (task: Task) => void;
  onUpdate: (id: string, patch: TaskUpdateInput) => void;
  onOpen: (task: Task) => void;
  completingIds?: ReadonlySet<string>;
}) {
  return (
    <div className="grid auto-cols-[minmax(240px,1fr)] grid-flow-col gap-3 overflow-x-auto pb-4">
      {groups.map(([group, tasks]) => (
        <section
          key={group}
          className="min-h-[240px] rounded-[var(--radius-card)] border border-[var(--border-subtle)] bg-[var(--surface-panel)] p-2"
        >
          <header className="flex h-8 items-center justify-between gap-2 px-1.5">
            <h2 className="truncate text-[12px] font-medium text-[var(--text-secondary)]">{group}</h2>
            <span className="text-[11px] tabular-nums text-[var(--text-muted)]">{tasks.length}</span>
          </header>
          <div className="space-y-1.5">
            {tasks.map((task) => (
              <TaskCompleteShell key={task.id} completing={completingIds.has(task.id)}>
                <TaskBoardCard
                  task={task}
                  completing={completingIds.has(task.id)}
                  menuOpen={menuTaskId === task.id}
                  onMenuOpenChange={(open) => onMenuTaskChange(open ? task.id : null)}
                  onComplete={() => onComplete(task)}
                  onUpdate={(patch) => onUpdate(task.id, patch)}
                  onOpen={() => onOpen(task)}
                />
              </TaskCompleteShell>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export function TaskRowMenu({
  task,
  onUpdate,
}: {
  task: Task;
  onUpdate: (patch: TaskUpdateInput) => void;
}) {
  return (
    <PopoverContent align="end" className="w-64 p-3" sideOffset={4}>
      <div className="space-y-3">
        <div>
          <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-[rgba(39,37,30,0.45)]">
            Priority
          </label>
          <PillSelect
            value={task.priority}
            options={PRIORITIES.map((item) => ({ value: item, label: item }))}
            onChange={(value) => onUpdate({ priority: value as TaskPriority })}
            className="w-full"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-[rgba(39,37,30,0.45)]">
            Deadline
          </label>
          <InlineFieldInput
            type="date"
            value={dateInputValue(task.due_at)}
            onChange={(event) => {
              const next = event.target.value
                ? new Date(`${event.target.value}T09:00:00`).toISOString()
                : null;
              onUpdate({ due_at: next });
            }}
            className="w-full"
          />
        </div>
        <div className="flex flex-wrap gap-1.5 border-t border-[var(--border-subtle)] pt-3">
          {task.status !== 'canceled' && task.status !== 'completed' ? (
            <button
              type="button"
              onClick={() => onUpdate({ status: 'canceled' })}
              className="inline-flex h-7 items-center gap-1.5 rounded-full px-2 text-[12.5px] text-[var(--text-secondary)] hover:bg-[var(--row-hover)] hover:text-[var(--text-primary)]"
            >
              <CircleX className="h-3.5 w-3.5" />
              Cancel
            </button>
          ) : null}
        </div>
      </div>
    </PopoverContent>
  );
}

export { TasksEmptyState, TasksLoadingSkeleton } from './tasks-empty-state';
