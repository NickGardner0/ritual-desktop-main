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

export async function replayQueuedEvents(offlineQueue, sendFn) {
  const remaining = [];
  let replayedCount = 0;

  for (let i = 0; i < offlineQueue.length; i++) {
    const event = offlineQueue[i];
    const sent = await sendFn(event);

    if (!sent) {
      for (let j = i; j < offlineQueue.length; j++) {
        remaining.push(offlineQueue[j]);
      }
      return {
        replayedCount,
        remaining,
        failedAt: i,
      };
    }

    replayedCount += 1;
  }

  return {
    replayedCount,
    remaining,
    failedAt: null,
  };
}

export function shouldSendTabUpdateHeartbeat(changeInfo, tab) {
  if (!tab?.active) {
    return false;
  }

  return Boolean(changeInfo.url) || changeInfo.audible !== undefined;
}
