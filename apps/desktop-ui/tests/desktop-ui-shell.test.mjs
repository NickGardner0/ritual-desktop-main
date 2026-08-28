import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('desktop-ui ships a local Vite SPA instead of a hosted redirect', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const app = readFileSync(join(root, 'src/App.tsx'), 'utf8');
  const main = readFileSync(join(root, 'src/main.tsx'), 'utf8');
  assert.match(html, /desktop/);
  assert.doesNotMatch(main, /location\.replace/);
  assert.match(app, /\/activity/);
  assert.match(app, /\/chat/);
  assert.match(app, /LogsClient/);
});
