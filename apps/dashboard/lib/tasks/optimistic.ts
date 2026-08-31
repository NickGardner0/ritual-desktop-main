import type { Task, TaskUpdateInput } from './types';

export function applyTaskOptimisticPatch(
  tasks: Task[],
  taskId: string,
  patch: TaskUpdateInput,
  now: string = new Date().toISOString(),
): Task[] {
  return tasks.map((task) => {
    if (task.id !== taskId) return task;
    const next = { ...task, ...patch };
    if (patch.status === 'completed') {
      next.completed_at = patch.completed_at ?? task.completed_at ?? now;
    } else if (patch.status) {
      next.completed_at = patch.completed_at ?? null;
    }
    return next;
  });
}
