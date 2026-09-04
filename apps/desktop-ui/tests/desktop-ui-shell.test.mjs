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
  assert.match(app, /\/agent/);
  assert.match(app, /AgentChat/);
  assert.match(app, /LogsClient/);
  assert.match(app, /RequireDesktopSession/);
  assert.doesNotMatch(clerk, /@clerk\/clerk-react/);
  assert.match(clerk, /DesktopAuthProvider/);
});

test('signed-out desktop home is Amp-style logo, welcome, and Sign in', () => {
  const signIn = readFileSync(join(root, 'src/pages/desktop-auth-page.tsx'), 'utf8');
  assert.match(signIn, /Welcome to Ritual/);
  assert.match(signIn, /'Sign in'/);
  assert.match(signIn, /rounded-full/);
  assert.match(signIn, /oauth_google/);
  assert.doesNotMatch(signIn, /Continue with Google/);
  assert.doesNotMatch(signIn, /Continue in your browser/);
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
  assert.match(clerk, /__RITUAL_DISK_SESSION__/);
  assert.match(clerk, /ritual:desktop-auth-session:v1/);
  assert.match(clerk, /hasIdentity\(seeded\)/);
});

test('Tauri window shows from HTML instead of after two rAFs', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const shell = readFileSync(join(root, 'src/shell/root-providers.tsx'), 'utf8');
  assert.match(html, /show_main_window/);
  assert.match(html, /__TAURI_INTERNALS__/);
  assert.doesNotMatch(shell, /requestAnimationFrame/);
  assert.doesNotMatch(shell, /showMainWindow/);
});

test('non-Index desktop routes are lazy and Index stays in the first chunk', () => {
  const app = readFileSync(join(root, 'src/App.tsx'), 'utf8');
  const vite = readFileSync(join(root, 'vite.config.ts'), 'utf8');
  const settingsQuery = readFileSync(join(root, 'src/pages/desktop-settings-query.ts'), 'utf8');
  assert.match(app, /lazy\(\(\) =>/);
  assert.match(app, /ClientDashboard/);
  assert.match(app, /readDesktopSettingsWindowView/);
  assert.match(app, /DesktopSettingsWindow/);
  assert.match(app, /isDesktopVoiceHudWindow/);
  assert.match(app, /VoiceHudPage/);
  assert.match(settingsQuery, /ritual_settings_window/);
  assert.doesNotMatch(app, /import \{ LogsClient \}/);
  assert.doesNotMatch(app, /import \{ ChatClient \}/);
  assert.match(vite, /chunkSizeWarningLimit:\s*800/);
  assert.match(vite, /'\/api\/agent'/);
});

test('voice HUD is a dedicated local SPA window, not a dashboard route', () => {
  const app = readFileSync(join(root, 'src/App.tsx'), 'utf8');
  const query = readFileSync(join(root, 'src/pages/desktop-voice-hud-query.ts'), 'utf8');
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  assert.match(app, /isDesktopVoiceHudWindow\(\)/);
  assert.match(app, /lazy\(\(\) => import\('@\/app\/voice-hud\/page'\)\)/);
  assert.doesNotMatch(app, /path="\/voice-hud"/);
  assert.match(query, /ritual_voice_hud_window/);
  assert.match(html, /ritual_voice_hud_window/);
  assert.match(html, /data-voice-hud-window/);
});

test('desktop shell owns providers and session, not dashboard RootProviders', () => {
  const app = readFileSync(join(root, 'src/App.tsx'), 'utf8');
  const vite = readFileSync(join(root, 'vite.config.ts'), 'utf8');
  const shell = readFileSync(join(root, 'src/shell/root-providers.tsx'), 'utf8');
  const clerk = readFileSync(join(root, 'src/adapters/clerk.tsx'), 'utf8');
  assert.match(app, /from '\.\/shell'/);
  assert.doesNotMatch(app, /@\/components\/root-providers/);
  assert.doesNotMatch(app, /@clerk\/nextjs/);
  assert.doesNotMatch(app, /next\/navigation/);
  assert.match(shell, /from '\.\.\/adapters\/clerk'/);
  assert.match(shell, /from '\.\.\/adapters\/next-navigation'/);
  assert.doesNotMatch(clerk, /from ['"]next\/navigation['"]/);
  assert.match(vite, /@\/lib\/desktop-session/);
  assert.match(vite, /@\/lib\/app-navigation/);
  assert.match(vite, /manualChunks/);
  assert.match(vite, /streamdown/);
  assert.match(vite, /@shikijs/);
  assert.match(vite, /modulePreload/);
  assert.match(vite, /resolveDependencies/);
});
