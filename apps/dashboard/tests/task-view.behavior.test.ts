import { afterEach, describe, expect, it } from 'vitest';

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
  groupTasksForTodoView,
  isSeedTaskId,
  mergeVisibleTasksForView,
  selectTasksForQuery,
} from '../lib/tasks/task-view';
import {
  isTaskDisplayMode,
  readStoredTaskDisplayMode,
  TASK_DISPLAY_MODE_STORAGE_KEY,
  writeStoredTaskDisplayMode,
} from '../lib/tasks/task-constants';
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

  it('does not resurrect a completed task from a stale create overlay', () => {
    const open: Task = {
      ...baseTask,
      status: 'open',
      due_at: new Date().toISOString(),
      scheduled_for: new Date().toISOString(),
    };
    const completed: Task = { ...open, status: 'completed', completed_at: NOW };
    expect(mergeVisibleTasksForView({
      stored: [completed],
      recent: [open],
      demo: [open],
      view: 'today',
      category: 'All',
    })).toEqual([]);
    expect(mergeVisibleTasksForView({
      stored: [completed],
      recent: [open],
      demo: [],
      view: 'completed',
      category: 'All',
    }).map((task) => task.id)).toEqual(['task-1']);
  });

  it('keeps a completing snapshot visible while the cached task is already complete', () => {
    const open: Task = {
      ...baseTask,
      status: 'open',
      due_at: new Date().toISOString(),
      scheduled_for: new Date().toISOString(),
    };
    const completed: Task = { ...open, status: 'completed', completed_at: NOW };
    expect(mergeVisibleTasksForView({
      stored: [completed],
      recent: [],
      demo: [],
      held: [open],
      view: 'today',
      category: 'All',
    }).map((task) => task.id)).toEqual(['task-1']);
  });

  it('still shows a newly created task that has not landed in the cache yet', () => {
    const recent: Task = {
      ...baseTask,
      due_at: new Date().toISOString(),
      scheduled_for: new Date().toISOString(),
    };
    expect(mergeVisibleTasksForView({
      stored: [],
      recent: [recent],
      demo: [],
      view: 'today',
      category: 'All',
    }).map((task) => task.id)).toEqual(['task-1']);
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

describe('todo list grouping', () => {
  function localMorningIso(year: number, month: number, day: number) {
    return new Date(year, month - 1, day, 9, 0, 0).toISOString();
  }

  function localNoon(year: number, month: number, day: number) {
    return new Date(year, month - 1, day, 12, 0, 0);
  }

  it('groups tasks into overdue, today, upcoming, and no date', () => {
    const now = localNoon(2026, 9, 1);
    const overdue: Task = { ...baseTask, id: 'overdue', due_at: localMorningIso(2026, 8, 25) };
    const today: Task = {
      ...baseTask,
      id: 'today',
      due_at: localMorningIso(2026, 9, 1),
    };
    const upcoming: Task = { ...baseTask, id: 'upcoming', due_at: localMorningIso(2026, 9, 10) };
    const undated: Task = { ...baseTask, id: 'undated', due_at: null };
    const groups = groupTasksForTodoView([undated, upcoming, overdue, today], now);

    expect(groups.map((group) => group.id)).toEqual(['overdue', 'today', 'upcoming', 'undated']);
    expect(groups.find((group) => group.id === 'overdue')?.tasks.map((task) => task.id)).toEqual(['overdue']);
    expect(groups.find((group) => group.id === 'today')?.tasks.map((task) => task.id)).toEqual(['today']);
    expect(groups.find((group) => group.id === 'upcoming')?.tasks.map((task) => task.id)).toEqual(['upcoming']);
    expect(groups.find((group) => group.id === 'undated')?.tasks.map((task) => task.id)).toEqual(['undated']);
  });

  it('uses the independent deadline when grouping', () => {
    const now = localNoon(2026, 9, 1);
    const task: Task = {
      ...baseTask,
      due_at: localMorningIso(2026, 9, 1),
      scheduled_for: localMorningIso(2026, 9, 1),
    };
    const groups = groupTasksForTodoView([task], now);
    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe('today');
  });

  it('omits empty groups', () => {
    const groups = groupTasksForTodoView([{ ...baseTask, due_at: null }]);
    expect(groups).toEqual([
      { id: 'undated', label: 'No date', tasks: [{ ...baseTask, due_at: null }] },
    ]);
  });
});

describe('task display mode preference', () => {
  afterEach(() => {
    window.localStorage.removeItem(TASK_DISPLAY_MODE_STORAGE_KEY);
  });

  it('accepts table, todo, and board values', () => {
    expect(isTaskDisplayMode('list')).toBe(true);
    expect(isTaskDisplayMode('todo')).toBe(true);
    expect(isTaskDisplayMode('board')).toBe(true);
    expect(isTaskDisplayMode('cards')).toBe(false);
  });

  it('reads a stored todo layout and ignores unknown values', () => {
    writeStoredTaskDisplayMode('todo');
    expect(readStoredTaskDisplayMode()).toBe('todo');
    window.localStorage.setItem(TASK_DISPLAY_MODE_STORAGE_KEY, 'cards');
    expect(readStoredTaskDisplayMode()).toBe('list');
  });
});
