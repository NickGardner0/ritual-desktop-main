#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const dashboardSources = execFileSync('git', ['ls-files', 'apps/dashboard'], {
  cwd: root,
  encoding: 'utf8',
})
  .trim()
  .split('\n')
  .filter((file) => /\.tsx?$/.test(file) && file !== 'apps/dashboard/lib/api/client.ts')
  .map((file) => ({ file, source: readFileSync(file, 'utf8') }));
const files = dashboardSources
  .filter(({ source }) => /apiJson(?:WithAuth)?</.test(source))
  .map(({ file }) => file);
const missingGeneratedConsumer = !dashboardSources.some(({ source }) =>
  /apiOperationWithAuth\(/.test(source),
);

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
