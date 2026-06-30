import type { Routine, RoutineCreateInput, RoutineTriggerType, TaskPriority } from './types';

export const WEEKDAYS = [
  { value: 0, label: 'Mon' },
  { value: 1, label: 'Tue' },
  { value: 2, label: 'Wed' },
  { value: 3, label: 'Thu' },
  { value: 4, label: 'Fri' },
  { value: 5, label: 'Sat' },
  { value: 6, label: 'Sun' },
];
export const PRIORITIES: TaskPriority[] = ['none', 'low', 'medium', 'high'];

export function toRoutineEditor(routine: Routine): Routine {
  return {
    ...routine,
    task_template: {
      title: routine.task_template?.title || routine.title,
      notes: routine.task_template?.notes || '',
      project: routine.task_template?.project || '',
      category: routine.task_template?.category || '',
      tags: routine.task_template?.tags || [],
      linked_habit_id: routine.task_template?.linked_habit_id || '',
    },
    trigger_config: routine.trigger_config || { interval: 1 },
  };
}

export function defaultRoutineInput(): RoutineCreateInput {
  return {
    title: 'New routine',
    status: 'scheduled',
    kind: 'task',
    trigger_type: 'daily',
    trigger_config: { interval: 1, hour: 9, minute: 0 },
    priority: 'none',
    tags: [],
    task_template: {
      title: 'New routine task',
      notes: '',
      project: '',
      category: 'Personal',
      tags: [],
      linked_habit_id: null,
    },
  };
}

export function triggerDefaults(trigger: RoutineTriggerType): Record<string, unknown> {
  if (trigger === 'weekly') return { interval: 1, weekdays: [0, 1, 2, 3, 4], hour: 9, minute: 0 };
  if (trigger === 'monthly') return { interval: 1, mode: 'day_of_month', day: 1, hour: 9, minute: 0 };
  if (trigger === 'yearly') return { interval: 1, mode: 'day_of_month', month: 1, day: 1, hour: 9, minute: 0 };
  if (trigger === 'on_completion') return { interval: 1, unit: 'weeks', hour: 9, minute: 0 };
  return { interval: 1, hour: 9, minute: 0 };
}
