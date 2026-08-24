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
  Flag,
  MoreHorizontal,
  Plus,
  Search,
  SkipForward,
  X,
} from 'lucide-react';

import { Button } from '@ritual/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@ritual/ui/dropdown-menu';
import { Input } from '@ritual/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@ritual/ui/popover';
import { dateInputValue } from '@/lib/tasks/date-format';
import {
  CATEGORY_FILTERS,
  LIST_LAYOUT_MODES,
  PRIORITY_FILTERS,
  PRIORITIES,
  TASK_SORTS,
  TASK_VIEWS,
  isTaskViewId,
  type ListLayoutMode,
  type TaskPriorityFilter,
  type TaskSortId,
  type TaskViewId,
} from '@/lib/tasks/task-constants';
import {
  GroupBySelect,
  HeaderPortal,
  InlineFieldInput,
  PillSelect,
  priorityBars,
  TaskPageHeader,
  TaskRowShell,
  toolbarPillClass,
  ViewTabs,
  ViewPills,
} from '@/lib/tasks/task-ui-shell';
import type { Task, TaskPriority, TaskStatus, TaskUpdateInput } from '@/lib/tasks/types';
import { relativeDayLabel } from '@/lib/tasks/seed-data';
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

export function TasksHeader({
  title,
  view,
  taskCount,
  onViewChange,
}: {
  title: string;
  view: TaskViewId;
  taskCount: number;
  onViewChange: (view: TaskViewId) => void;
}) {
  return (
    <TaskPageHeader
      title={title}
      actions={(
        <span className="text-[12px] font-normal tabular-nums text-[var(--text-muted)]">
          {taskCount} {taskCount === 1 ? 'task' : 'tasks'}
        </span>
      )}
    >
      <ViewTabs value={view} options={TASK_VIEWS} onChange={onViewChange} />
    </TaskPageHeader>
  );
}

export function TasksFilterBar({
  category,
  onCategoryChange,
  searchQuery,
  onSearchQueryChange,
  priorityFilter,
  onPriorityFilterChange,
  sortMode,
  onSortModeChange,
  visibleCount,
  totalCount,
  onClear,
}: {
  category: (typeof CATEGORY_FILTERS)[number];
  onCategoryChange: (category: (typeof CATEGORY_FILTERS)[number]) => void;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  priorityFilter: TaskPriorityFilter;
  onPriorityFilterChange: (priority: TaskPriorityFilter) => void;
  sortMode: TaskSortId;
  onSortModeChange: (sort: TaskSortId) => void;
  visibleCount: number;
  totalCount: number;
  onClear: () => void;
}) {
  const hasRefinements = Boolean(
    searchQuery.trim()
    || category !== 'All'
    || priorityFilter !== 'all'
    || sortMode !== 'smart',
  );

  return (
    <div className="space-y-3 pb-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] max-w-[360px] flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--icon-muted)]"
            aria-hidden="true"
          />
          <Input
            density="compact"
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onSearchQueryChange('');
            }}
            placeholder="Search tasks"
            aria-label="Search tasks"
            className="h-8 rounded-full border-[var(--border-floating)] bg-[var(--surface-raised)] pl-8 text-[13px] shadow-none"
          />
        </div>

        <PillSelect
          value={sortMode}
          options={TASK_SORTS.map((item) => ({ value: item.id, label: item.label }))}
          onChange={onSortModeChange}
          className="h-8 min-w-[132px] !rounded-full"
        />
        <PillSelect
          value={priorityFilter}
          options={PRIORITY_FILTERS.map((item) => ({ value: item.id, label: item.label }))}
          onChange={onPriorityFilterChange}
          className="h-8 min-w-[132px] !rounded-full"
        />

        {hasRefinements ? (
          <Button
            type="button"
            variant="ghost"
            size="compact"
            onClick={onClear}
            className="h-8 px-2 text-[12px] font-normal text-[var(--text-muted)]"
          >
            <X className="h-3.5 w-3.5" />
            Clear
          </Button>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <ViewPills
          value={category}
          options={CATEGORY_FILTERS}
          onChange={(value) => onCategoryChange(value as (typeof CATEGORY_FILTERS)[number])}
        />
        {visibleCount !== totalCount ? (
          <span className="shrink-0 text-[11px] tabular-nums text-[var(--text-muted)]">
            Showing {visibleCount} of {totalCount}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function TasksToolbarActions({
  layoutMode,
  onLayoutModeChange,
  onNewTask,
}: {
  layoutMode: ListLayoutMode;
  onLayoutModeChange: (mode: ListLayoutMode) => void;
  onNewTask: () => void;
}) {
  return (
    <HeaderPortal>
      <div className="flex items-center gap-2">
        <GroupBySelect
          value={layoutMode}
          options={LIST_LAYOUT_MODES}
          onChange={(value) => onLayoutModeChange(value as ListLayoutMode)}
        />
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
      </div>
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
    const label = relativeDayLabel(task.scheduled_for || task.due_at);
    if (label.endsWith('ago')) return label;
  }
  return null;
}

const TASK_ROW_GRID_CLASS = cn(
  'grid items-center gap-2',
  'grid-cols-[minmax(0,1fr)_96px_28px]',
  'md:grid-cols-[minmax(220px,1fr)_96px_88px_28px]',
  'xl:grid-cols-[minmax(240px,1fr)_96px_88px_128px_88px_28px]',
);

const STATUS_OPTIONS: ReadonlyArray<{ value: TaskStatus; label: string }> = [
  { value: 'open', label: 'Open' },
  { value: 'completed', label: 'Completed' },
  { value: 'skipped', label: 'Skipped' },
  { value: 'archived', label: 'Archived' },
];

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  none: 'None',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

function TaskStatusIcon({ status }: { status: TaskStatus }) {
  if (status === 'completed') return <CircleCheck className="h-3.5 w-3.5 text-[var(--text-primary)]" />;
  if (status === 'skipped') return <SkipForward className="h-3.5 w-3.5 text-[var(--icon-muted)]" />;
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
  const label = STATUS_OPTIONS.find((option) => option.value === task.status)?.label || task.status;
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
        {STATUS_OPTIONS.map((option) => (
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
      <span className="hidden xl:block">Project</span>
      <span className="hidden xl:block">Due</span>
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
}: {
  group: string;
  tasks: Task[];
  menuTaskId: string | null;
  onMenuTaskChange: (taskId: string | null) => void;
  onComplete: (task: Task) => void;
  onUpdate: (id: string, patch: TaskUpdateInput) => void;
  onOpen: (task: Task) => void;
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
            <TaskRow
              key={task.id}
              task={task}
              menuOpen={menuTaskId === task.id}
              onMenuOpenChange={(open) => onMenuTaskChange(open ? task.id : null)}
              onComplete={() => onComplete(task)}
              onUpdate={(patch) => onUpdate(task.id, patch)}
              onOpen={() => onOpen(task)}
            />
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
}: {
  tasks: Task[];
  menuTaskId: string | null;
  onMenuTaskChange: (taskId: string | null) => void;
  onComplete: (task: Task) => void;
  onUpdate: (id: string, patch: TaskUpdateInput) => void;
  onOpen: (task: Task) => void;
}) {
  return (
    <div className="space-y-0.5">
      {tasks.map((task) => (
        <TaskRow
          key={task.id}
          task={task}
          menuOpen={menuTaskId === task.id}
          onMenuOpenChange={(open) => onMenuTaskChange(open ? task.id : null)}
          onComplete={() => onComplete(task)}
          onUpdate={(patch) => onUpdate(task.id, patch)}
          onOpen={() => onOpen(task)}
        />
      ))}
    </div>
  );
}

export function TaskRow({
  task,
  menuOpen,
  onMenuOpenChange,
  onComplete,
  onUpdate,
  onOpen,
}: {
  task: Task;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  onComplete: () => void;
  onUpdate: (patch: TaskUpdateInput) => void;
  onOpen: () => void;
}) {
  const dateLabel = relativeDayLabel(task.scheduled_for || task.due_at);
  const isOverdue = dateLabel.endsWith('ago');
  const projectLabel = task.project || task.category || 'Inbox';

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
          } else if (event.key.toLowerCase() === 's' && task.status === 'open') {
            onUpdate({ status: 'skipped' });
          } else if (event.key.toLowerCase() === 'a' && task.status !== 'archived') {
            onUpdate({ status: 'archived' });
          }
        }}
        className={cn(TASK_ROW_GRID_CLASS, 'min-h-10 cursor-default px-2.5 py-1')}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onComplete();
            }}
            className={cn(
              'flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border',
              task.status === 'completed'
                ? 'border-[#27251E] bg-[#27251E] text-white'
                : 'border-[rgba(39,37,30,0.38)] bg-white text-transparent hover:border-[#27251E]',
            )}
            aria-label={`Complete ${task.title}`}
            aria-pressed={task.status === 'completed'}
          >
            <Check className="h-3 w-3" />
          </button>
          <div
            className={cn(
              'min-w-0 truncate text-[14px] font-normal leading-5 text-[var(--text-primary)]',
              task.status === 'completed' && 'text-[var(--text-muted)] line-through',
            )}
          >
            {task.title}
          </div>
        </div>

        <TaskStatusControl task={task} onUpdate={onUpdate} />

        <div className="hidden min-w-0 md:block">
          <TaskPriorityControl task={task} onUpdate={onUpdate} />
        </div>

        <span className="hidden min-w-0 truncate text-[12px] text-[var(--text-muted)] xl:block">
          {projectLabel}
        </span>

        <span
          className={cn(
            'hidden min-w-0 truncate text-[12px] tabular-nums xl:block',
            isOverdue ? 'text-[var(--ritual-status-danger)]' : 'text-[var(--text-muted)]',
          )}
        >
          {dateLabel || '—'}
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
            Date
          </label>
          <InlineFieldInput
            type="date"
            value={dateInputValue(task.scheduled_for || task.due_at)}
            onChange={(event) => {
              const next = event.target.value
                ? new Date(`${event.target.value}T09:00:00`).toISOString()
                : null;
              onUpdate({ scheduled_for: next, due_at: next });
            }}
            className="w-full"
          />
        </div>
        <div className="flex flex-wrap gap-1.5 border-t border-[var(--border-subtle)] pt-3">
          {task.status === 'open' ? (
            <button
              type="button"
              onClick={() => onUpdate({ status: 'skipped' })}
              className="inline-flex h-7 items-center gap-1.5 rounded-full px-2 text-[12.5px] text-[var(--text-secondary)] hover:bg-[var(--row-hover)] hover:text-[var(--text-primary)]"
            >
              <SkipForward className="h-3.5 w-3.5" />
              Skip
            </button>
          ) : null}
          {task.status !== 'archived' ? (
            <button
              type="button"
              onClick={() => onUpdate({ status: 'archived' })}
              className="inline-flex h-7 items-center gap-1.5 rounded-full px-2 text-[12.5px] text-[var(--text-secondary)] hover:bg-[var(--row-hover)] hover:text-[var(--text-primary)]"
            >
              <Archive className="h-3.5 w-3.5" />
              Archive
            </button>
          ) : null}
        </div>
      </div>
    </PopoverContent>
  );
}

export function TasksLoadingSkeleton() {
  return (
    <div className="space-y-2">
      {[0, 1, 2, 3].map((item) => (
        <div key={item} className="h-8 animate-pulse rounded-[var(--radius-row)] bg-[var(--surface-panel)]" />
      ))}
    </div>
  );
}

export function TasksEmptyState({
  onNewTask,
  onClearFilters,
  filtered = false,
}: {
  onNewTask: () => void;
  onClearFilters?: () => void;
  filtered?: boolean;
}) {
  return (
    <div className="flex h-full items-center justify-center text-center">
      <div>
        <span className="mx-auto flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[var(--surface-raised)]">
          {filtered ? (
            <Search className="h-4 w-4 text-[var(--icon-muted)]" />
          ) : (
            <Circle className="h-4 w-4 text-[var(--icon-muted)]" />
          )}
        </span>
        <div className="mt-3 text-[17px] font-medium text-[var(--text-primary)]">
          {filtered ? 'No matching tasks' : 'No tasks here'}
        </div>
        <p className="mt-1.5 text-[13px] text-[var(--text-muted)]">
          {filtered ? 'Try clearing a filter or using a different search.' : 'Create a task to start this list.'}
        </p>
        {filtered && onClearFilters ? (
          <Button
            type="button"
            variant="outline"
            size="compact"
            onClick={onClearFilters}
            className={cn(toolbarPillClass, 'mt-4 font-medium')}
          >
            <X className="h-3.5 w-3.5" />
            Clear filters
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="compact"
            onClick={onNewTask}
            className={cn(toolbarPillClass, 'mt-4 font-medium')}
          >
            <Plus className="h-3.5 w-3.5" />
            New task
          </Button>
        )}
      </div>
    </div>
  );
}
