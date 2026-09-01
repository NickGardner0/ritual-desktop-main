import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '../../..');

function read(rel) {
  return readFileSync(join(repo, rel), 'utf8');
}

test('tasks page offers table, todo, and board layouts', () => {
  const constants = read('apps/dashboard/lib/tasks/task-constants.ts');
  const filters = read('apps/dashboard/app/(dashboard)/tasks/tasks-filters.tsx');
  const client = read('apps/dashboard/app/(dashboard)/tasks/tasks-client.tsx');
  const table = read('apps/dashboard/app/(dashboard)/tasks/tasks-ui.tsx');
  const todo = read('apps/dashboard/app/(dashboard)/tasks/tasks-todo-list.tsx');
  const view = read('apps/dashboard/lib/tasks/task-view.ts');

  const effect = read('apps/dashboard/lib/tasks/task-complete-effect.tsx');
  const styles = read('apps/dashboard/app/globals.css');

  assert.match(constants, /id: 'list',\s*label: 'Table'/);
  assert.match(constants, /id: 'todo',\s*label: 'Todo'/);
  assert.match(constants, /id: 'board',\s*label: 'Board'/);
  assert.match(constants, /ritual:tasks-display-mode/);
  assert.match(filters, /Change task view/);
  assert.match(filters, /displayMode !== 'todo'/);
  assert.match(client, /TaskTodoList/);
  assert.match(client, /writeStoredTaskDisplayMode/);
  assert.match(table, /export function TaskTableHeader/);
  assert.match(todo, /Schedule for today/);
  assert.match(todo, /Schedule\.\.\./);
  assert.match(todo, /Complete task/);
  assert.match(todo, /Delete task/);
  assert.match(todo, /status: 'canceled'/);
  assert.match(view, /groupTasksForTodoView/);
  assert.match(effect, /TaskCompleteTitle/);
  assert.match(effect, /TASK_COMPLETE_SHIMMER_S = 0.28/);
  assert.match(client, /taskCompleteHoldMs/);
  assert.match(client, /completingIds/);
  assert.match(table, /TaskCompleteTitle/);
  assert.match(todo, /TaskCompleteTitle/);
  assert.match(styles, /ritual-task-completing/);
  assert.match(styles, /ritual-task-complete-check/);
});
