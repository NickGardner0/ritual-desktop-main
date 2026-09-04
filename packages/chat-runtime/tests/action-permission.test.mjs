import test from 'node:test';
import assert from 'node:assert/strict';

import {
  draftToolResult,
  resetPermissionStateForTests,
  resolveToolPermission,
  submitPermissionDecision,
  waitForPermission,
} from '../dist/action-permission.js';

test('observe and organize deny writes while reads stay allowed', () => {
  assert.equal(resolveToolPermission({ toolName: 'listHabits', profile: 'observe' }), 'allow');
  assert.equal(resolveToolPermission({ toolName: 'logHabit', profile: 'observe' }), 'deny');
  assert.equal(resolveToolPermission({ toolName: 'createHabit', profile: 'organize' }), 'deny');
});

test('act allows logHabit/createHabit writes', () => {
  assert.equal(resolveToolPermission({ toolName: 'logHabit', profile: 'act' }), 'allow');
  assert.equal(resolveToolPermission({ toolName: 'createHabit', profile: 'act' }), 'allow');
});

test('Always scopes skip the ask dock', () => {
  assert.equal(resolveToolPermission({
    toolName: 'logHabit',
    profile: 'observe',
    alwaysAllowed: new Set(['logHabit']),
  }), 'allow');
});

test('draft results propose without persisting', () => {
  const parsed = JSON.parse(draftToolResult('logHabit', { amount: 1 }));
  assert.equal(parsed.success, true);
  assert.equal(parsed.draft, true);
  assert.equal(parsed.persisted, false);
});

test('submitPermissionDecision resolves an in-flight ask', async () => {
  resetPermissionStateForTests();
  const pending = waitForPermission('tool-1', 1_000);
  assert.equal(submitPermissionDecision('tool-1', 'once'), true);
  assert.equal(await pending, 'once');
});
