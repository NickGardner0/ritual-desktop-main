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
  const clerk = readFileSync(join(root, 'src/adapters/clerk.tsx'), 'utf8');
  assert.match(html, /desktop/);
  assert.match(html, /#fefefe/);
  assert.doesNotMatch(main, /location\.replace/);
  assert.match(app, /\/activity/);
  assert.match(app, /\/chat/);
  assert.match(app, /LogsClient/);
  assert.match(app, /RequireDesktopSession/);
  assert.doesNotMatch(clerk, /@clerk\/clerk-react/);
  assert.match(clerk, /DesktopAuthProvider/);
});

test('signed-out desktop home shows compact Google and Apple chrome', () => {
  const signIn = readFileSync(join(root, 'src/pages/desktop-auth-page.tsx'), 'utf8');
  assert.match(signIn, /Welcome to Ritual/);
  assert.match(signIn, /Continue with Google/);
  assert.match(signIn, /Continue with Apple/);
  assert.match(signIn, /Continue in your browser/);
  assert.doesNotMatch(signIn, /Get Started/);
  assert.doesNotMatch(signIn, /step === 'welcome'/);
});

test('createRoot runs before any chat sidecar health probe', () => {
  const main = readFileSync(join(root, 'src/main.tsx'), 'utf8');
  const createRootAt = main.indexOf('createRoot(root)');
  const probeAt = main.indexOf('void probeLocalChatSidecar');
  assert.ok(createRootAt >= 0);
  assert.ok(probeAt > createRootAt);
  assert.doesNotMatch(main, /await bootstrapOrigins/);
  assert.doesNotMatch(main, /await probeLocalChatSidecar/);
  assert.match(main, /bindHostedOrigins/);
});

test('disk session becomes isLoaded before a background JWT refresh', () => {
  const clerk = readFileSync(join(root, 'src/adapters/clerk.tsx'), 'utf8');
  const diskAt = clerk.indexOf("desktopGetAuthToken({ refresh: false })");
  const loadedAt = clerk.indexOf('setIsLoaded(true)');
  const refreshAt = clerk.indexOf("desktopGetAuthToken({ refresh: true })");
  assert.ok(diskAt >= 0 && loadedAt > diskAt && refreshAt > loadedAt);
});

test('non-Index desktop routes are lazy and Index stays in the first chunk', () => {
  const app = readFileSync(join(root, 'src/App.tsx'), 'utf8');
  const vite = readFileSync(join(root, 'vite.config.ts'), 'utf8');
  assert.match(app, /lazy\(\(\) =>/);
  assert.match(app, /ClientDashboard/);
  assert.doesNotMatch(app, /import \{ LogsClient \}/);
  assert.doesNotMatch(app, /import \{ ChatClient \}/);
  assert.match(vite, /chunkSizeWarningLimit:\s*800/);
});
