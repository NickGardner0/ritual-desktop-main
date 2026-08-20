'use client';

import React from 'react';
import {
  Archive,
  Check,
  Circle,
  Flag,
  Plus,
  SkipForward,
} from 'lucide-react';

import { Button } from '@ritual/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@ritual/ui/popover';
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
  toolbarPillClass,
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
          size="sm"
          onClick={onNewTask}
          className="h-8 !rounded-full px-3.5 font-medium [&_svg]:size-3.5"
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
  overdueLabel,
}: {
  name: string;
  overdueLabel?: string | null;
}) {
  return (
    <div className="mb-2.5 mt-6 flex items-center gap-2 first:mt-0">
      <span
        className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-sm border border-[rgba(39,37,30,0.22)]"
        aria-hidden
      />
      <h2 className="shrink-0 text-[14px] font-medium tracking-[-0.01em] text-[rgba(39,37,30,0.72)]">{name}</h2>
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
      <div className="space-y-1">
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
    <div className="space-y-1">
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
          <div className="flex min-w-0 flex-1 items-baseline gap-2.5">
            <div
              className={cn(
                'min-w-0 shrink truncate text-[15px] font-normal leading-[1.4] text-[#27251E]',
                task.status === 'completed' && 'text-[rgba(39,37,30,0.4)] line-through',
              )}
            >
              {task.title}
            </div>
            {dateLabel && dateLabel !== 'Today' ? (
              <span
                className={cn(
                  'hidden shrink-0 text-[13px] sm:inline',
                  isOverdue ? 'text-[#c44d3a]' : 'text-[rgba(39,37,30,0.48)]',
                )}
              >
                {dateLabel}
              </span>
            ) : null}
            {trailingLabel ? (
              <span className="hidden max-w-[160px] shrink-0 truncate text-[13px] text-[rgba(39,37,30,0.42)] md:inline">
                {trailingLabel}
              </span>
            ) : null}
            {task.status === 'skipped' ? <Circle className="h-3.5 w-3.5 shrink-0 text-[rgba(39,37,30,0.35)]" /> : null}
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

export function TasksEmptyState({ onNewTask }: { onNewTask: () => void }) {
  return (
    <div className="flex h-full items-center justify-center text-center">
      <div>
        <span className="mx-auto flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border-subtle)] bg-white">
          <Circle className="h-4 w-4 text-[rgba(39,37,30,0.35)]" />
        </span>
        <div className="mt-3 text-[17px] font-medium text-[#27251E]">No tasks here</div>
        <p className="mt-1.5 text-[13px] text-[var(--text-muted)]">
          Create a task to start this list.
        </p>
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
      </div>
    </div>
  );
}
