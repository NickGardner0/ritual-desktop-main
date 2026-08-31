import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));

test('production, QA, and development own distinct names, bundle IDs, schemes, and data roots', async () => {
  const production = await readJson('apps/desktop/src-tauri/tauri.conf.json');
  const qa = await readJson('apps/desktop/src-tauri/tauri.qa.conf.json');
  const development = await readJson('apps/desktop/src-tauri/tauri.dev.conf.json');
  assert.deepEqual(
    [production.productName, qa.productName, development.productName],
    ['Ritual', 'Ritual QA', 'Ritual Dev'],
  );
  assert.deepEqual(
    [production.identifier, qa.identifier, development.identifier],
    ['com.ritual.desktop', 'com.ritual.desktop.qa', 'com.ritual.desktop.dev'],
  );
  assert.deepEqual(production.plugins['deep-link'].desktop.schemes, ['com.ritual.desktop']);
  assert.deepEqual(qa.plugins['deep-link'].desktop.schemes, ['com.ritual.desktop.qa']);
  assert.deepEqual(development.plugins['deep-link'].desktop.schemes, ['com.ritual.desktop.dev']);
  assert.match(JSON.stringify(qa.app.security.assetProtocol.scope), /\.ritual-qa/);
  assert.doesNotMatch(JSON.stringify(qa.app.security.assetProtocol.scope), /"\$HOME\/\.ritual\/\*\*/);
  assert.match(JSON.stringify(development.app.security.assetProtocol.scope), /\.ritual-dev/);
});

test('QA and development capabilities cannot read the production app-data root', async () => {
  const qa = await readFile('apps/desktop/src-tauri/capabilities/qa/main.json', 'utf8');
  const development = await readFile('apps/desktop/src-tauri/capabilities/development/main.json', 'utf8');
  const build = await readFile('apps/desktop/src-tauri/build.rs', 'utf8');
  assert.match(qa, /\.ritual-qa\/\*\*/);
  assert.doesNotMatch(qa, /"\$HOME\/\.ritual\/\*\*"/);
  assert.match(development, /\.ritual-dev\/\*\*/);
  assert.doesNotMatch(development, /"\$HOME\/\.ritual\/\*\*"/);
  assert.match(build, /"qa" \| "staging" => "capabilities\/qa\/\*\.json"/);
  assert.match(build, /_ => "capabilities\/\*\.json"/);
});

test('production local SPA capabilities apply to the bundled webview', async () => {
  const main = await readJson('apps/desktop/src-tauri/capabilities/main.json');
  const sidebar = await readJson('apps/desktop/src-tauri/capabilities/sidebar.json');
  const vite = await readFile('apps/desktop-ui/vite.config.ts', 'utf8');
  assert.equal(main.local, true);
  assert.equal(sidebar.local, true);
  assert.match(vite, /pk_live_/);
});

test('local SPA sign-in has visible chrome and hosted OAuth start', async () => {
  const app = await readFile('apps/desktop-ui/src/App.tsx', 'utf8');
  const signIn = await readFile('apps/desktop-ui/src/pages/desktop-auth-page.tsx', 'utf8');
  const origin = await readFile('apps/dashboard/lib/desktop-auth-origin.ts', 'utf8');
  const handler = await readFile('apps/dashboard/components/clerk-oauth-handler.tsx', 'utf8');
  const csp = (await readJson('apps/desktop/src-tauri/tauri.conf.json')).app.security.csp;
  const callback = await readFile('apps/dashboard/app/auth/callback/page.tsx', 'utf8');
  assert.match(app, /path="\/sign-in\/\*"/);
  assert.match(app, /path="\/auth\/callback"/);
  assert.match(app, /path="\/auth\/sso-callback"/);
  assert.match(signIn, /Continue with Google/);
  assert.match(signIn, /Continue with Apple/);
  assert.match(signIn, /Welcome to Ritual/);
  assert.match(signIn, /Continue in your browser/);
  assert.doesNotMatch(signIn, /Get Started/);
  assert.doesNotMatch(signIn, />Sign In</);
  assert.match(signIn, /buildDesktopOAuthStartUrl/);
  assert.match(app, /RequireDesktopSession/);
  assert.match(origin, /desktop\.ritualdb\.com/);
  assert.match(origin, /getDesktopAuthHandoffApiUrl/);
  assert.doesNotMatch(origin, /buildDesktopHostedAuthCallbackUrl/);
  assert.match(handler, /buildDesktopOAuthStartUrl/);
  assert.doesNotMatch(handler, /window\.location\.origin/);
  assert.match(csp, /worker-src 'self' blob:/);
  assert.match(csp, /challenges\.cloudflare\.com/);
  assert.match(callback, /router\.replace\('\/auth\/sso-callback'\)/);
  assert.doesNotMatch(callback, /window\.location\.replace\('\/auth\/sso-callback'\)/);
  assert.doesNotMatch(callback, /shouldCompleteDesktopAuthOnHostedOrigin/);
  assert.doesNotMatch(callback, /buildDesktopHostedAuthCallbackUrl/);
});

test('signed-in desktop uses native session and a local shell URL', async () => {
  const app = await readFile('apps/desktop-ui/src/App.tsx', 'utf8');
  const adapter = await readFile('apps/desktop-ui/src/adapters/clerk.tsx', 'utf8');
  const main = await readFile('apps/desktop/src-tauri/src/main.rs', 'utf8');
  const sso = await readFile('apps/dashboard/app/auth/sso-callback/page.tsx', 'utf8');
  const shellFn = main.slice(
    main.indexOf('fn desktop_shell_window_url'),
    main.indexOf('fn env_flag_enabled'),
  );
  assert.match(app, /function RequireDesktopSession/);
  assert.match(app, /isSignedIn/);
  assert.doesNotMatch(app, /CLERK_LOAD_GRACE_MS/);
  assert.match(adapter, /DesktopAuthProvider/);
  assert.match(adapter, /desktopGetAuthToken/);
  assert.doesNotMatch(adapter, /@clerk\/clerk-react/);
  assert.match(sso, /desktopGetAuthToken/);
  assert.match(shellFn, /WebviewUrl::App\("index.html"/);
  assert.doesNotMatch(shellFn, /has_persisted_auth_token/);
  assert.doesNotMatch(shellFn, /WebviewUrl::External\(hosted\)/);
});

test('desktop patch version and generated identity source stay synchronized', async () => {
  const production = await readJson('apps/desktop/src-tauri/tauri.conf.json');
  const cargo = await readFile('apps/desktop/src-tauri/Cargo.toml', 'utf8');
  const infoPlist = await readFile('apps/desktop/src-tauri/Info.plist', 'utf8');
  assert.equal(production.version, '0.1.108');
  assert.match(cargo, /^version = "0\.1\.108"$/m);
  assert.doesNotMatch(infoPlist, /CFBundleURLTypes|com\.ritual\.desktop/);
});

test('reload tools compile only in debug or the explicit QA feature', async () => {
  const main = await readFile('apps/desktop/src-tauri/src/main.rs', 'utf8');
  const release = await readFile('scripts/build-macos-desktop-release.sh', 'utf8');
  assert.match(main, /cfg\(any\(debug_assertions, feature = "qa-tools"\)\)[\s\S]*reload_focused_main_webview/);
  assert.match(main, /is_focused\(\)/);
  assert.doesNotMatch(release, /--features[= ]+qa-tools/);
});

test('release matrix and sidecar contract ship Apple Silicon only', async () => {
  const workflow = await readFile('.github/workflows/desktop-release.yml', 'utf8');
  const publisher = await readFile('scripts/publish-apple-silicon-desktop-release-assets.sh', 'utf8');
  const lock = await readJson('apps/desktop/src-tauri/binaries/sidecar-lock.json');
  assert.match(workflow, /target: aarch64-apple-darwin/);
  assert.match(workflow, /runner: macos-26/);
  assert.doesNotMatch(workflow, /x86_64-apple-darwin|ritual-intel|darwin-x86_64/);
  assert.match(workflow, /mv release-assets\/dmg\/\*\.dmg release-assets\//);
  assert.match(workflow, /mv release-assets\/macos\/\* release-assets\//);
  assert.match(workflow, /publish-apple-silicon-desktop-release-assets\.sh/);
  assert.match(publisher, /_aarch64\.dmg/);
  assert.match(publisher, /_aarch64\.app\.tar\.gz/);
  assert.match(publisher, /--platform darwin-aarch64 --check-urls/);
  assert.doesNotMatch(publisher, /x64|x86_64|darwin-x86_64/);
  assert.deepEqual(lock.releaseTargets, ['aarch64-apple-darwin']);
  assert.deepEqual(lock.shippedTargets, ['aarch64-apple-darwin']);
  assert.deepEqual(lock.externalPendingTargets, {});
  assert.match(lock.unsupportedTargets['x86_64-apple-darwin'], /Apple Silicon only/i);
});

test('DMG uses the compact Ritual installer composition', async () => {
  const release = await readFile('scripts/build-macos-desktop-release.sh', 'utf8');
  const background = await readFile('scripts/generate-macos-dmg-background.mjs', 'utf8');
  assert.match(release, /--icon-size 112/);
  assert.match(release, /--window-size 520 356/);
  assert.match(release, /--icon "\$\{PRODUCT_NAME\}\.app" 140 165/);
  assert.match(release, /--app-drop-link 380 165/);
  assert.match(background, /fill="#FAFAF7"/);
  assert.match(background, /Drag Ritual to the Applications folder to install/);
});

test('desktop ships a single resident host with quiet login startup', async () => {
  const cargo = await readFile('apps/desktop/src-tauri/Cargo.toml', 'utf8');
  const main = await readFile('apps/desktop/src-tauri/src/main.rs', 'utf8');
  const resident = await readFile('apps/desktop/src-tauri/src/resident_runtime.rs', 'utf8');
  const infoPlist = await readFile('apps/desktop/src-tauri/Info.plist', 'utf8');
  assert.match(cargo, /tauri-plugin-autostart/);
  assert.match(cargo, /tauri-plugin-single-instance/);
  assert.match(main, /MacosLauncher::LaunchAgent/);
  assert.match(main, /ActivationPolicy::Accessory/);
  assert.match(main, /ActivationPolicy::Regular/);
  assert.match(main, /show_ritual_with_dock_icon/);
  assert.match(main, /keep_ritual_resident_without_dock_icon/);
  assert.match(main, /sync_macos_dock_icon_to_window_visibility/);
  assert.match(infoPlist, /<key>LSUIElement<\/key>\s*<true\/>/);
  assert.match(main, /argument == "--background"/);
  assert.match(main, /api\.prevent_close\(\)/);
  assert.match(resident, /desktop_set_computer_tracking/);
  assert.match(resident, /show_menu_bar:\s*false/);
});

test('desktop shell keeps failed launches inside the Tauri app', async () => {
  const shell = await readFile('apps/desktop/src/DesktopShellApp.jsx', 'utf8');
  const bridge = await readFile('apps/desktop/src/desktop-shell-bridge.js', 'utf8');
  assert.doesNotMatch(shell, /Open in browser|Hosted UI|window\.open|location\.replace/);
  assert.doesNotMatch(bridge, /plugin-shell|openDesktopShellExternalUrl/);
  assert.match(shell, /Check your connection and try again/);
});

test('new desktop sync never projects rollups into habit logs', async () => {
  const sync = await readFile('apps/desktop/src-tauri/src/cloud_sync.rs', 'utf8');
  assert.doesNotMatch(sync, /project_computer_time_habit/);
  assert.doesNotMatch(sync, /\/api\/watcher\/sync-to-habit/);
});

test('runtime sidecar hashes are derived from the signed bytes actually bundled', async () => {
  const release = await readFile('scripts/build-macos-desktop-release.sh', 'utf8');
  const integrity = await readFile('apps/desktop/src-tauri/src/sidecar_integrity.rs', 'utf8');
  assert.match(release, /render-runtime-sidecar-lock\.mjs --target/);
  assert.match(release, /tauri build[\s\S]*--no-sign[\s\S]*--bundles app/);
  assert.match(release, /cmp -s "\$\{WATCHER_SIDECAR_PATH\}" "\$\{HELPER_PATH\}"/);
  assert.match(release, /cmp -s "\$\{VISION_SIDECAR_PATH\}" "\$\{VISION_HELPER_PATH\}"/);
  assert.doesNotMatch(release, /sign_macos_path "\$\{HELPER_PATH\}"/);
  assert.match(release, /Add :RitualSourceSHA string \$\{SOURCE_SHA\}/);
  assert.match(release, /Add :RitualTargetTriple string \$\{TAURI_TARGET_TRIPLE\}/);
  assert.match(integrity, /option_env!\("RITUAL_RUNTIME_SIDECAR_LOCK_JSON"\)/);
});

test('main window defaults opaque and AppKit explicitly disables click-through', async () => {
  const main = await readFile('apps/desktop/src-tauri/src/main.rs', 'utf8');
  const css = await readFile('apps/dashboard/app/globals.css', 'utf8');
  const capture = await readFile('scripts/capture-desktop-window-qa.mjs', 'utf8');
  assert.match(main, /transparency_probe \|\| env_flag_enabled\("RITUAL_ENABLE_MAIN_GLASS"\)/);
  assert.match(main, /setIgnoresMouseEvents: NO/);
  assert.match(main, /setLevel: 0_isize/);
  assert.match(css, /data-transparency-probe="1"[\s\S]*background: hsl\(var\(--background\)\) !important/);
  assert.match(capture, /WKWebView did not acknowledge the declared hit-test click/);
  assert.match(capture, /opaqueMainSurface\.alpha !== 255/);
});

test('diagnostics executes the channel-named binary instead of the raw Cargo app target', async () => {
  const diagnostics = await readFile('scripts/desktop-diagnostics.mjs', 'utf8');
  assert.match(diagnostics, /target\/debug', productName/);
  assert.doesNotMatch(diagnostics, /'cargo'[\s\S]*'run'/);
});
