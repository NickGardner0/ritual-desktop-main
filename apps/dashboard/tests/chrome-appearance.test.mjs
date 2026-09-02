import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('Frosted uses native glass tokens and White is solid white', () => {
  const chrome = readFileSync(join(root, 'contexts/ChromeAppearanceContext.tsx'), 'utf8');
  const css = readFileSync(join(root, 'app/globals.css'), 'utf8');

  assert.match(chrome, /"--sidebar-vibrancy-bg": "rgba\(255, 255, 255, 0\.28\)"/);
  assert.match(chrome, /"--titlebar-glass-filter": "none"/);
  assert.match(chrome, /Native macOS glass behind the sidebar/);
  assert.match(chrome, /"--sidebar-vibrancy-bg": "#ffffff"/);
  assert.match(chrome, /Solid white sidebar and chrome/);

  assert.match(css, /html\.desktop\[data-chrome-appearance="white"\] \.sidebar-vibrancy \{[\s\S]*background: #ffffff !important/);
  assert.doesNotMatch(
    css,
    /html\.desktop\[data-chrome-appearance="white"\] \.sidebar-vibrancy \{[\s\S]*rgba\(248, 249, 250, 0\.78\)/,
  );
});

test('Frosted clips native glass to the live sidebar width', () => {
  const layout = readFileSync(join(root, 'components/dashboard-layout.tsx'), 'utf8');
  const edges = readFileSync(join(root, 'components/desktop-window-resize-edges.tsx'), 'utf8');

  assert.match(layout, /syncSidebarGlassWidth\(appearance === 'frosted' \? sidebarWidth : 0\)/);
  assert.match(edges, /startWindowResizeDragging/);
  assert.match(edges, /data-tauri-drag-region="false"/);
});

test('sidebar divider is a hairline on the aside, not a detached overlay', () => {
  const css = readFileSync(join(root, 'app/globals.css'), 'utf8');

  assert.match(css, /\.sidebar-vibrancy::after \{[\s\S]*right: 0;[\s\S]*width: 1px/);
  assert.match(css, /\.app-window-shell\.has-shell-sidebar-divider::before \{[\s\S]*content: none/);
  assert.doesNotMatch(
    css,
    /html\.desktop \.sidebar-vibrancy::after \{\s*display: none;/,
  );
});
