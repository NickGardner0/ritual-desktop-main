'use client';

import { Circle, Plus, Search, X } from 'lucide-react';

import { Button } from '@ritual/ui/button';
import { toolbarPillClass } from '@/lib/tasks/task-ui-shell';
import { cn } from '@/lib/utils';

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
  title,
  description,
}: {
  onNewTask: () => void;
  onClearFilters?: () => void;
  filtered?: boolean;
  title?: string;
  description?: string;
}) {
  const heading = title ?? (filtered ? 'No matching tasks' : 'No tasks here');
  const body = description ?? (filtered
    ? 'Try clearing a filter or choosing a different scope.'
    : 'Create a task to start this list.');
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
          {heading}
        </div>
        <p className="mt-1.5 text-[13px] text-[var(--text-muted)]">
          {body}
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
