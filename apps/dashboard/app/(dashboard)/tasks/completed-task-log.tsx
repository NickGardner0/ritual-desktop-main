'use client';

import { Check } from 'lucide-react';

import { formatCompletedTaskDate, groupCompletedTasksByMonth } from '@/lib/tasks/task-view';
import type { Task } from '@/lib/tasks/types';

export function CompletedTaskLog({
  tasks,
  onComplete,
  onOpen,
}: {
  tasks: Task[];
  onComplete: (task: Task) => void;
  onOpen: (task: Task) => void;
}) {
  const groups = groupCompletedTasksByMonth(tasks);

  return (
    <div className="pb-8">
      {groups.map((group) => (
        <section key={group.monthKey} className="mt-8 first:mt-1">
          <header className="mb-2 flex items-center gap-3">
            <h2 className="shrink-0 text-[15px] font-semibold tracking-[-0.02em] text-[var(--text-primary)]">
              {group.label}
            </h2>
            <div className="h-px min-w-0 flex-1 bg-[var(--border-subtle)]" />
          </header>
          <div>
            {group.tasks.map((task) => {
              const completedLabel = formatCompletedTaskDate(task.completed_at || task.updated_at);
              return (
                <div
                  key={task.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpen(task)}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onOpen(task);
                    }
                  }}
                  className="group/row flex min-h-10 cursor-default items-center gap-2.5 rounded-[var(--radius-row)] px-1 py-1.5 hover:bg-[var(--row-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ritual-focus-ring)]"
                >
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onComplete(task);
                    }}
                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-[var(--text-primary)] bg-[var(--text-primary)] text-[var(--surface-raised)]"
                    aria-label={`Mark ${task.title} as not completed`}
                    aria-pressed="true"
                  >
                    <Check className="h-3 w-3" />
                  </button>
                  <span className="w-[4.5rem] shrink-0 text-[13px] tabular-nums text-[var(--text-muted)]">
                    {completedLabel || '—'}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[14px] leading-5 text-[var(--text-primary)]">
                    {task.title}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
