/**
 * Ritual Browser Tracker - Background Service Worker
 *
 * Tracks browser activity and sends heartbeats to the Ritual watcher's
 * local HTTP server. Includes resilient endpoint failover, bounded retries,
 * and offline queue replay.
 */

import {
  getServerCandidates,
  isSameHeartbeat,
  replayQueuedEvents,
  shouldSendTabUpdateHeartbeat,
} from './background-core.js';

// ============================================================
// Configuration
// ============================================================

const CONFIG = {
  serverUrls: [
    'http://127.0.0.1:8766',
    'http://127.0.0.1:8767',
    'http://localhost:8766',
    'http://localhost:8767',
  ],
  heartbeatAlarmName: 'ritual-heartbeat',
  heartbeatIntervalSeconds: 20,
  minimumAlarmMinutes: 0.5, // Chrome may clamp to platform minimum
  keepAliveAlarmName: 'ritual-keepalive',
  keepAliveIntervalMinutes: 1,
  idleDetectionSeconds: 300, // 5 minutes
  maxOfflineQueue: 50,
  requestTimeoutMs: 2000,
};

// ============================================================
// State
// ============================================================

let currentTab = null;
let browserFocused = true;
let idleState = 'active';
let serverConnected = false;
let activeServerUrl = CONFIG.serverUrls[0];
let lastHeartbeatTime = 0;
let totalHeartbeatsSent = 0;
let totalErrors = 0;
let cachedTabCount = 0;
let isReplayingQueue = false;

// ============================================================
// Browser Detection
// ============================================================

function detectBrowser() {
  const ua = navigator.userAgent;
  if (typeof navigator.brave !== 'undefined') return 'brave';
  if (ua.includes('OPR') || ua.includes('Opera')) return 'opera';
  if (ua.includes('Vivaldi')) return 'vivaldi';
  if (ua.includes('Edg/')) return 'edge';
  if (ua.includes('Firefox')) return 'firefox';
  if (ua.includes('Chrome')) return 'chrome';
  if (ua.includes('Safari')) return 'safari';
  return 'unknown';
}

const BROWSER_NAME = detectBrowser();

// ============================================================
// Domain Extraction
// ============================================================

function extractDomain(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (['chrome:', 'chrome-extension:', 'about:', 'brave:', 'edge:', 'vivaldi:'].some(
      (p) => parsed.protocol === p || url.startsWith(p)
    )) {
      return null;
    }
    let host = parsed.hostname;
    if (host.startsWith('www.')) {
      host = host.substring(4);
    }
    return host || null;
  } catch {
    return null;
  }
}

// ============================================================
// Tab Helpers
// ============================================================

async function getActiveTab() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs.length > 0) return tabs[0];

    const allTabs = await chrome.tabs.query({ active: true });
    if (allTabs.length > 0) return allTabs[0];
  } catch (e) {
    console.debug('Failed to get active tab:', e.message);
  }
  return null;
}

async function refreshTabCount() {
  try {
    const tabs = await chrome.tabs.query({});
    cachedTabCount = tabs.length;
  } catch {
    cachedTabCount = 0;
  }
}

function getKnownTabCount() {
  return cachedTabCount > 0 ? cachedTabCount : 0;
}

// ============================================================
// Network Helpers
// ============================================================

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function postHeartbeatPayload(payload) {
  let lastError = null;

  for (const baseUrl of getServerCandidates(activeServerUrl, CONFIG.serverUrls)) {
    try {
      const response = await fetchWithTimeout(
        `${baseUrl}/api/heartbeat`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
        CONFIG.requestTimeoutMs
      );

      if (!response.ok) {
        lastError = new Error(`Server ${baseUrl} returned ${response.status}`);
        continue;
      }

      const result = await response.json().catch(() => ({ status: 'ok' }));
      activeServerUrl = baseUrl;
      return { ok: true, result, serverUrl: baseUrl };
    } catch (e) {
      lastError = e;
    }
  }

  return { ok: false, error: lastError };
}

// ============================================================
// Heartbeat Sending
// ============================================================

async function sendHeartbeat(tab, options = {}) {
  if (!tab?.url || !tab?.title) {
    console.debug('Skipping heartbeat: no URL or title');
    return false;
  }

  const domain = extractDomain(tab.url);
  if (!domain) {
    console.debug('Skipping heartbeat: internal page or no domain');
    return false;
  }

  const heartbeat = {
    url: tab.url,
    domain,
    title: tab.title,
    audible: tab.audible || false,
    incognito: tab.incognito || false,
    tab_count: getKnownTabCount(),
    browser: BROWSER_NAME,
    browser_focused: browserFocused,
    idle_state: idleState,
    timestamp_ms: options.timestampMs || Date.now(),
  };

  const result = await postHeartbeatPayload(heartbeat);

  if (result.ok) {
    serverConnected = true;
    lastHeartbeatTime = Date.now();
    totalHeartbeatsSent++;

    if (!options.skipReplay) {
      await replayOfflineQueue();
    }

    console.debug(
      `Heartbeat ${result.result.status}: ${domain} (session: ${result.result.session_id}, server: ${result.serverUrl})`
    );

    return true;
  }

  serverConnected = false;
  totalErrors++;
  console.debug('Heartbeat failed:', result.error?.message || 'unknown error');

  if (options.queueOnFail !== false) {
    await queueOfflineEvent(heartbeat);
  }

  return false;
}

// ============================================================
// Offline Queue
// ============================================================

async function queueOfflineEvent(heartbeat) {
  try {
    const { offlineQueue = [] } = await chrome.storage.local.get('offlineQueue');

    const last = offlineQueue[offlineQueue.length - 1];
    if (last && isSameHeartbeat(last, heartbeat)) {
      return;
    }

    if (offlineQueue.length >= CONFIG.maxOfflineQueue) {
      offlineQueue.shift();
    }

    offlineQueue.push({
      ...heartbeat,
      queued_at: Date.now(),
    });

    await chrome.storage.local.set({ offlineQueue });
    console.debug(`Queued offline event (${offlineQueue.length} in queue)`);
  } catch (e) {
    console.debug('Failed to queue offline event:', e.message);
  }
}

async function replayOfflineQueue() {
  if (isReplayingQueue) return;

  isReplayingQueue = true;
  try {
    const { offlineQueue = [] } = await chrome.storage.local.get('offlineQueue');
    if (offlineQueue.length === 0) return;

    console.debug(`Replaying ${offlineQueue.length} offline events...`);

    const replayResult = await replayQueuedEvents(offlineQueue, async (event) => {
      const sent = await postHeartbeatPayload(event);
      if (!sent.ok) {
        serverConnected = false;
        return false;
      }

      serverConnected = true;
      lastHeartbeatTime = Date.now();
      totalHeartbeatsSent++;
      return true;
    });

    await chrome.storage.local.set({ offlineQueue: replayResult.remaining });

    if (replayResult.remaining.length === 0) {
      console.debug('Offline queue cleared');
    } else {
      console.debug(`Offline replay paused (${replayResult.remaining.length} remaining)`);
    }
  } catch (e) {
    console.debug('Failed to replay offline queue:', e.message);
  } finally {
    isReplayingQueue = false;
  }
}

// ============================================================
// Core Heartbeat Logic
// ============================================================

async function heartbeat(reason = 'periodic', options = {}) {
  const tab = await getActiveTab();
  if (!tab) {
    console.debug(`Heartbeat skipped (${reason}): no active tab`);
    await updateStatus();
    return;
  }

  currentTab = tab;
  console.debug(`Heartbeat (${reason}): ${tab.url?.substring(0, 60)}`);
  await sendHeartbeat(tab, options);
  await updateStatus();
}

function scheduleHeartbeatAlarm() {
  const periodInMinutes = Math.max(
    CONFIG.heartbeatIntervalSeconds / 60,
    CONFIG.minimumAlarmMinutes
  );

  chrome.alarms.create(CONFIG.heartbeatAlarmName, {
    delayInMinutes: periodInMinutes,
    periodInMinutes,
  });
}

// ============================================================
// Event Listeners
// ============================================================

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    currentTab = tab;
    await heartbeat('tab-activated');
  } catch (e) {
    console.debug('Tab activation error:', e.message);
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (shouldSendTabUpdateHeartbeat(changeInfo, tab)) {
    currentTab = tab;
    const reason = changeInfo.url ? 'url-updated' : 'audible-changed';
    await heartbeat(reason);
  }
});

chrome.tabs.onCreated.addListener(() => {
  cachedTabCount += 1;
});

chrome.tabs.onRemoved.addListener(() => {
  cachedTabCount = Math.max(0, cachedTabCount - 1);
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    browserFocused = false;
    await heartbeat('focus-lost', { queueOnFail: true });
  } else {
    browserFocused = true;
    await heartbeat('focus-gained');
  }
});

chrome.idle.setDetectionInterval(CONFIG.idleDetectionSeconds);
chrome.idle.onStateChanged.addListener(async (newState) => {
  idleState = newState;
  await heartbeat(`idle-${newState}`, { queueOnFail: true });
});

// ============================================================
// Periodic Heartbeat via Alarms
// ============================================================

scheduleHeartbeatAlarm();

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === CONFIG.heartbeatAlarmName) {
    await heartbeat('alarm');
  }
  if (alarm.name === CONFIG.keepAliveAlarmName) {
    console.debug('Keep-alive ping');
  }
});

// ============================================================
// Service Worker Keep-Alive (Chrome MV3)
// ============================================================

chrome.alarms.create(CONFIG.keepAliveAlarmName, {
  periodInMinutes: CONFIG.keepAliveIntervalMinutes,
});

setInterval(() => {
  console.debug('Keep-alive tick');
}, 4 * 60 * 1000);

// ============================================================
// Status Management (for popup)
// ============================================================

async function updateStatus() {
  await chrome.storage.local.set({
    status: {
      connected: serverConnected,
      serverUrl: activeServerUrl,
      browser: BROWSER_NAME,
      lastHeartbeat: lastHeartbeatTime,
      totalHeartbeats: totalHeartbeatsSent,
      totalErrors: totalErrors,
      currentDomain: currentTab ? extractDomain(currentTab.url) : null,
      currentTitle: currentTab?.title || null,
      browserFocused,
      idleState,
      tabCount: getKnownTabCount(),
    },
  });
}

async function checkServerStatus() {
  let lastError = null;
  for (const baseUrl of getServerCandidates(activeServerUrl, CONFIG.serverUrls)) {
    try {
      const response = await fetchWithTimeout(
        `${baseUrl}/api/status`,
        { method: 'GET' },
        CONFIG.requestTimeoutMs
      );
      if (!response.ok) {
        lastError = new Error(`Status check ${response.status}`);
        continue;
      }
      const data = await response.json();
      activeServerUrl = baseUrl;
      serverConnected = true;
      return { connected: true, serverUrl: baseUrl, ...data };
    } catch (e) {
      lastError = e;
    }
  }

  serverConnected = false;
  return { connected: false, error: lastError?.message };
}

// ============================================================
// Extension Lifecycle
// ============================================================

chrome.runtime.onInstalled.addListener(async (details) => {
  console.info(`Ritual Browser Tracker installed (${details.reason})`);

  scheduleHeartbeatAlarm();
  await refreshTabCount();

  await chrome.storage.local.set({
    enabled: true,
    offlineQueue: [],
    status: {
      connected: false,
      serverUrl: activeServerUrl,
      browser: BROWSER_NAME,
      lastHeartbeat: 0,
      totalHeartbeats: 0,
      totalErrors: 0,
      currentDomain: null,
      currentTitle: null,
      browserFocused: true,
      idleState: 'active',
      tabCount: cachedTabCount,
    },
  });

  await heartbeat('install');
});

chrome.runtime.onStartup.addListener(async () => {
  console.info('Ritual Browser Tracker starting (browser opened)');
  scheduleHeartbeatAlarm();
  await refreshTabCount();
  await heartbeat('startup');
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'getStatus') {
    chrome.storage.local.get('status').then(({ status }) => {
      sendResponse(status || {});
    });
    return true;
  }

  if (message.type === 'forceHeartbeat') {
    heartbeat('manual').then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message.type === 'checkServer') {
    checkServerStatus().then((data) => {
      sendResponse(data);
    });
    return true;
  }

  return false;
});

// Boot-time initialization for service worker restarts.
refreshTabCount().then(() => heartbeat('service-worker-start'));
console.info(`Ritual Browser Tracker loaded (browser: ${BROWSER_NAME})`);
