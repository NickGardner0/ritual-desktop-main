export const CHAT_STREAM_FLUSH_INTERVAL_MS = 50;

export function shouldFlushStreamingContent({
  force = false,
  lastFlushAt,
  now,
  intervalMs = CHAT_STREAM_FLUSH_INTERVAL_MS,
}: {
  force?: boolean;
  lastFlushAt: number;
  now: number;
  intervalMs?: number;
}): boolean {
  return force || lastFlushAt <= 0 || now - lastFlushAt >= intervalMs;
}

export function getNextStreamingFlushDelay({
  lastFlushAt,
  now,
  intervalMs = CHAT_STREAM_FLUSH_INTERVAL_MS,
}: {
  lastFlushAt: number;
  now: number;
  intervalMs?: number;
}): number {
  return Math.max(0, intervalMs - Math.max(0, now - lastFlushAt));
}
