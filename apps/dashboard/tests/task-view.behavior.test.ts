import { describe, expect, it } from 'vitest';

import {
  buildOptimisticTask,
  buildTaskCreateOutboxItem,
  mergeTaskSources,
} from '../lib/tasks/local-first-writes';
import { applyTaskOptimisticPatch } from '../lib/tasks/optimistic';
import {
  createInputFromTask,
  filterTasksForView,
  groupCompletedTasksByMonth,
  isSeedTaskId,
  selectTasksForQuery,
} from '../lib/tasks/task-view';
import type { Task } from '../lib/tasks/types';

const NOW = '2026-06-29T12:00:00.000Z';

const baseTask: Task = {
  id: 'task-1',
  user_id: 'user-1',
  title: 'Draft weekly review',
  notes: null,
  status: 'open',
  priority: 'none',
  due_at: null,
  scheduled_for: null,
  completed_at: null,
  source: 'manual',
  project: null,
  category: 'Work',
  tags: ['review'],
  routine_id: null,
  routine_run_id: null,
  linked_habit_id: null,
  linked_artifact_id: null,
  client_event_id: null,
  created_at: '2026-06-29T12:00:00Z',
  updated_at: '2026-06-29T12:00:00Z',
};

describe('task completion views', () => {
  it('drops completed tasks out of the today view immediately', () => {
    const dueToday: Task = {
      ...baseTask,
      due_at: new Date().toISOString(),
      scheduled_for: new Date().toISOString(),
    };
    const patched = applyTaskOptimisticPatch([dueToday], 'task-1', { status: 'completed' }, NOW);
    expect(filterTasksForView([dueToday], 'today', 'All')).toHaveLength(1);
    expect(filterTasksForView(patched, 'today', 'All')).toHaveLength(0);
    expect(filterTasksForView(patched, 'completed', 'All')).toHaveLength(1);
    expect(patched[0].completed_at).toBe(NOW);
  });

  it('uses seed tasks only for empty active lists, not completed', () => {
    const seed: Task = {
      ...baseTask,
      id: 'seed-task-cpa',
      status: 'open',
      due_at: NOW,
      scheduled_for: NOW,
    };
    const storedCompleted: Task = {
      ...baseTask,
      id: 'real-1',
      status: 'completed',
      completed_at: NOW,
    };

    expect(
      selectTasksForQuery({ stored: [], seeds: [seed], view: 'today', category: 'All' })[0]?.id,
    ).toBe('seed-task-cpa');
    expect(
      selectTasksForQuery({ stored: [], seeds: [seed, storedCompleted], view: 'completed', category: 'All' }),
    ).toEqual([]);
    expect(
      selectTasksForQuery({ stored: [storedCompleted], seeds: [seed], view: 'completed', category: 'All' })[0]?.id,
    ).toBe('real-1');
  });

  it('groups completed tasks by month, newest first', () => {
    const august: Task = {
      ...baseTask,
      id: 'a',
      status: 'completed',
      completed_at: '2026-08-20T12:00:00.000Z',
      title: 'August task',
    };
    const june: Task = {
      ...baseTask,
      id: 'b',
      status: 'completed',
      completed_at: '2026-06-30T12:00:00.000Z',
      title: 'June task',
    };
    const groups = groupCompletedTasksByMonth([june, august], new Date('2026-08-31T12:00:00.000Z'));
    expect(groups[0].label).toBe('August');
    expect(groups[1].label).toBe('June');
    expect(groups[0].tasks[0].id).toBe('a');
  });

  it('promotes seed placeholders through create payloads', () => {
    expect(isSeedTaskId('seed-task-cpa')).toBe(true);
    expect(isSeedTaskId('task-1')).toBe(false);
    const input = createInputFromTask(baseTask, { status: 'completed' });
    expect(input.status).toBe('completed');
    expect(input.title).toBe(baseTask.title);
    expect(input.category).toBe(baseTask.category);
  });

  it('merges vault-only tasks with remote and outbox records', () => {
    const vaultLocal: Task = { ...baseTask, id: 'local-1', title: 'Vault only', updated_at: NOW };
    const outboxTask = buildOptimisticTask({ title: 'Outbox' }, 'user-1', { clientEventId: 'evt', now: NOW });
    const outbox = buildTaskCreateOutboxItem('user-1', { title: 'Outbox' }, outboxTask, NOW);
    const merged = mergeTaskSources([baseTask], [vaultLocal], [outbox]);
    expect(merged.some((task) => task.id === 'task-1')).toBe(true);
    expect(merged.some((task) => task.id === 'local-1')).toBe(true);
    expect(merged.some((task) => task.id === outboxTask.id)).toBe(true);
  });
});
