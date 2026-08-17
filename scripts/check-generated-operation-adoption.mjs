#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';

const root = process.cwd();
const manualCallSearch = spawnSync(
  'rg',
  [
    '-l',
    'apiJson(?:WithAuth)?<',
    'apps/dashboard',
    '--glob',
    '*.{ts,tsx}',
    '--glob',
    '!apps/dashboard/lib/api/client.ts',
  ],
  { cwd: root, encoding: 'utf8' },
);
if (manualCallSearch.status !== 0 && manualCallSearch.status !== 1) {
  throw new Error(manualCallSearch.stderr || 'failed to scan dashboard API calls');
}
const output = manualCallSearch.stdout.trim();
const files = output ? output.split('\n').filter(Boolean) : [];
const missingGeneratedConsumer = !execFileSync(
  'rg',
  [
    '-l',
    'apiOperationWithAuth\\(',
    'apps/dashboard',
    '--glob',
    '*.{ts,tsx}',
    '--glob',
    '!apps/dashboard/lib/api/client.ts',
  ],
  { cwd: root, encoding: 'utf8' },
).trim();

const generatedClient = readFileSync(
  'apps/dashboard/lib/api/generated/backend-client.ts',
  'utf8',
);
const errors = [];
if (!generatedClient.includes('requestOperation<TOperation extends BackendOperationId>')) {
  errors.push('generated backend client does not expose requestOperation');
}
if (missingGeneratedConsumer) {
  errors.push('no production dashboard module consumes a generated operation ID');
}
for (const file of files) {
  errors.push(`${file} introduces a manually typed apiJson call; use apiOperationWithAuth`);
}

if (errors.length) {
  console.error('Generated operation adoption check failed:');
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log(
  'Generated operation adoption check passed; no manually typed dashboard API calls remain.',
);
