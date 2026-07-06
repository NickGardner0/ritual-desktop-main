'use client';

import React from 'react';
import {
  Archive,
  Check,
  Circle,
  Flag,
  MoreHorizontal,
  Plus,
  RotateCw,
  SkipForward,
} from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { dateInputValue } from '@/lib/tasks/date-format';
import {
  CATEGORY_FILTERS,
  LIST_LAYOUT_MODES,
  PRIORITIES,
  TASK_VIEWS,
  isTaskViewId,
  type ListLayoutMode,
  type TaskViewId,
} from '@/lib/tasks/task-constants';
import {
  GroupBySelect,
  HeaderPortal,
  InlineFieldInput,
  PillSelect,
  TaskPageHeader,
  TaskRowShell,
  ToolbarIconButton,
  ViewPills,
  taskContentMaxClass,
} from '@/lib/tasks/task-ui-shell';
import type { Task, TaskPriority, TaskUpdateInput } from '@/lib/tasks/types';
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

export function TasksHeader({ title }: { title: string }) {
  return <TaskPageHeader title={title} />;
}

export function TasksFilterBar({
  category,
  onCategoryChange,
}: {
  category: (typeof CATEGORY_FILTERS)[number];
  onCategoryChange: (category: (typeof CATEGORY_FILTERS)[number]) => void;
}) {
  return (
    <div className="pb-4">
      <ViewPills
        value={category}
        options={CATEGORY_FILTERS}
        onChange={(value) => onCategoryChange(value as (typeof CATEGORY_FILTERS)[number])}
      />
    </div>
  );
}

export function TasksToolbarActions({
  layoutMode,
  onLayoutModeChange,
  onNewTask,
  onSyncRoutines,
  syncPending,
}: {
  layoutMode: ListLayoutMode;
  onLayoutModeChange: (mode: ListLayoutMode) => void;
  onNewTask: () => void;
  onSyncRoutines: () => void;
  syncPending: boolean;
}) {
  return (
    <HeaderPortal>
      <div className="flex items-center gap-2">
        <GroupBySelect
          value={layoutMode}
          options={LIST_LAYOUT_MODES}
          onChange={(value) => onLayoutModeChange(value as ListLayoutMode)}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <ToolbarIconButton aria-label="More actions" title="More actions">
              <MoreHorizontal className="h-3.5 w-3.5" />
            </ToolbarIconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={6} className="w-44">
            <DropdownMenuItem onClick={onSyncRoutines} disabled={syncPending}>
              <RotateCw className={cn('mr-2 h-3.5 w-3.5', syncPending && 'animate-spin')} />
              Sync routines
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          type="button"
          onClick={onNewTask}
          className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-gray-300 bg-white px-2.5 text-[12.5px] font-medium text-[#27251E] shadow-sm hover:bg-[#F5F5F5] focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-1"
        >
          <Plus className="h-3.5 w-3.5" />
          New task
        </button>
      </div>
    </HeaderPortal>
  );
}

function ProjectGroupHeader({
  name,
  overdueLabel,
}: {
  name: string;
  overdueLabel?: string | null;
}) {
  return (
    <div className="mb-2.5 mt-6 flex items-center gap-2 first:mt-0">
      <span
        className="flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-sm border border-[rgba(39,37,30,0.2)]"
        aria-hidden
      />
      <h2 className="shrink-0 text-[13px] font-medium tracking-[-0.01em] text-[rgba(39,37,30,0.72)]">{name}</h2>
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

export function TaskGroupSection({
  group,
  tasks,
  menuTaskId,
  onMenuTaskChange,
  onComplete,
  onUpdate,
}: {
  group: string;
  tasks: Task[];
  menuTaskId: string | null;
  onMenuTaskChange: (taskId: string | null) => void;
  onComplete: (task: Task) => void;
  onUpdate: (id: string, patch: TaskUpdateInput) => void;
}) {
  const overdueLabel = groupOverdueLabel(tasks);

  return (
    <section style={{ marginBottom: 'var(--task-group-gap, 32px)' }}>
      <ProjectGroupHeader name={group} overdueLabel={overdueLabel} />
      <div className="space-y-0.5">
        {tasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            menuOpen={menuTaskId === task.id}
            onMenuOpenChange={(open) => onMenuTaskChange(open ? task.id : null)}
            onComplete={() => onComplete(task)}
            onUpdate={(patch) => onUpdate(task.id, patch)}
          />
        ))}
      </div>
    </section>
  );
}

export function TaskListSection({
  tasks,
  menuTaskId,
  onMenuTaskChange,
  onComplete,
  onUpdate,
}: {
  tasks: Task[];
  menuTaskId: string | null;
  onMenuTaskChange: (taskId: string | null) => void;
  onComplete: (task: Task) => void;
  onUpdate: (id: string, patch: TaskUpdateInput) => void;
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
}: {
  task: Task;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  onComplete: () => void;
  onUpdate: (patch: TaskUpdateInput) => void;
}) {
  const dateLabel = relativeDayLabel(task.scheduled_for || task.due_at);
  const isOverdue = dateLabel.endsWith('ago');
  const trailingLabel = task.project || task.category;

  return (
    <Popover open={menuOpen} onOpenChange={onMenuOpenChange}>
      <PopoverTrigger asChild>
        <TaskRowShell
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return;
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onMenuOpenChange(true);
            } else if (event.key.toLowerCase() === 's' && task.status === 'open') {
              onUpdate({ status: 'skipped' });
            } else if (event.key.toLowerCase() === 'a' && task.status !== 'archived') {
              onUpdate({ status: 'archived' });
            }
          }}
        >
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onComplete();
            }}
            className={cn(
              'flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded-sm border',
              task.status === 'completed'
                ? 'border-[#27251E] bg-[#27251E] text-white'
                : 'border-[rgba(39,37,30,0.28)] bg-white text-transparent hover:border-[#27251E]',
            )}
            aria-label={`Complete ${task.title}`}
            aria-pressed={task.status === 'completed'}
          >
            <Check className="h-3 w-3" />
          </button>
          <div className="min-w-0">
            <div
              className={cn(
                'truncate text-[14px] font-normal leading-[1.35] text-[#27251E]',
                task.status === 'completed' && 'text-[rgba(39,37,30,0.4)] line-through',
              )}
            >
              {task.title}
            </div>
          </div>
          <div className="flex min-w-0 items-center justify-end gap-3 text-[12px] text-[rgba(39,37,30,0.42)]">
            {isOverdue && dateLabel ? (
              <span className="hidden text-[#c44d3a] sm:inline">{dateLabel}</span>
            ) : null}
            {trailingLabel ? (
              <span className="hidden max-w-[180px] truncate md:block">{trailingLabel}</span>
            ) : null}
            {!isOverdue && dateLabel ? (
              <span className="hidden sm:inline">{dateLabel}</span>
            ) : null}
            {task.status === 'skipped' ? <Circle className="h-3.5 w-3.5 text-[rgba(39,37,30,0.35)]" /> : null}
          </div>
        </TaskRowShell>
      </PopoverTrigger>
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
    <PopoverContent align="start" className="w-64 p-3" sideOffset={4}>
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
              className="inline-flex h-7 items-center gap-1.5 rounded-sm px-2 text-[12.5px] text-[rgba(39,37,30,0.7)] hover:bg-[#F3F3F3]"
            >
              <SkipForward className="h-3.5 w-3.5" />
              Skip
            </button>
          ) : null}
          {task.status !== 'archived' ? (
            <button
              type="button"
              onClick={() => onUpdate({ status: 'archived' })}
              className="inline-flex h-7 items-center gap-1.5 rounded-sm px-2 text-[12.5px] text-[rgba(39,37,30,0.7)] hover:bg-[#F3F3F3]"
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
        <div key={item} className="h-8 animate-pulse rounded-sm bg-[#f3f3f2]" />
      ))}
    </div>
  );
}

export function TasksEmptyState({ onNewTask }: { onNewTask: () => void }) {
  return (
    <div className="flex h-full items-center justify-center text-center">
      <div>
        <span className="mx-auto flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border-subtle)] bg-white">
          <Circle className="h-4 w-4 text-[rgba(39,37,30,0.35)]" />
        </span>
        <div className="mt-3 text-[17px] font-medium text-[#27251E]">No tasks here</div>
        <p className="mt-1.5 text-[13px] text-[rgba(39,37,30,0.45)]">
          Create a task or sync routines from the menu.
        </p>
        <button
          type="button"
          onClick={onNewTask}
          className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-sm border border-gray-300 bg-white px-3 text-[13px] font-medium text-[#27251E] shadow-sm hover:bg-[#F5F5F5]"
        >
          <Plus className="h-3.5 w-3.5" />
          New task
        </button>
      </div>
    </div>
  );
}
