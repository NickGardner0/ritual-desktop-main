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
export const LIST_LAYOUT_MODES = [
  { id: 'list', label: 'List' },
  { id: 'project', label: 'Projects' },
] as const;

export type TaskViewId = (typeof TASK_VIEWS)[number]['id'];
export type ListLayoutMode = (typeof LIST_LAYOUT_MODES)[number]['id'];

export function isTaskViewId(value: string | null): value is TaskViewId {
  return TASK_VIEWS.some((item) => item.id === value);
}

export function defaultScheduleForView(view: TaskViewId): 'today' | 'upcoming' | 'anytime' {
  if (view === 'upcoming') return 'upcoming';
  if (view === 'anytime') return 'anytime';
  return 'today';
}
