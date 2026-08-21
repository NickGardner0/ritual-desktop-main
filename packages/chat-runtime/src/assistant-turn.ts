export const ASSISTANT_TURN_STATUSES = [
  'queued',
  'running',
  'committing',
  'completed',
  'failed',
  'canceled',
] as const;

export type AssistantTurnStatus = (typeof ASSISTANT_TURN_STATUSES)[number];

export const ASSISTANT_CHANNELS = ['dashboard', 'sms'] as const;
export type AssistantChannel = (typeof ASSISTANT_CHANNELS)[number];

export const TOOL_SIDE_EFFECTS = ['read_only', 'mutating'] as const;
export type ToolSideEffect = (typeof TOOL_SIDE_EFFECTS)[number];

export const ASSISTANT_TURN_TRANSITIONS: Record<AssistantTurnStatus, readonly AssistantTurnStatus[]> = {
  queued: ['running', 'canceled', 'failed'],
  running: ['committing', 'canceled', 'failed'],
  committing: ['completed', 'failed'],
  completed: [],
  failed: ['queued', 'running'],
  canceled: [],
};

export type AssistantTurnRecord = {
  id: string;
  conversationId: string | null;
  channel: AssistantChannel;
  status: AssistantTurnStatus;
  epoch: number;
  sequence: number;
  receiptIds: string[];
  assistantText: string | null;
  toolPayload: Record<string, unknown> | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export function isAssistantTurnStatus(value: unknown): value is AssistantTurnStatus {
  return typeof value === 'string' && (ASSISTANT_TURN_STATUSES as readonly string[]).includes(value);
}

export function isTerminalTurnStatus(status: AssistantTurnStatus): boolean {
  return ASSISTANT_TURN_TRANSITIONS[status].length === 0;
}

export function canTransitionAssistantTurn(
  from: AssistantTurnStatus,
  to: AssistantTurnStatus,
): boolean {
  if (from === to) return true;
  return ASSISTANT_TURN_TRANSITIONS[from].includes(to);
}

export function mutationClientEventId(turnId: string, toolCallId: string): string {
  return `${turnId}:${toolCallId}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function createQueuedTurn(input: {
  id: string;
  conversationId?: string | null;
  channel: AssistantChannel;
  epoch: number;
  sequence: number;
  now?: string;
}): AssistantTurnRecord {
  const timestamp = input.now ?? nowIso();
  return {
    id: input.id,
    conversationId: input.conversationId ?? null,
    channel: input.channel,
    status: 'queued',
    epoch: input.epoch,
    sequence: input.sequence,
    receiptIds: [],
    assistantText: null,
    toolPayload: null,
    error: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: null,
  };
}
