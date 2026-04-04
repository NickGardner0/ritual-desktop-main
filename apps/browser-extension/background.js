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
  defaultServerUrls: [
    'http://127.0.0.1:8766',
    'http://127.0.0.1:8767',
    'http://localhost:8766',
    'http://localhost:8767',
  ],
  serverUrlsStorageKey: 'serverUrls',
  activeServerUrlStorageKey: 'serverUrl',
  heartbeatAlarmName: 'ritual-heartbeat',
  heartbeatIntervalSeconds: 20,
  minimumAlarmMinutes: 0.5, // Chrome may clamp to platform minimum
  keepAliveAlarmName: 'ritual-keepalive',
  keepAliveIntervalMinutes: 1,
  idleDetectionSeconds: 300, // 5 minutes
  maxOfflineQueue: 50,
  requestTimeoutMs: 2000,
  reconnectBaseDelayMs: 1000,
  reconnectMaxDelayMs: 60000,
};

// ============================================================
// State
// ============================================================

let currentTab = null;
let browserFocused = true;
let idleState = 'active';
let serverConnected = false;
let serverUrls = [...CONFIG.defaultServerUrls];
let activeServerUrl = serverUrls[0];
let lastHeartbeatTime = 0;
let totalHeartbeatsSent = 0;
let totalErrors = 0;
let cachedTabCount = 0;
let isReplayingQueue = false;
let reconnectAttempts = 0;
let nextReconnectAllowedAt = 0;

function normalizeServerUrl(candidate) {
  if (!candidate || typeof candidate !== 'string') {
    return null;
  }

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function sanitizeServerUrls(candidates) {
  if (!Array.isArray(candidates)) {
    return [...CONFIG.defaultServerUrls];
  }

  const normalized = candidates
    .map((candidate) => normalizeServerUrl(candidate))
    .filter((value) => Boolean(value));

  return normalized.length > 0
    ? [...new Set(normalized)]
    : [...CONFIG.defaultServerUrls];
}

async function loadServerConfig() {
  try {
    const result = await chrome.storage.local.get([
      CONFIG.serverUrlsStorageKey,
      CONFIG.activeServerUrlStorageKey,
    ]);

    serverUrls = sanitizeServerUrls(result[CONFIG.serverUrlsStorageKey]);

    const persistedActiveServer = normalizeServerUrl(result[CONFIG.activeServerUrlStorageKey]);
    if (persistedActiveServer && serverUrls.includes(persistedActiveServer)) {
      activeServerUrl = persistedActiveServer;
    } else if (!serverUrls.includes(activeServerUrl)) {
      activeServerUrl = serverUrls[0];
    }
  } catch (e) {
    console.debug('Failed to load server config:', e.message);
    serverUrls = [...CONFIG.defaultServerUrls];
    if (!serverUrls.includes(activeServerUrl)) {
      activeServerUrl = serverUrls[0];
    }
  }
}

async function persistActiveServerUrl() {
  try {
    await chrome.storage.local.set({
      [CONFIG.activeServerUrlStorageKey]: activeServerUrl,
    });
  } catch (e) {
    console.debug('Failed to persist active server URL:', e.message);
  }
}

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

function hashString(input) {
  let hash = 2166136261;
  const text = String(input || '');
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `h${(hash >>> 0).toString(16)}`;
}

async function captureVisibleContext(tab) {
  if (!tab?.id) {
    return {
      documentTitle: tab?.title || null,
      visibleTextRaw: '',
      visibleTextNorm: '',
      metaDescription: null,
      selectionText: '',
      focusedElementText: '',
      headings: [],
      semanticBlocks: [],
      captureQuality: 0.25,
      dedupKey: null,
      isSensitiveRedacted: false,
    };
  }

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: () => {
        const normalize = (value) =>
          String(value || '')
            .replace(/\s+/g, ' ')
            .trim();

        const MAX_TEXT_LENGTH = 12000;
        const MAX_TEXT_NODES = 250;

        const isVisibleElement = (element) => {
          if (!element || typeof window.getComputedStyle !== 'function') {
            return false;
          }

          const style = window.getComputedStyle(element);
          if (!style || style.display === 'none' || style.visibility === 'hidden') {
            return false;
          }
          if (Number(style.opacity || '1') === 0) {
            return false;
          }

          const rect = typeof element.getBoundingClientRect === 'function'
            ? element.getBoundingClientRect()
            : null;
          if (!rect) return true;
          return rect.width > 0 && rect.height > 0;
        };

        const shouldSkipElement = (element) => {
          if (!element?.tagName) return false;
          const tag = element.tagName.toLowerCase();
          return [
            'script',
            'style',
            'noscript',
            'svg',
            'canvas',
            'img',
            'video',
            'audio',
            'iframe',
          ].includes(tag);
        };

        const uniquePush = (target, seen, rawValue, maxLen = 320) => {
          const value = normalize(rawValue).slice(0, maxLen);
          if (!value) return;
          const key = value.toLowerCase();
          if (seen.has(key)) return;
          seen.add(key);
          target.push(value);
        };

        const collectVisibleText = (root) => {
          if (!root || typeof document.createTreeWalker !== 'function') {
            return [];
          }

          const textChunks = [];
          const seen = new Set();
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
              const text = normalize(node?.textContent || '');
              if (!text) return NodeFilter.FILTER_REJECT;
              const parent = node.parentElement;
              if (!parent || shouldSkipElement(parent) || !isVisibleElement(parent)) {
                return NodeFilter.FILTER_REJECT;
              }
              return NodeFilter.FILTER_ACCEPT;
            },
          });

          let current;
          while ((current = walker.nextNode()) && textChunks.length < MAX_TEXT_NODES) {
            const text = normalize(current.textContent || '');
            if (!text) continue;
            const key = text.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            textChunks.push(text);
          }
          return textChunks;
        };

        const passwordFields = Array.from(
          document.querySelectorAll('input[type="password"], [data-sensitive="true"]')
        );
        const metaDescription = normalize(
          document.querySelector('meta[name="description"]')?.content
          || document.querySelector('meta[property="og:description"]')?.content
          || ''
        ) || null;
        const headingsSeen = new Set();
        const headings = Array.from(
          document.querySelectorAll('h1, h2, h3, [role="heading"], main h4')
        )
          .map((node) => normalize(node.textContent))
          .filter((value) => {
            if (!value) return false;
            const key = value.toLowerCase();
            if (headingsSeen.has(key)) return false;
            headingsSeen.add(key);
            return true;
          })
          .slice(0, 12);

        const fragments = [];
        const fragmentSeen = new Set();
        const semanticBlocks = [];
        const semanticSeen = new Set();
        const selectionText = normalize(window.getSelection?.()?.toString?.() || '');
        const focusedElementText = normalize(
          document.activeElement?.value
          || document.activeElement?.innerText
          || document.activeElement?.textContent
          || ''
        );
        const contentRoot = document.querySelector(
          'main, article, [role="main"], [data-testid="primaryColumn"], ytd-watch-metadata, #content'
        ) || document.body;

        uniquePush(fragments, fragmentSeen, selectionText, 1200);
        uniquePush(fragments, fragmentSeen, focusedElementText, 1600);
        uniquePush(fragments, fragmentSeen, metaDescription, 600);
        uniquePush(semanticBlocks, semanticSeen, selectionText ? `Selected text: ${selectionText}` : '', 1400);
        uniquePush(
          semanticBlocks,
          semanticSeen,
          focusedElementText ? `Focused element: ${focusedElementText}` : '',
          1800
        );
        uniquePush(
          semanticBlocks,
          semanticSeen,
          metaDescription ? `Page summary: ${metaDescription}` : '',
          800
        );
        for (const heading of headings) {
          uniquePush(fragments, fragmentSeen, heading, 220);
          uniquePush(semanticBlocks, semanticSeen, `Heading: ${heading}`, 260);
        }
        for (const chunk of collectVisibleText(contentRoot)) {
          uniquePush(fragments, fragmentSeen, chunk, 360);
          if (semanticBlocks.length < 12) {
            uniquePush(semanticBlocks, semanticSeen, `Visible text: ${chunk}`, 420);
          }
          if (fragments.join(' ').length >= MAX_TEXT_LENGTH) {
            break;
          }
        }

        const bodyText = normalize(document.body?.innerText || '');
        if (!fragments.length && bodyText) {
          uniquePush(fragments, fragmentSeen, bodyText, MAX_TEXT_LENGTH);
        }
        if (!fragments.length) {
          uniquePush(fragments, fragmentSeen, document.title, 220);
        }

        const visibleTextRaw = normalize(fragments.join(' | ')).slice(0, MAX_TEXT_LENGTH);
        const visibleTextNorm = visibleTextRaw.toLowerCase();

        return {
          documentTitle: normalize(document.title) || null,
          visibleTextRaw,
          visibleTextNorm,
          metaDescription,
          selectionText,
          focusedElementText,
          headings,
          semanticBlocks: semanticBlocks.slice(0, 16),
          captureQuality: visibleTextNorm ? 0.98 : 0.35,
          isSensitiveRedacted: passwordFields.length > 0,
        };
      },
    });

    const frameResults = Array.isArray(results)
      ? results.map((entry) => entry?.result).filter(Boolean)
      : [];
    const headings = [];
    const headingSeen = new Set();
    const visibleChunks = [];
    const chunkSeen = new Set();
    const semanticBlocks = [];
    const semanticSeen = new Set();
    let documentTitle = tab.title || null;
    let metaDescription = null;
    let selectionText = '';
    let focusedElementText = '';
    let captureQuality = 0.25;
    let isSensitiveRedacted = false;

    for (const extracted of frameResults) {
      if (!documentTitle && extracted?.documentTitle) {
        documentTitle = extracted.documentTitle;
      }
      if (!metaDescription && extracted?.metaDescription) {
        metaDescription = extracted.metaDescription;
      }
      if (
        typeof extracted?.selectionText === 'string'
        && extracted.selectionText.length > selectionText.length
      ) {
        selectionText = extracted.selectionText;
      }
      if (
        typeof extracted?.focusedElementText === 'string'
        && extracted.focusedElementText.length > focusedElementText.length
      ) {
        focusedElementText = extracted.focusedElementText;
      }
      if (typeof extracted?.captureQuality === 'number') {
        captureQuality = Math.max(captureQuality, extracted.captureQuality);
      }
      isSensitiveRedacted = isSensitiveRedacted || Boolean(extracted?.isSensitiveRedacted);

      for (const heading of Array.isArray(extracted?.headings) ? extracted.headings : []) {
        const normalized = String(heading || '').trim();
        if (!normalized) continue;
        const key = normalized.toLowerCase();
        if (headingSeen.has(key)) continue;
        headingSeen.add(key);
        headings.push(normalized);
      }
      for (const block of Array.isArray(extracted?.semanticBlocks) ? extracted.semanticBlocks : []) {
        const normalized = String(block || '').trim();
        if (!normalized) continue;
        const key = normalized.toLowerCase();
        if (semanticSeen.has(key)) continue;
        semanticSeen.add(key);
        semanticBlocks.push(normalized);
      }

      const raw = String(extracted?.visibleTextRaw || '').trim();
      if (!raw) continue;
      const key = raw.toLowerCase();
      if (chunkSeen.has(key)) continue;
      chunkSeen.add(key);
      visibleChunks.push(raw);
    }

    const visibleTextRaw = visibleChunks.join(' | ').slice(0, 12000);
    const visibleTextNorm = visibleTextRaw.toLowerCase();
    const dedupKey = hashString(
      [
        tab.url || '',
        tab.title || '',
        documentTitle || '',
        metaDescription || '',
        selectionText || '',
        focusedElementText || '',
        semanticBlocks.slice(0, 8).join('|'),
        visibleTextNorm.slice(0, 4000),
      ].join('|')
    );
    return {
      documentTitle,
      visibleTextRaw,
      visibleTextNorm,
      metaDescription,
      selectionText,
      focusedElementText,
      headings,
      semanticBlocks: semanticBlocks.slice(0, 16),
      captureQuality: visibleTextNorm ? Math.max(captureQuality, 0.92) : captureQuality,
      dedupKey,
      isSensitiveRedacted,
    };
  } catch (error) {
    console.debug('Visible context capture failed:', error?.message || error);
    return {
      documentTitle: tab?.title || null,
      visibleTextRaw: '',
      visibleTextNorm: '',
      metaDescription: null,
      selectionText: '',
      focusedElementText: '',
      headings: [],
      semanticBlocks: [],
      captureQuality: 0.25,
      dedupKey: hashString([tab?.url || '', tab?.title || '', Date.now() / 120000 | 0].join('|')),
      isSensitiveRedacted: false,
    };
  }
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

  for (const baseUrl of getServerCandidates(activeServerUrl, serverUrls)) {
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
      await persistActiveServerUrl();
      return { ok: true, result, serverUrl: baseUrl };
    } catch (e) {
      lastError = e;
    }
  }

  return { ok: false, error: lastError };
}

function resetReconnectBackoff() {
  reconnectAttempts = 0;
  nextReconnectAllowedAt = 0;
}

function scheduleReconnectBackoff() {
  reconnectAttempts += 1;
  const exponentialDelay = CONFIG.reconnectBaseDelayMs * (2 ** (reconnectAttempts - 1));
  const delayMs = Math.min(CONFIG.reconnectMaxDelayMs, exponentialDelay);
  nextReconnectAllowedAt = Date.now() + delayMs;
  return delayMs;
}

function getReconnectWaitMs() {
  const waitMs = nextReconnectAllowedAt - Date.now();
  return waitMs > 0 ? waitMs : 0;
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

  const visibleContext = await captureVisibleContext(tab);
  const heartbeat = {
    url: tab.url,
    domain,
    title: tab.title,
    document_title: visibleContext.documentTitle,
    visible_text_raw: visibleContext.visibleTextRaw,
    visible_text_norm: visibleContext.visibleTextNorm,
    meta_description: visibleContext.metaDescription,
    selection_text: visibleContext.selectionText,
    focused_element_text: visibleContext.focusedElementText,
    headings: visibleContext.headings,
    semantic_blocks: visibleContext.semanticBlocks,
    capture_quality: visibleContext.captureQuality,
    dedup_key: visibleContext.dedupKey,
    is_sensitive_redacted: visibleContext.isSensitiveRedacted,
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
    resetReconnectBackoff();

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
  const retryDelayMs = scheduleReconnectBackoff();
  console.debug('Heartbeat failed:', result.error?.message || 'unknown error');
  console.debug(`Next reconnect attempt in ${retryDelayMs}ms`);

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
  if (!options.ignoreBackoff) {
    const waitMs = getReconnectWaitMs();
    if (waitMs > 0) {
      console.debug(`Heartbeat skipped (${reason}): reconnect backoff ${waitMs}ms remaining`);
      await updateStatus();
      return;
    }
  }

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
      reconnectAttempts,
      reconnectInMs: getReconnectWaitMs(),
    },
  });
}

async function checkServerStatus() {
  let lastError = null;
  for (const baseUrl of getServerCandidates(activeServerUrl, serverUrls)) {
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
      await persistActiveServerUrl();
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

  await loadServerConfig();
  scheduleHeartbeatAlarm();
  await refreshTabCount();

  await chrome.storage.local.set({
    enabled: true,
    offlineQueue: [],
    [CONFIG.serverUrlsStorageKey]: serverUrls,
    [CONFIG.activeServerUrlStorageKey]: activeServerUrl,
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
  await loadServerConfig();
  scheduleHeartbeatAlarm();
  await refreshTabCount();
  await heartbeat('startup');
});

chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName !== 'local') {
    return;
  }

  if (changes[CONFIG.serverUrlsStorageKey] || changes[CONFIG.activeServerUrlStorageKey]) {
    await loadServerConfig();
    await updateStatus();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'getStatus') {
    chrome.storage.local.get('status').then(({ status }) => {
      sendResponse(status || {});
    });
    return true;
  }

  if (message.type === 'forceHeartbeat') {
    heartbeat('manual', { ignoreBackoff: true }).then(() => {
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
loadServerConfig().then(() => refreshTabCount().then(() => heartbeat('service-worker-start')));
console.info(`Ritual Browser Tracker loaded (browser: ${BROWSER_NAME})`);
