import type { TaskPriority } from './types';

export const TASK_VIEWS = [
  { id: 'today', label: 'Today' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'anytime', label: 'Anytime' },
  { id: 'completed', label: 'Completed' },
  { id: 'skipped', label: 'Skipped' },
  { id: 'archived', label: 'Archived' },
] as const;

export const CATEGORY_FILTERS = ['All', 'Health', 'Work', 'Personal', 'Finance', 'Experiments', 'AI'] as const;
export const PRIORITIES: TaskPriority[] = ['none', 'low', 'medium', 'high'];
export const PRIORITY_FILTERS = [
  { id: 'all', label: 'All priorities' },
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
