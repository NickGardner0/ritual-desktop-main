import {
  canTransitionAssistantTurn,
  createQueuedTurn,
  isTerminalTurnStatus,
  nowIso,
  type AssistantChannel,
  type AssistantTurnRecord,
  type AssistantTurnStatus,
} from './assistant-turn.js';
import type { AssistantTurnStore } from './assistant-turn-store.js';

export const STALE_IN_FLIGHT_MS = 5 * 60 * 1000;

export function isInFlightTurnStatus(status: AssistantTurnStatus): boolean {
  return status === 'running' || status === 'committing';
}

export function isStaleInFlightTurn(turn: AssistantTurnRecord, nowMs = Date.now()): boolean {
  if (!isInFlightTurnStatus(turn.status)) return false;
  const updatedAt = Date.parse(turn.updatedAt);
  if (!Number.isFinite(updatedAt)) return false;
  return nowMs - updatedAt > STALE_IN_FLIGHT_MS;
}

export class AssistantTurnConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssistantTurnConflictError';
  }
}

export class AssistantSessionBusyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssistantSessionBusyError';
  }
}

function sessionKey(conversationId: string | null, turnId: string): string {
  return conversationId ? `conversation:${conversationId}` : `turn:${turnId}`;
}

export class MutationSessionGate {
  private readonly active = new Map<string, string>();

  tryAcquire(conversationId: string | null, turnId: string): boolean {
    const key = sessionKey(conversationId, turnId);
    const owner = this.active.get(key);
    if (!owner || owner === turnId) {
      this.active.set(key, turnId);
      return true;
    }
    return false;
  }

  release(conversationId: string | null, turnId: string): void {
    const key = sessionKey(conversationId, turnId);
    if (this.active.get(key) === turnId) {
      this.active.delete(key);
    }
  }
}

export class AssistantKernel {
  constructor(private readonly sessions = new MutationSessionGate()) {}

  async begin(input: {
    turnId: string;
    conversationId?: string | null;
    channel: AssistantChannel;
    epoch: number;
    store: AssistantTurnStore;
  }): Promise<AssistantTurnRecord> {
    const existing = await input.store.get(input.turnId);
    if (existing) {
      if (existing.status === 'completed' || existing.status === 'canceled') {
        return existing;
      }
      if (existing.epoch !== input.epoch) {
        if (canTransitionAssistantTurn(existing.status, 'canceled')) {
          return this.transition(existing, 'canceled', input.store, {
            error: 'stale_epoch',
          });
        }
        return existing;
      }
      if (existing.status === 'failed') {
        return this.transition(existing, 'queued', input.store, { error: null });
      }
      if (isStaleInFlightTurn(existing)) {
        const failed = await this.fail(existing, input.store, 'stale_in_flight');
        if (failed.status === 'failed') {
          return this.transition(failed, 'queued', input.store, { error: null });
        }
        return failed;
      }
      return existing;
    }

    const record = createQueuedTurn({
      id: input.turnId,
      conversationId: input.conversationId,
      channel: input.channel,
      epoch: input.epoch,
      sequence: await input.store.nextSequence(input.conversationId ?? null),
    });
    return input.store.put(record);
  }

  async transition(
    turn: AssistantTurnRecord,
    status: AssistantTurnStatus,
    store: AssistantTurnStore,
    patch: Partial<Pick<AssistantTurnRecord, 'error' | 'assistantText' | 'toolPayload' | 'receiptIds' | 'conversationId'>> = {},
  ): Promise<AssistantTurnRecord> {
    if (!canTransitionAssistantTurn(turn.status, status)) {
      throw new AssistantTurnConflictError(
        `Illegal assistant turn transition ${turn.status} -> ${status}`,
      );
    }
    const timestamp = nowIso();
    const ended = status === 'completed' || status === 'canceled' || status === 'failed';
    const next: AssistantTurnRecord = {
      ...turn,
      ...patch,
      status,
      updatedAt: timestamp,
      completedAt: ended ? timestamp : (status === 'queued' || status === 'running' ? null : turn.completedAt),
    };
    return store.put(next);
  }

  acquireMutation(turn: AssistantTurnRecord): void {
    if (!this.sessions.tryAcquire(turn.conversationId, turn.id)) {
      throw new AssistantSessionBusyError(
        `Conversation ${turn.conversationId || turn.id} already has an active mutation sequence`,
      );
    }
  }

  releaseMutation(turn: AssistantTurnRecord): void {
    this.sessions.release(turn.conversationId, turn.id);
  }

  assertLiveEpoch(turn: AssistantTurnRecord, epoch: number): void {
    if (turn.epoch !== epoch) {
      throw new AssistantTurnConflictError('stale_epoch');
    }
  }

  async fail(
    turn: AssistantTurnRecord,
    store: AssistantTurnStore,
    error: unknown,
  ): Promise<AssistantTurnRecord> {
    const latest = (await store.get(turn.id)) || turn;
    if (isTerminalTurnStatus(latest.status)) return latest;
    if (!canTransitionAssistantTurn(latest.status, 'failed')) return latest;
    return this.transition(latest, 'failed', store, {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  async cancel(
    turn: AssistantTurnRecord,
    store: AssistantTurnStore,
    reason: unknown = 'client_disconnected',
  ): Promise<AssistantTurnRecord> {
    const latest = (await store.get(turn.id)) || turn;
    if (isTerminalTurnStatus(latest.status) || latest.status === 'failed') return latest;
    if (!canTransitionAssistantTurn(latest.status, 'canceled')) return latest;
    return this.transition(latest, 'canceled', store, {
      error: reason instanceof Error ? reason.message : String(reason),
    });
  }

  async commit(
    turn: AssistantTurnRecord,
    store: AssistantTurnStore,
    epoch: number,
    patch: Partial<Pick<AssistantTurnRecord, 'assistantText' | 'toolPayload' | 'receiptIds' | 'conversationId'>>,
  ): Promise<AssistantTurnRecord> {
    const latest = (await store.get(turn.id)) || turn;
    if (isTerminalTurnStatus(latest.status) || latest.status === 'failed') return latest;
    this.assertLiveEpoch(latest, epoch);
    const committing = latest.status === 'committing'
      ? latest
      : await this.transition(latest, 'committing', store, patch);
    return this.transition(committing, 'completed', store);
  }
}

export const defaultAssistantKernel = new AssistantKernel();
