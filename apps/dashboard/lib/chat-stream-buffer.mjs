export const CHAT_STREAM_FLUSH_INTERVAL_MS = 16;

export function shouldFlushStreamingContent({
  force = false,
  lastFlushAt,
  now,
  intervalMs = CHAT_STREAM_FLUSH_INTERVAL_MS,
} = {}) {
  return force || lastFlushAt <= 0 || now - lastFlushAt >= intervalMs;
}

export function getNextStreamingFlushDelay({
  lastFlushAt,
  now,
  intervalMs = CHAT_STREAM_FLUSH_INTERVAL_MS,
} = {}) {
  return Math.max(0, intervalMs - Math.max(0, now - lastFlushAt));
}
