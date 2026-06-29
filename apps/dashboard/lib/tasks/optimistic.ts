import type { Task, TaskUpdateInput } from './types';

export function applyTaskOptimisticPatch(tasks: Task[], taskId: string, patch: TaskUpdateInput): Task[] {
  return tasks.map((task) => (task.id === taskId ? { ...task, ...patch } : task));
}
