/**
 * Pure helper logic for the Ritual browser extension background worker.
 * Kept side-effect free so metric-integrity behavior can be unit tested.
 */

export function getServerCandidates(activeServerUrl, serverUrls) {
  const candidates = [];

  if (activeServerUrl) {
    candidates.push(activeServerUrl);
  }

  for (const url of serverUrls) {
    if (!candidates.includes(url)) {
      candidates.push(url);
    }
  }

  return candidates;
}

export function isSameHeartbeat(a, b) {
  const arrayKey = (value) => JSON.stringify(Array.isArray(value) ? value : []);
  return (
    a.url === b.url &&
    a.domain === b.domain &&
    a.title === b.title &&
    a.document_title === b.document_title &&
    a.visible_text_norm === b.visible_text_norm &&
    a.meta_description === b.meta_description &&
    a.selection_text === b.selection_text &&
    a.focused_element_text === b.focused_element_text &&
    arrayKey(a.headings) === arrayKey(b.headings) &&
    arrayKey(a.semantic_blocks) === arrayKey(b.semantic_blocks) &&
    a.audible === b.audible &&
    a.incognito === b.incognito &&
    a.browser_focused === b.browser_focused &&
    a.idle_state === b.idle_state
  );
}

export const OUTBOX_VERSION = 1;

export function createSerializedExecutor(onError = () => {}) {
  let tail = Promise.resolve();
  return (operation) => {
    const result = tail.then(operation, operation);
    tail = result.catch(onError);
    return result;
  };
}

export function hydrateOutboxState(storedState, legacyQueue = []) {
  if (
    storedState?.version === OUTBOX_VERSION &&
    Array.isArray(storedState.pending)
  ) {
    return {
      version: OUTBOX_VERSION,
      pending: storedState.pending,
      reconnectAttempts: Number.isFinite(storedState.reconnectAttempts)
        ? Math.max(0, storedState.reconnectAttempts)
        : 0,
      retryAt: Number.isFinite(storedState.retryAt)
        ? Math.max(0, storedState.retryAt)
        : 0,
    };
  }

  return {
    version: OUTBOX_VERSION,
    pending: Array.isArray(legacyQueue) ? legacyQueue : [],
    reconnectAttempts: 0,
    retryAt: 0,
  };
}

export function enqueueOutboxEvent(state, heartbeat, maxPending, queuedAt = Date.now()) {
  const pending = [...state.pending];
  const last = pending[pending.length - 1];

  if (!last || !isSameHeartbeat(last, heartbeat)) {
    pending.push({ ...heartbeat, queued_at: queuedAt });
  }

  return {
    ...state,
    pending: pending.slice(-maxPending),
  };
}

export function acknowledgeOutboxHead(state) {
  return {
    ...state,
    pending: state.pending.slice(1),
  };
}

export function shouldSendTabUpdateHeartbeat(changeInfo, tab) {
  if (!tab?.active) {
    return false;
  }

  return Boolean(changeInfo.url) || changeInfo.audible !== undefined;
}
