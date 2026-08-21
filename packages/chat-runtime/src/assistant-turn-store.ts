import { fetchPythonApi, fetchPythonApiPost } from './executors/shared-api.js';
import type { AssistantTurnRecord } from './assistant-turn.js';
import { isAssistantTurnStatus } from './assistant-turn.js';

export interface AssistantTurnStore {
  get(turnId: string): Promise<AssistantTurnRecord | null>;
  put(record: AssistantTurnRecord): Promise<AssistantTurnRecord>;
  nextSequence(conversationId: string | null): Promise<number>;
}

export class MemoryAssistantTurnStore implements AssistantTurnStore {
  private readonly records = new Map<string, AssistantTurnRecord>();
  private readonly sequences = new Map<string, number>();

  async get(turnId: string): Promise<AssistantTurnRecord | null> {
    return this.records.get(turnId) ?? null;
  }

  async put(record: AssistantTurnRecord): Promise<AssistantTurnRecord> {
    this.records.set(record.id, record);
    return record;
  }

  async nextSequence(conversationId: string | null): Promise<number> {
    const key = conversationId || '_unassigned';
    const next = (this.sequences.get(key) || 0) + 1;
    this.sequences.set(key, next);
    return next;
  }
}

function parseTurnRecord(payload: unknown): AssistantTurnRecord | null {
  if (!payload || typeof payload !== 'object') return null;
  const value = payload as Record<string, unknown>;
  if (typeof value.id !== 'string' || !isAssistantTurnStatus(value.status)) return null;
  if (typeof value.channel !== 'string' || typeof value.epoch !== 'number') return null;
  return {
    id: value.id,
    conversationId: typeof value.conversation_id === 'string' ? value.conversation_id : null,
    channel: value.channel === 'sms' ? 'sms' : 'dashboard',
    status: value.status,
    epoch: value.epoch,
    sequence: typeof value.sequence === 'number' ? value.sequence : 0,
    receiptIds: Array.isArray(value.receipt_ids)
      ? value.receipt_ids.filter((item): item is string => typeof item === 'string')
      : [],
    assistantText: typeof value.assistant_text === 'string' ? value.assistant_text : null,
    toolPayload: value.tool_payload && typeof value.tool_payload === 'object'
      ? value.tool_payload as Record<string, unknown>
      : null,
    error: typeof value.error === 'string' ? value.error : null,
    createdAt: typeof value.created_at === 'string' ? value.created_at : new Date().toISOString(),
    updatedAt: typeof value.updated_at === 'string' ? value.updated_at : new Date().toISOString(),
    completedAt: typeof value.completed_at === 'string' ? value.completed_at : null,
  };
}

export class HttpAssistantTurnStore implements AssistantTurnStore {
  constructor(private readonly token: string) {}

  async get(turnId: string): Promise<AssistantTurnRecord | null> {
    try {
      const payload = await fetchPythonApi(`/api/assistant-turns/${turnId}`, this.token);
      return parseTurnRecord(payload);
    } catch {
      return null;
    }
  }

  async put(record: AssistantTurnRecord): Promise<AssistantTurnRecord> {
    const payload = await fetchPythonApiPost('/api/assistant-turns', this.token, {
      id: record.id,
      conversation_id: record.conversationId,
      channel: record.channel,
      status: record.status,
      epoch: record.epoch,
      sequence: record.sequence,
      receipt_ids: record.receiptIds,
      assistant_text: record.assistantText,
      tool_payload: record.toolPayload,
      error: record.error,
      completed_at: record.completedAt,
    });
    return parseTurnRecord(payload) || record;
  }

  async nextSequence(conversationId: string | null): Promise<number> {
    if (!conversationId) return 1;
    try {
      const payload = await fetchPythonApi('/api/assistant-turns/next-sequence', this.token, {
        conversation_id: conversationId,
      });
      return typeof payload?.sequence === 'number' ? payload.sequence : 1;
    } catch {
      return 1;
    }
  }
}

export class DurableAssistantTurnStore implements AssistantTurnStore {
  constructor(
    private readonly remote: AssistantTurnStore | null,
    private readonly local = new MemoryAssistantTurnStore(),
  ) {}

  async get(turnId: string): Promise<AssistantTurnRecord | null> {
    return (await this.local.get(turnId)) ?? (this.remote ? this.remote.get(turnId) : null);
  }

  async put(record: AssistantTurnRecord): Promise<AssistantTurnRecord> {
    await this.local.put(record);
    if (this.remote) {
      try {
        await this.remote.put(record);
      } catch (error) {
        console.warn('Durable assistant turn persist failed:', error);
      }
    }
    return record;
  }

  async nextSequence(conversationId: string | null): Promise<number> {
    if (this.remote) {
      try {
        return await this.remote.nextSequence(conversationId);
      } catch (error) {
        console.warn('Assistant turn sequence fetch failed:', error);
      }
    }
    return this.local.nextSequence(conversationId);
  }
}

const memoryStore = new MemoryAssistantTurnStore();
let testStore: AssistantTurnStore | null = null;

export function setAssistantTurnStoreForTests(store: AssistantTurnStore | null): void {
  testStore = store;
}

export function getAssistantTurnStore(token: string): AssistantTurnStore {
  if (testStore) return testStore;
  if (process.env.RITUAL_ASSISTANT_TURN_STORE === 'memory') return memoryStore;
  return new DurableAssistantTurnStore(new HttpAssistantTurnStore(token));
}
