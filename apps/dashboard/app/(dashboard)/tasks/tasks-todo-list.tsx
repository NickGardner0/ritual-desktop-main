'use client';

import React, { useState } from 'react';
import {
  ArrowUpRight,
  Calendar as CalendarIcon,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Trash2,
  X,
} from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@ritual/ui/dropdown-menu';
import { Calendar } from '@/components/ui/calendar';
import { scheduleIsoForDate } from '@/lib/tasks/date-format';
import { relativeDayLabel } from '@/lib/tasks/seed-data';
import { groupTasksForTodoView, type TodoTaskGroupId } from '@/lib/tasks/task-view';
import { TaskCompleteShell, TaskCompleteTitle } from '@/lib/tasks/task-complete-effect';
import { TaskRowShell } from '@/lib/tasks/task-ui-shell';
import type { Task, TaskUpdateInput } from '@/lib/tasks/types';
import { cn } from '@/lib/utils';

function taskTodoMetadata(task: Task): string | null {
  const dateLabel = relativeDayLabel(task.scheduled_for || task.due_at);
  const context = task.project || task.category;
  if (dateLabel && context) return `${dateLabel} → ${context}`;
  return dateLabel || context || null;
}

function selectedScheduleDate(task: Task): Date | undefined {
  const value = task.scheduled_for || task.due_at;
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

const emptyCompletingIds: ReadonlySet<string> = new Set();

export function TaskTodoList({
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
  const groups = groupTasksForTodoView(tasks);
  const [collapsed, setCollapsed] = useState<Partial<Record<TodoTaskGroupId, boolean>>>({});

  return (
    <div className="pb-8">
      {groups.map((group) => {
        const isCollapsed = Boolean(collapsed[group.id]);
        return (
          <section key={group.id} className="mt-6 first:mt-1">
            <button
              type="button"
              onClick={() => setCollapsed((current) => ({
                ...current,
                [group.id]: !current[group.id],
              }))}
              className="mb-1 flex items-center gap-1.5 rounded-[var(--radius-row)] px-1 py-1 text-left hover:bg-[var(--row-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ritual-focus-ring)]"
              aria-expanded={!isCollapsed}
            >
              {isCollapsed ? (
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--icon-muted)]" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--icon-muted)]" />
              )}
              <h2
                className={cn(
                  'text-[13px] font-medium',
                  group.id === 'overdue'
                    ? 'text-[var(--ritual-status-danger)]'
                    : 'text-[var(--text-secondary)]',
                )}
              >
                {group.label}
              </h2>
              <span className="text-[11px] tabular-nums text-[var(--text-muted)]">{group.tasks.length}</span>
            </button>
            {isCollapsed ? null : (
              <div>
                {group.tasks.map((task) => (
                  <TaskCompleteShell key={task.id} completing={completingIds.has(task.id)}>
                    <TaskTodoRow
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
            )}
          </section>
        );
      })}
    </div>
  );
}

function TaskTodoRow({
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
  const metadata = taskTodoMetadata(task);
  const completed = completing || task.status === 'completed';
  const hasDate = Boolean(task.scheduled_for || task.due_at);

  return (
    <DropdownMenu open={menuOpen} onOpenChange={onMenuOpenChange}>
      <TaskRowShell
        tabIndex={0}
        onClick={onOpen}
        onContextMenu={(event) => {
          event.preventDefault();
          onMenuOpenChange(true);
        }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === 'Enter') {
            event.preventDefault();
            onOpen();
          }
        }}
        className="flex min-h-11 cursor-default items-start px-1 py-2"
      >
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            if (!completing) onComplete();
          }}
          className={cn(
            'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border',
            completed
              ? 'border-[var(--text-primary)] bg-[var(--text-primary)] text-[var(--surface-raised)]'
              : 'border-[var(--border-floating)] bg-[var(--surface-raised)] text-transparent hover:border-[var(--text-primary)]',
          )}
          aria-label={`Complete ${task.title}`}
          aria-pressed={completed}
          disabled={completing}
        >
          <Check className={cn('h-3 w-3', completing && 'ritual-task-complete-check')} />
        </button>
        <div className="min-w-0 flex-1">
          {completing ? (
            <TaskCompleteTitle
              title={task.title}
              className="block max-w-full truncate text-[14px] leading-5"
            />
          ) : (
            <div
              className={cn(
                'truncate text-[14px] leading-5 text-[var(--text-primary)]',
                task.status === 'completed' && 'text-[var(--text-muted)] line-through',
              )}
            >
              {task.title}
            </div>
          )}
          {metadata ? (
            <div className="mt-0.5 truncate text-[12px] leading-4 text-[var(--text-muted)]">
              {metadata}
            </div>
          ) : null}
        </div>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            onClick={(event) => event.stopPropagation()}
            className="mt-[-2px] flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-row)] text-[var(--icon-muted)] opacity-0 hover:bg-[var(--row-hover)] hover:text-[var(--text-primary)] focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ritual-focus-ring)] group-hover/row:opacity-100 data-[state=open]:bg-[var(--row-hover)] data-[state=open]:opacity-100"
            aria-label={`More options for ${task.title}`}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
      </TaskRowShell>
      <DropdownMenuContent align="end" className="w-56" onClick={(event) => event.stopPropagation()}>
        <DropdownMenuItem
          onSelect={() => onOpen()}
        >
          <ArrowUpRight className="h-3.5 w-3.5" />
          Open
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onComplete}>
          <Check className="h-3.5 w-3.5" />
          {completed ? 'Reopen task' : 'Complete task'}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => onUpdate({ scheduled_for: scheduleIsoForDate(new Date()) })}
        >
          <CalendarDays className="h-3.5 w-3.5" />
          Schedule for today
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <CalendarIcon className="h-3.5 w-3.5" />
            Schedule...
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="p-0">
            <div
              className="p-1"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              <Calendar
                mode="single"
                selected={selectedScheduleDate(task)}
                onSelect={(date) => {
                  if (!date) return;
                  onUpdate({ scheduled_for: scheduleIsoForDate(date) });
                  onMenuOpenChange(false);
                }}
              />
            </div>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {hasDate ? (
          <DropdownMenuItem
            onSelect={() => onUpdate({ due_at: null, scheduled_for: null })}
          >
            <X className="h-3.5 w-3.5" />
            Clear date
          </DropdownMenuItem>
        ) : null}
        {task.status === 'canceled' ? null : (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-[var(--ritual-status-danger)]"
              onSelect={() => onUpdate({ status: 'canceled' })}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete task
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
