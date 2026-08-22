import { fetchPythonApi, fetchPythonApiPost } from './executors/shared-api.js';
import type { AssistantChannel, AssistantTurnRecord } from './assistant-turn.js';
import { createQueuedTurn, isAssistantTurnStatus } from './assistant-turn.js';

export interface AssistantTurnStore {
  accept(input: AssistantTurnAcceptance): Promise<AssistantTurnRecord>;
  get(turnId: string): Promise<AssistantTurnRecord | null>;
  put(record: AssistantTurnRecord): Promise<AssistantTurnRecord>;
  commit(record: AssistantTurnRecord): Promise<AssistantTurnRecord>;
  nextSequence(conversationId: string | null): Promise<number>;
}

export type AssistantTurnAcceptance = {
  turnId: string;
  conversationId: string | null;
  channel: AssistantChannel;
  epoch: number;
  userMessage: string;
  userMessageId?: string | null;
  responseMode: 'text' | 'voice';
  recordUserMessageInConversation?: boolean;
};

export class MemoryAssistantTurnStore implements AssistantTurnStore {
  private readonly records = new Map<string, AssistantTurnRecord>();
  private readonly sequences = new Map<string, number>();

  async accept(input: AssistantTurnAcceptance): Promise<AssistantTurnRecord> {
    const existing = this.records.get(input.turnId);
    if (existing) {
      if (existing.channel !== input.channel) throw new Error('assistant turn channel mismatch');
      if (existing.epoch !== input.epoch) throw new Error('assistant turn epoch mismatch');
      if (existing.userMessageText !== null && existing.userMessageText !== input.userMessage) {
        throw new Error('assistant turn user message mismatch');
      }
      if (input.userMessageId && existing.userMessageId !== input.userMessageId) {
        throw new Error('assistant turn user message id mismatch');
      }
      if (input.conversationId && existing.conversationId !== input.conversationId) {
        throw new Error('assistant turn conversation mismatch');
      }
      return existing;
    }
    const record = createQueuedTurn({
      id: input.turnId,
      conversationId: input.conversationId,
      channel: input.channel,
      epoch: input.epoch,
      sequence: await this.nextSequence(input.conversationId),
      userMessage: input.userMessage,
      userMessageId: input.userMessageId,
    });
    this.records.set(record.id, record);
    return record;
  }

  async get(turnId: string): Promise<AssistantTurnRecord | null> {
    return this.records.get(turnId) ?? null;
  }

  async put(record: AssistantTurnRecord): Promise<AssistantTurnRecord> {
    this.records.set(record.id, record);
    return record;
  }

  async commit(record: AssistantTurnRecord): Promise<AssistantTurnRecord> {
    const existing = this.records.get(record.id);
    if (!existing) throw new Error('assistant turn was not accepted');
    if (!existing.acceptedAt) throw new Error('assistant turn was not durably accepted');
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
    userMessageId: typeof value.user_message_id === 'string' ? value.user_message_id : null,
    userMessageText: typeof value.user_message_text === 'string' ? value.user_message_text : null,
    acceptedAt: typeof value.accepted_at === 'string' ? value.accepted_at : null,
    commitVersion: typeof value.commit_version === 'number' ? value.commit_version : 0,
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

  async accept(input: AssistantTurnAcceptance): Promise<AssistantTurnRecord> {
    const payload = await fetchPythonApiPost('/api/assistant-turns/accept', this.token, {
      id: input.turnId,
      conversation_id: input.conversationId,
      user_message_id: input.userMessageId || null,
      channel: input.channel,
      epoch: input.epoch,
      user_message: input.userMessage,
      response_mode: input.responseMode,
      record_user_message_in_conversation: input.recordUserMessageInConversation ?? true,
    });
    const parsed = parseTurnRecord(payload);
    if (!parsed?.acceptedAt || !parsed.userMessageId) {
      throw new Error('Assistant turn acceptance returned an invalid durable record');
    }
    return parsed;
  }

  async get(turnId: string): Promise<AssistantTurnRecord | null> {
    const payload = await fetchPythonApi(`/api/assistant-turns/${turnId}`, this.token);
    const parsed = parseTurnRecord(payload);
    if (!parsed) throw new Error('Assistant turn read returned an invalid durable record');
    return parsed;
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
    const parsed = parseTurnRecord(payload);
    if (!parsed) throw new Error('Assistant turn transition returned an invalid durable record');
    return parsed;
  }

  async commit(record: AssistantTurnRecord): Promise<AssistantTurnRecord> {
    const payload = await fetchPythonApiPost(`/api/assistant-turns/${record.id}/commit`, this.token, {
      epoch: record.epoch,
      assistant_text: record.assistantText,
      receipt_ids: record.receiptIds,
      tool_payload: record.toolPayload,
    });
    const parsed = parseTurnRecord(payload);
    if (!parsed || parsed.status !== 'completed' || parsed.commitVersion < 1) {
      throw new Error('Assistant turn commit returned an invalid durable record');
    }
    return parsed;
  }

  async nextSequence(conversationId: string | null): Promise<number> {
    if (!conversationId) return 1;
    const payload = await fetchPythonApi('/api/assistant-turns/next-sequence', this.token, {
      conversation_id: conversationId,
    });
    if (typeof payload?.sequence !== 'number') {
      throw new Error('Assistant turn sequence returned an invalid durable value');
    }
    return payload.sequence;
  }
}

export class DurableAssistantTurnStore implements AssistantTurnStore {
  constructor(
    private readonly remote: AssistantTurnStore | null,
    private readonly local = new MemoryAssistantTurnStore(),
  ) {}

  async accept(input: AssistantTurnAcceptance): Promise<AssistantTurnRecord> {
    if (!this.remote) return this.local.accept(input);
    const accepted = await this.remote.accept(input);
    await this.local.put(accepted);
    return accepted;
  }

  async get(turnId: string): Promise<AssistantTurnRecord | null> {
    if (!this.remote) return this.local.get(turnId);
    const durable = await this.remote.get(turnId);
    if (durable) await this.local.put(durable);
    return durable;
  }

  async put(record: AssistantTurnRecord): Promise<AssistantTurnRecord> {
    if (!this.remote) return this.local.put(record);
    const durable = await this.remote.put(record);
    await this.local.put(durable);
    return durable;
  }

  async commit(record: AssistantTurnRecord): Promise<AssistantTurnRecord> {
    if (!this.remote) return this.local.commit(record);
    const durable = await this.remote.commit(record);
    await this.local.put(durable);
    return durable;
  }

  async nextSequence(conversationId: string | null): Promise<number> {
    if (this.remote) return this.remote.nextSequence(conversationId);
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
  if (
    process.env.NODE_ENV === 'test'
    && process.env.RITUAL_ASSISTANT_TURN_STORE === 'memory'
  ) return memoryStore;
  return new DurableAssistantTurnStore(new HttpAssistantTurnStore(token));
}
