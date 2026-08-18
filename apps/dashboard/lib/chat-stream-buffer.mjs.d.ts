export const CHAT_STREAM_FLUSH_INTERVAL_MS: 16;

export function shouldFlushStreamingContent(options: {
  force?: boolean;
  lastFlushAt: number;
  now: number;
  intervalMs?: number;
}): boolean;

export function getNextStreamingFlushDelay(options: {
  lastFlushAt: number;
  now: number;
  intervalMs?: number;
}): number;
