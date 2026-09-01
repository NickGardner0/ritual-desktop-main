import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('desktop update control uses a Cursor-style green pill', () => {
  const control = readFileSync(join(root, 'components/desktop-update-control.tsx'), 'utf8');
  const sidebar = readFileSync(join(root, 'components/sidebar.tsx'), 'utf8');

  assert.match(control, /from '@ritual\/ui\/button'/);
  assert.match(control, /data-desktop-update-pill/);
  assert.match(control, /!rounded-full/);
  assert.match(control, /bg-\[#2f6e45\]/);
  assert.match(control, /hover:bg-\[#275c3a\]/);
  assert.match(control, /: 'Update'/);
  assert.doesNotMatch(control, /: 'Update available'/);
  assert.match(sidebar, /DesktopUpdateControl/);
  assert.match(sidebar, /items-center gap-1\.5/);
});
