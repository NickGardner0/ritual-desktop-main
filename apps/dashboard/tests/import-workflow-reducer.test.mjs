import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(
  new URL('../components/data-import/import-workflow.ts', import.meta.url),
  'utf8',
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const workflow = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

const preview = { import_run_id: 'run-1', items: [] };
const file = { name: 'metrics.csv' };

function reduce(actions) {
  return actions.reduce(workflow.importWorkflowReducer, workflow.initialImportWorkflowState);
}

test('preview success can only produce configuring with its required payload', () => {
  const state = reduce([
    { type: 'SELECT_SOURCE', source: 'csv' },
    { type: 'SET_FILE', file },
    { type: 'REQUEST_PREVIEW' },
    { type: 'PREVIEW_SUCCEEDED', preview },
  ]);
  assert.equal(state.kind, 'configuring');
  assert.equal(state.source, 'csv');
  assert.equal(state.file, file);
  assert.equal(state.preview, preview);
  assert.equal(state.runId, 'run-1');
});

test('stale poll actions cannot update a newer import attempt', () => {
  const importing = reduce([
    { type: 'SELECT_SOURCE', source: 'csv' },
    { type: 'SET_FILE', file },
    { type: 'PREVIEW_SUCCEEDED', preview },
    { type: 'IMPORT_STARTED', attempt: 2 },
  ]);
  const stale = workflow.importWorkflowReducer(importing, {
    type: 'IMPORT_COMPLETED',
    attempt: 1,
    result: { imported: 10 },
  });
  assert.equal(stale, importing);
  assert.equal(stale.kind, 'importing');
});

test('back navigation preserves only payload valid for the target state', () => {
  const configuring = reduce([
    { type: 'SELECT_SOURCE', source: 'csv' },
    { type: 'SET_FILE', file },
    { type: 'PREVIEW_SUCCEEDED', preview },
  ]);
  const uploading = workflow.importWorkflowReducer(configuring, { type: 'BACK' });
  assert.deepEqual(uploading, {
    kind: 'uploading',
    source: 'csv',
    file,
    request: 'idle',
    error: null,
  });
});
