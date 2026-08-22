const OUTBOX_PREFIX = 'ritual:assistant-outbox:v1:';

export type AssistantTurnOutboxItem = {
  turnId: string;
  epoch: number;
  conversationId: string | null;
  body: Record<string, unknown>;
  queuedAt: string;
  status: 'queued_local' | 'failed_retryable';
  attempts: number;
  lastError?: string | null;
};

function keyFor(userId: string): string {
  return `${OUTBOX_PREFIX}${userId}`;
}

export function readAssistantTurnOutbox(userId: string): AssistantTurnOutboxItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(keyFor(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.map((item) => ({
          ...item,
          status: item?.status === 'failed_retryable' ? 'failed_retryable' : 'queued_local',
          attempts: typeof item?.attempts === 'number' ? item.attempts : 0,
        }))
      : [];
  } catch {
    return [];
  }
}

export function enqueueAssistantTurnOutbox(userId: string, item: AssistantTurnOutboxItem): void {
  if (typeof window === 'undefined') return;
  const items = readAssistantTurnOutbox(userId).filter((existing) => existing.turnId !== item.turnId);
  items.push(item);
  window.localStorage.setItem(keyFor(userId), JSON.stringify(items.slice(-20)));
}

export function removeAssistantTurnOutbox(userId: string, turnId: string): void {
  if (typeof window === 'undefined') return;
  const items = readAssistantTurnOutbox(userId).filter((item) => item.turnId !== turnId);
  window.localStorage.setItem(keyFor(userId), JSON.stringify(items));
}

export async function drainAssistantTurnOutbox(
  userId: string,
  post: (item: AssistantTurnOutboxItem) => Promise<boolean>,
): Promise<void> {
  const items = readAssistantTurnOutbox(userId);
  for (const item of items) {
    try {
      const ok = await post(item);
      if (ok) {
        removeAssistantTurnOutbox(userId, item.turnId);
      } else {
        enqueueAssistantTurnOutbox(userId, {
          ...item,
          status: 'failed_retryable',
          attempts: item.attempts + 1,
          lastError: 'Replay was not durably accepted or committed',
        });
      }
    } catch (error) {
      enqueueAssistantTurnOutbox(userId, {
        ...item,
        status: 'failed_retryable',
        attempts: item.attempts + 1,
        lastError: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
