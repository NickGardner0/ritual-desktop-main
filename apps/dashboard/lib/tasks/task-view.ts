import type { Task, TaskCreateInput, TaskUpdateInput } from './types';
import type { TaskViewId } from './task-constants';

export function isSeedTaskId(id: string): boolean {
  return id.startsWith('seed-task-');
}

export function isClosedTaskView(view: TaskViewId): boolean {
  return view === 'completed' || view === 'skipped' || view === 'archived';
}

export function isTaskInView(task: Task, view: TaskViewId): boolean {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const tomorrowStart = todayStart + 24 * 60 * 60 * 1000;
  const scheduled = task.scheduled_for ? new Date(task.scheduled_for).getTime() : null;
  const due = task.due_at ? new Date(task.due_at).getTime() : null;
  if (view === 'completed') return task.status === 'completed';
  if (view === 'skipped') return task.status === 'canceled' || task.status === 'skipped';
  if (view === 'archived') return task.status === 'archived';
  if (!['open', 'in_progress', 'in_review'].includes(task.status)) return false;
  if (view === 'anytime') return !scheduled && !due;
  if (view === 'upcoming') {
    return Boolean((scheduled && scheduled >= tomorrowStart) || (due && due >= tomorrowStart));
  }
  return Boolean((scheduled && scheduled < tomorrowStart) || (due && due < tomorrowStart));
}

export function filterTasksForView(tasks: Task[], view: TaskViewId, category: string): Task[] {
  return tasks.filter((task) => isTaskInView(task, view) && (category === 'All' || task.category === category));
}

export function createInputFromTask(task: Task, patch: TaskUpdateInput = {}): TaskCreateInput {
  return {
    title: patch.title ?? task.title,
    notes: patch.notes !== undefined ? patch.notes : task.notes,
    status: patch.status ?? task.status,
    priority: patch.priority ?? task.priority,
    due_at: patch.due_at !== undefined ? patch.due_at : task.due_at,
    scheduled_for: patch.scheduled_for !== undefined ? patch.scheduled_for : task.scheduled_for,
    source: task.source,
    project: patch.project !== undefined ? patch.project : task.project,
    category: patch.category !== undefined ? patch.category : task.category,
    tags: patch.tags ?? task.tags,
  };
}

export function selectTasksForQuery({
  stored,
  seeds,
  view,
  category,
}: {
  stored: Task[];
  seeds: Task[];
  view: TaskViewId;
  category: string;
}): Task[] {
  const fromStore = filterTasksForView(stored, view, category);
  if (fromStore.length > 0) return fromStore;
  if (isClosedTaskView(view)) return [];
  return filterTasksForView(seeds, view, category);
}

function completionTime(task: Task): number {
  return Date.parse(task.completed_at || task.updated_at || task.created_at || '') || 0;
}

export function formatCompletedTaskDate(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const currentYear = new Date().getFullYear();
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() === currentYear ? {} : { year: 'numeric' }),
  }).format(date);
}

export type CompletedTaskMonthGroup = {
  monthKey: string;
  label: string;
  tasks: Task[];
};

export function groupCompletedTasksByMonth(
  tasks: Task[],
  now: Date = new Date(),
): CompletedTaskMonthGroup[] {
  const groups = new Map<string, Task[]>();
  for (const task of tasks) {
    const date = new Date(task.completed_at || task.updated_at || task.created_at || now.toISOString());
    if (Number.isNaN(date.getTime())) continue;
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const existing = groups.get(monthKey);
    if (existing) existing.push(task);
    else groups.set(monthKey, [task]);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([monthKey, monthTasks]) => {
      const [year, month] = monthKey.split('-').map(Number);
      const labelDate = new Date(year, (month || 1) - 1, 1);
      const label = new Intl.DateTimeFormat(undefined, {
        month: 'long',
        ...(year === now.getFullYear() ? {} : { year: 'numeric' }),
      }).format(labelDate);
      return {
        monthKey,
        label,
        tasks: monthTasks.slice().sort((a, b) => completionTime(b) - completionTime(a)),
      };
    });
}
