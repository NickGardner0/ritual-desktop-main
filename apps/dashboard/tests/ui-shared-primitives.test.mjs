import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const repositoryRoot = new URL('../../../', import.meta.url);

async function read(relativePath) {
  return readFile(new URL(relativePath, repositoryRoot), 'utf8');
}

test('floating UI primitives are package-owned and dashboard shims are gone', async () => {
  const primitiveNames = ['dialog', 'alert-dialog', 'dropdown-menu', 'popover', 'select'];

  for (const name of primitiveNames) {
    const shared = await read(`packages/ui/src/components/${name}.tsx`);
    assert.match(shared, /@radix-ui\/react-/);
    await assert.rejects(
      () => read(`apps/dashboard/components/ui/${name}.tsx`),
      (error) => error && error.code === 'ENOENT',
    );
  }

  const dropdown = await read('packages/ui/src/components/dropdown-menu.tsx');
  const popover = await read('packages/ui/src/components/popover.tsx');
  const select = await read('packages/ui/src/components/select.tsx');
  assert.match(dropdown, /menuSurfaceVariants\(\)/);
  assert.match(dropdown, /menuRowVariants\(/);
  assert.match(popover, /menuSurfaceVariants\(\)/);
  assert.match(select, /menuSurfaceVariants\(\)/);
  assert.match(select, /focus:ring-2/);
});

test('product code imports promoted primitives from @ritual/ui', async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);
  const { stdout } = await execFileAsync('rg', [
    '-n',
    'components/ui/(dialog|alert-dialog|dropdown-menu|popover|select)',
    'apps/dashboard',
    '--glob',
    '*.{ts,tsx}',
  ], { cwd: new URL('.', repositoryRoot) }).catch((error) => ({ stdout: error.stdout ?? '' }));

  const productReferences = stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .filter((line) => !line.includes('apps/dashboard/tests/ui-shared-primitives.test.mjs'));
  assert.deepEqual(productReferences, []);
});

test('generated CSS preserves focus, floating surface, and dialog visual contracts', async () => {
  const css = await read('packages/ui/src/globals.css');
  assert.match(css, /--ritual-focus-ring: #306774;/);
  assert.match(css, /--radius-floating: 0\.875rem;/);
  assert.match(css, /--radius-dialog: 1\.125rem;/);
  assert.match(css, /\.ritual-floating-surface[\s\S]*var\(--shadow-popover\)/);
  assert.match(css, /\.ritual-dialog-surface[\s\S]*var\(--shadow-dialog\)/);
});
