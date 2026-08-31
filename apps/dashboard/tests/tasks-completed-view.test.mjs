import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '../../..');

function read(rel) {
  return readFileSync(join(repo, rel), 'utf8');
}

test('tasks page has a Completed pill and a Things-style completed log', () => {
  const pills = read('apps/dashboard/app/(dashboard)/tasks/tasks-ui.tsx');
  const log = read('apps/dashboard/app/(dashboard)/tasks/completed-task-log.tsx');
  const client = read('apps/dashboard/app/(dashboard)/tasks/tasks-client.tsx');

  assert.match(pills, /Completed/);
  assert.match(pills, /onViewChange\('completed'\)/);
  assert.match(pills, /CATEGORY_FILTERS/);
  assert.match(log, /groupCompletedTasksByMonth/);
  assert.match(log, /formatCompletedTaskDate/);
  assert.doesNotMatch(log, /Logbook/);
  assert.doesNotMatch(log, /#[0-9A-Fa-f]*blue/i);
  assert.match(client, /buildVisibleSeedTasks/);
  assert.match(client, /selectTasksForQuery/);
  assert.match(client, /isSeedTaskId/);
  assert.match(client, /CompletedTaskLog/);
});
