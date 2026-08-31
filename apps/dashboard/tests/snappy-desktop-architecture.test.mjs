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

  assert.match(overview, /import \{ SortableHabitList/);
  assert.doesNotMatch(overview, /dynamic\(\s*\(\) => import\('@\/components\/analytics\/sortable-habit-list'/);
  assert.match(habits, /placeholderData/);
  assert.match(habits, /readLocalVaultHabits/);
  assert.match(filters, /getLast14DaysRange/);
  assert.doesNotMatch(filters, /Default to "All time"/);
  assert.match(metrics, /hasRenderableCachedHabits/);
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

test('chat sidecar is a separate process and the SPA is only a client', () => {
  const rustMain = read('apps/desktop/src-tauri/src/main.rs');
  const sidecar = read('apps/desktop/src-tauri/src/chat_runtime.rs');
  const streamUrl = read('apps/dashboard/lib/chat-stream-url.ts');
  const origins = read('apps/desktop-ui/src/desktop-origins.ts');

  const setupAt = rustMain.indexOf('.setup(move |app|');
  const sidecarStart = rustMain.indexOf('chat_runtime::start_chat_runtime_sidecar', setupAt);
  const windowShow = rustMain.indexOf('show_ritual_with_dock_icon(app.handle())', sidecarStart);
  assert.ok(setupAt >= 0 && sidecarStart > setupAt && windowShow > sidecarStart);
  assert.match(sidecar, /RITUAL_CHAT_RUNTIME_PORT/);
  assert.match(streamUrl, /__RITUAL_CHAT_ORIGIN__/);
  assert.match(origins, /LOCAL_CHAT_SIDECAR_ORIGIN/);
  assert.match(origins, /probeLocalChatSidecar/);
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
  assert.match(panel, /RESIZE_GUTTER_PX/);
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
