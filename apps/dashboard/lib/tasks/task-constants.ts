import type { TaskPriority, TaskStatus } from './types';

export const TASK_VIEWS = [
  { id: 'today', label: 'Today' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'anytime', label: 'Anytime' },
  { id: 'completed', label: 'Completed' },
  { id: 'skipped', label: 'Canceled' },
  { id: 'archived', label: 'Archived' },
] as const;

export const CATEGORY_FILTERS = ['All', 'Health', 'Productivity', 'Learning', 'Experiments'] as const;
export const TASK_STATUS_OPTIONS: ReadonlyArray<{ value: TaskStatus; label: string }> = [
  { value: 'open', label: 'Not Started' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'in_review', label: 'In Review' },
  { value: 'completed', label: 'Completed' },
  { value: 'canceled', label: 'Canceled' },
];
export const PRIORITIES: TaskPriority[] = ['none', 'urgent', 'high', 'medium', 'low'];
export const PRIORITY_FILTERS = [
  { id: 'all', label: 'All priorities' },
  { id: 'urgent', label: 'Urgent' },
  { id: 'high', label: 'High priority' },
  { id: 'medium', label: 'Medium priority' },
  { id: 'low', label: 'Low priority' },
  { id: 'none', label: 'No priority' },
] as const;
export const TASK_SORTS = [
  { id: 'smart', label: 'Smart order' },
  { id: 'created', label: 'Created' },
  { id: 'due', label: 'Due date' },
  { id: 'priority', label: 'Priority' },
  { id: 'updated', label: 'Recently updated' },
  { id: 'title', label: 'Title' },
] as const;
export const LIST_LAYOUT_MODES = [
  { id: 'list', label: 'No grouping' },
  { id: 'project', label: 'Project' },
  { id: 'priority', label: 'Priority' },
] as const;
export const TASK_DISPLAY_MODES = [
  { id: 'list', label: 'Table' },
  { id: 'todo', label: 'Todo' },
  { id: 'board', label: 'Board' },
] as const;
export const TASK_DISPLAY_MODE_STORAGE_KEY = 'ritual:tasks-display-mode';

export type TaskViewId = (typeof TASK_VIEWS)[number]['id'];
export type ListLayoutMode = (typeof LIST_LAYOUT_MODES)[number]['id'];
export type TaskDisplayMode = (typeof TASK_DISPLAY_MODES)[number]['id'];
export type TaskPriorityFilter = (typeof PRIORITY_FILTERS)[number]['id'];
export type TaskSortId = (typeof TASK_SORTS)[number]['id'];

export function isTaskViewId(value: string | null): value is TaskViewId {
  return TASK_VIEWS.some((item) => item.id === value);
}

export function isTaskDisplayMode(value: unknown): value is TaskDisplayMode {
  return TASK_DISPLAY_MODES.some((item) => item.id === value);
}

export function readStoredTaskDisplayMode(): TaskDisplayMode {
  if (typeof window === 'undefined') return 'list';
  try {
    const stored = window.localStorage.getItem(TASK_DISPLAY_MODE_STORAGE_KEY);
    return isTaskDisplayMode(stored) ? stored : 'list';
  } catch {
    return 'list';
  }
}

export function writeStoredTaskDisplayMode(mode: TaskDisplayMode) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(TASK_DISPLAY_MODE_STORAGE_KEY, mode);
  } catch {
    // Private mode and quota failures should not break the page.
  }
}

export function defaultScheduleForView(view: TaskViewId): 'today' | 'upcoming' | 'anytime' {
  if (view === 'upcoming') return 'upcoming';
  if (view === 'anytime') return 'anytime';
  return 'today';
}
