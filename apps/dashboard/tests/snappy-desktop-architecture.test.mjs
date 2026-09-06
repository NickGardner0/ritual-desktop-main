import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '../../..');

function read(rel) {
  return readFileSync(join(repo, rel), 'utf8');
}

test('Index first frame uses local snapshots and does not dynamic-gate the habit list', () => {
  const overview = read('apps/dashboard/components/analytics/overview-initial-section.tsx');
  const habits = read('apps/dashboard/hooks/use-habits-query.ts');
  const filters = read('apps/dashboard/components/analytics/analytics-filter-context.tsx');
  const metrics = read('apps/dashboard/components/analytics/overview/useOverviewMetrics.ts');
  const list = read('apps/dashboard/components/analytics/sortable-habit-list.tsx');
  const analytics = read('apps/dashboard/components/analytics/unified-analytics-client.tsx');

  assert.match(overview, /import \{ SortableHabitList/);
  assert.match(overview, /import \{ OverviewFetchBlock/);
  assert.doesNotMatch(overview, /dynamic\(\s*\(\) => import\('@\/components\/analytics\/sortable-habit-list'/);
  assert.doesNotMatch(overview, /dynamic\(\s*\(\) => import\('@\/components\/analytics\/overview-fetch-block'/);
  assert.match(habits, /placeholderData/);
  assert.match(habits, /readLocalVaultHabits/);
  assert.match(filters, /getLast14DaysRange/);
  assert.doesNotMatch(filters, /Default to "All time"/);
  assert.match(metrics, /hasRenderableCachedHabits/);
  assert.match(metrics, /shouldShowLoadingSpinner = !hasRenderableCachedHabits && isLoading/);
  assert.match(list, /useVirtualizer/);
  assert.doesNotMatch(analytics, /import \{ DateRangePicker \} from '@\/components\/date-range-picker'/);
  assert.match(analytics, /import\('@\/components\/date-range-picker'\)/);
});

test('compositor hover stays in CSS instead of React mousemove on Index chrome', () => {
  const scrubber = read('apps/dashboard/components/history-scrubber.tsx');
  const sidebarCss = read('apps/dashboard/app/globals.css');
  const mainMenu = read('apps/dashboard/components/main-menu.tsx');
  const analytics = read('apps/dashboard/components/analytics/unified-analytics-client.tsx');
  const activityTable = read('apps/dashboard/components/tables/habit-logs/data-table.tsx');

  assert.doesNotMatch(scrubber, /onHoverDate\(day\.date/);
  assert.doesNotMatch(sidebarCss, /\[data-mode="hover"\] \{[\s\S]*transition:\s*width 200ms/);
  assert.doesNotMatch(mainMenu, /transition-all/);
  assert.doesNotMatch(analytics, /transition-all duration-200/);
  assert.doesNotMatch(activityTable, /hoveredRowIndex/);
});

test('Material Symbols and extra Grotesk weights are deferred off first paint', () => {
  const globals = read('apps/dashboard/app/globals.css');
  const deferred = read('apps/dashboard/app/deferred-fonts.css');
  const deferredLoader = read('apps/dashboard/components/deferred-fonts.tsx');

  assert.doesNotMatch(globals, /MaterialSymbolsRounded-400\.ttf/);
  assert.doesNotMatch(globals, /FKGroteskNeueTrial-Thin/);
  assert.match(globals, /FKGroteskNeueTrial-Regular/);
  assert.match(deferred, /MaterialSymbolsRounded-400\.ttf/);
  assert.match(deferredLoader, /deferred-font-sheet/);
});

test('non-Index chrome CSS waits for idle and stays out of globals.css', () => {
  const globals = read('apps/dashboard/app/globals.css');
  const deferred = read('apps/dashboard/app/deferred-chrome.css');
  const loader = read('apps/dashboard/components/deferred-chrome.tsx');
  const layout = read('apps/dashboard/app/(dashboard)/dashboard-layout-client.tsx');

  assert.match(globals, /@import "@ritual\/ui\/globals.css"/);
  assert.doesNotMatch(globals, /animate-voice-pulse/);
  assert.doesNotMatch(globals, /settings-group-card/);
  assert.match(deferred, /animate-voice-pulse/);
  assert.match(deferred, /settings-group-card/);
  assert.match(loader, /deferred-chrome-sheet/);
  assert.match(loader, /runWhenIdle/);
  assert.doesNotMatch(layout, /router\.prefetch/);
  assert.match(layout, /RoutineSchedulerRuntime/);
});

test('chat sidecar is a separate process and the SPA is only a client', () => {
  const rustMain = read('apps/desktop/src-tauri/src/main.rs');
  const sidecar = read('apps/desktop/src-tauri/src/chat_runtime.rs');
  const streamUrl = read('apps/dashboard/lib/chat-stream-url.ts');
  const agentUrl = read('apps/dashboard/lib/agent-url.ts');
  const origins = read('apps/desktop-ui/src/desktop-origins.ts');
  const vite = read('apps/desktop-ui/vite.config.ts');
  const panel = read('apps/dashboard/components/chat/index-chat-panel.tsx');
  const desktopPkg = read('apps/desktop/package.json');

  const setupAt = rustMain.indexOf('.setup(move |app|');
  const sidecarStart = rustMain.indexOf('chat_runtime::start_chat_runtime_sidecar', setupAt);
  const windowShow = rustMain.indexOf('show_ritual_with_dock_icon(app.handle())', sidecarStart);
  assert.ok(setupAt >= 0 && sidecarStart > setupAt && windowShow > sidecarStart);
  assert.match(sidecar, /packages\/agent\/dist\/sidecar\.bundle\.js/);
  assert.match(sidecar, /agent\/sidecar\.mjs/);
  assert.match(sidecar, /ritual-chat-sidecar\.log/);
  assert.match(sidecar, /RITUAL_CHAT_RUNTIME_PORT/);
  assert.match(sidecar, /ritual-agent/);
  assert.doesNotMatch(sidecar, /ritual-node/);
  assert.doesNotMatch(sidecar, /Do not add bun or Node/);
  const bundledAt = sidecar.indexOf('bundled_agent_candidates');
  const homebrewAt = sidecar.indexOf('/opt/homebrew/bin/node');
  assert.ok(bundledAt >= 0 && homebrewAt > bundledAt);
  assert.match(rustMain, /disk_session_init_script/);
  assert.match(rustMain, /main_window_show_on_html_init_script/);
  assert.match(desktopPkg, /sidecar\.bundle\.js src-tauri\/resources\/agent\/sidecar\.mjs/);
  const tauriConf = read('apps/desktop/src-tauri/tauri.conf.json');
  assert.match(tauriConf, /binaries\/ritual-agent/);
  assert.doesNotMatch(tauriConf, /binaries\/ritual-node/);
  assert.match(streamUrl, /__RITUAL_CHAT_ORIGIN__/);
  assert.match(origins, /LOCAL_CHAT_SIDECAR_ORIGIN/);
  assert.match(origins, /probeLocalChatSidecar/);
  assert.match(agentUrl, /shouldUseAgentLoop/);
  assert.match(agentUrl, /\/api\/agent/);
  assert.match(vite, /'\/api\/agent'/);
  assert.match(panel, /shouldUseAgentLoop/);
  assert.match(panel, /useAgentSendMessage/);
});

test('Index chrome drops Pinned and docks a resizable chat panel instead of Context stats', () => {
  const layout = read('apps/dashboard/components/dashboard-layout.tsx');
  const overview = read('apps/dashboard/components/analytics/overview/OverviewView.tsx');
  const panel = read('apps/dashboard/components/chat/index-chat-panel.tsx');
  const form = read('apps/dashboard/components/ai-habit-chat/ai-habit-chat-form.tsx');
  const css = read('apps/dashboard/app/globals.css');
  const metrics = read('apps/dashboard/components/analytics/overview/useOverviewMetrics.ts');
  const analytics = read('apps/dashboard/components/analytics/unified-analytics-client.tsx');

  assert.doesNotMatch(layout, /PinnedSummaryPopover/);
  assert.doesNotMatch(overview, /MetricContextPanel/);
  assert.match(overview, /IndexChatPanel/);
  assert.doesNotMatch(metrics, /useOverviewMetricContext/);
  assert.match(panel, /--ritual-right-dock-width/);
  assert.match(analytics, /--ritual-right-dock-width/);
  assert.match(panel, /Ask anything/);
  assert.match(panel, /cursor-col-resize/);
  assert.match(panel, /Resize chat panel/);
  assert.match(panel, /RESIZE_HANDLE_PX/);
  assert.match(panel, /-translate-x-1\/2/);
  assert.match(panel, /border-l/);
  assert.doesNotMatch(panel, /RESIZE_GUTTER_PX/);
  assert.match(panel, /setPointerCapture/);
  assert.match(panel, /data-tauri-drag-region="false"/);
  assert.match(panel, /ritual-floating-surface/);
  assert.match(form, /color-mix\(in_srgb,var\(--text-primary\)_14%,transparent\)/);
  assert.match(css, /\.app-toolbar-pill-button:hover[\s\S]*background: var\(--row-hover\)/);
});

test('Index composer Chat stays on Index and sends into the right dock', () => {
  const chat = read('apps/dashboard/components/ai-habit-chat.tsx');
  const overview = read('apps/dashboard/components/analytics/overview/OverviewView.tsx');
  const panel = read('apps/dashboard/components/chat/index-chat-panel.tsx');
  const ai = read('apps/dashboard/contexts/AIContext.tsx');

  assert.doesNotMatch(chat, /router\.push\(`\/chat\?q=/);
  assert.doesNotMatch(chat, /router\.prefetch\('\/chat'\)/);
  assert.match(chat, /openIndexChat\(\{ text, focus: false \}\)/);
  assert.match(chat, /openIndexChat\(\{ focus: false \}\)/);
  assert.match(overview, /indexChatOpen/);
  assert.match(overview, /openIndexChat\(\{ focus: true \}\)/);
  assert.match(ai, /takePendingIndexChatTexts/);
  assert.match(panel, /takePendingIndexChatTexts/);
  assert.match(panel, /indexChatEpoch/);
});

test('Index dock does not import the chat barrel or Streamdown', () => {
  const panel = read('apps/dashboard/components/chat/index-chat-panel.tsx');
  const markdown = read('apps/dashboard/components/chat/chat-markdown.tsx');
  const shared = read('apps/dashboard/app/(dashboard)/chat/chat-client.shared.tsx');
  const overview = read('apps/dashboard/components/analytics/overview/OverviewView.tsx');

  assert.doesNotMatch(panel, /chat-client\.shared/);
  assert.doesNotMatch(panel, /from ['"]streamdown['"]/);
  assert.match(panel, /from '@\/components\/chat\/chat-markdown'/);
  assert.match(overview, /dynamic\(/);
  assert.match(overview, /index-chat-panel/);
  assert.match(markdown, /import\('streamdown'\)/);
  assert.match(markdown, /needsRichMarkdown/);
  assert.doesNotMatch(markdown, /from ['"]streamdown['"]/);
  assert.doesNotMatch(shared, /from ['"]streamdown['"]/);
  assert.doesNotMatch(shared, /export \{ Response/);
});

test('Index-eager files stay off Streamdown, Mermaid, Recharts, and the chat barrel', () => {
  const files = [
    'apps/desktop-ui/src/App.tsx',
    'apps/dashboard/app/(dashboard)/dashboard/client-dashboard.tsx',
    'apps/dashboard/components/analytics/unified-analytics-client.tsx',
    'apps/dashboard/components/analytics/overview/OverviewView.tsx',
    'apps/dashboard/components/analytics/overview-initial-section.tsx',
    'apps/dashboard/components/analytics/sortable-habit-list.tsx',
  ];
  for (const file of files) {
    const source = read(file);
    assert.doesNotMatch(source, /chat-client\.shared/, file);
    assert.doesNotMatch(source, /streamdown/, file);
    assert.doesNotMatch(source, /mermaid/, file);
    assert.doesNotMatch(source, /recharts/, file);
  }
});

test('Index path uses the desktop-session and app-navigation seam', () => {
  const files = [
    'apps/dashboard/app/(dashboard)/dashboard/client-dashboard.tsx',
    'apps/dashboard/components/analytics/unified-analytics-client.tsx',
    'apps/dashboard/components/analytics/overview-initial-section.tsx',
    'apps/dashboard/components/analytics/overview-welcome-header.tsx',
    'apps/dashboard/components/chat/index-chat-panel.tsx',
    'apps/dashboard/contexts/HabitsContext.tsx',
  ];
  for (const file of files) {
    const source = read(file);
    assert.doesNotMatch(source, /from ['"]@clerk\/nextjs['"]/, file);
    assert.doesNotMatch(source, /from ['"]next\/navigation['"]/, file);
  }
  assert.match(read('apps/dashboard/lib/desktop-session.ts'), /from '@clerk\/nextjs'/);
  assert.match(read('apps/dashboard/lib/app-navigation.ts'), /from 'next\/navigation'/);
});
