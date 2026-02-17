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
  return (
    a.url === b.url &&
    a.domain === b.domain &&
    a.title === b.title &&
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
