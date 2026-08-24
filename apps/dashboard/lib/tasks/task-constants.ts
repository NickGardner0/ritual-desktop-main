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
  { id: 'list', label: 'List' },
  { id: 'board', label: 'Board' },
] as const;

export type TaskViewId = (typeof TASK_VIEWS)[number]['id'];
export type ListLayoutMode = (typeof LIST_LAYOUT_MODES)[number]['id'];
export type TaskDisplayMode = (typeof TASK_DISPLAY_MODES)[number]['id'];
export type TaskPriorityFilter = (typeof PRIORITY_FILTERS)[number]['id'];
export type TaskSortId = (typeof TASK_SORTS)[number]['id'];

export function isTaskViewId(value: string | null): value is TaskViewId {
  return TASK_VIEWS.some((item) => item.id === value);
}

export function defaultScheduleForView(view: TaskViewId): 'today' | 'upcoming' | 'anytime' {
  if (view === 'upcoming') return 'upcoming';
  if (view === 'anytime') return 'anytime';
  return 'today';
}
