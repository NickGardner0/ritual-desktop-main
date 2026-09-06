/**
 * @ritual/agent core types — session items, SSE events, and defineTool.
 *
 * These types are the contract between the agent loop, the store,
 * and any UI that renders session state.
 */

// ---------------------------------------------------------------------------
// Session items — the append-only transcript
// ---------------------------------------------------------------------------

export type SessionItemType =
  | 'user'
  | 'assistant_text'
  | 'tool_called'
  | 'tool_result'
  | 'approval_ask'
  | 'approval'
  | 'system';

export interface SessionItemBase {
  session_id: string;
  seq: number;
  type: SessionItemType;
  created_at: string; // ISO 8601
}

export interface UserItem extends SessionItemBase {
  type: 'user';
  payload: {
    command_id: string; // idempotency key
    text: string;
  };
}

export interface AssistantTextItem extends SessionItemBase {
  type: 'assistant_text';
  payload: {
    text: string;
  };
}

export interface ToolCalledItem extends SessionItemBase {
  type: 'tool_called';
  payload: {
    call_id: string; // model-assigned tool_call ID
    name: string;
    arguments: Record<string, unknown>;
    idempotency_key?: string; // for mutating tools
  };
}

export interface ToolResultItem extends SessionItemBase {
  type: 'tool_result';
  payload: {
    call_id: string;
    name: string;
    status: 'ok' | 'error';
    result: string; // JSON string — same as what the old runtime returns
    canvas?: unknown; // optional structured data for rich rendering
    receipt?: ActionReceipt | null;
    entity_refs?: EntityRef[];
  };
}

export interface ApprovalAskItem extends SessionItemBase {
  type: 'approval_ask';
  payload: {
    call_id: string;
    name: string;
    arguments: Record<string, unknown>;
    idempotency_key: string;
  };
}

export interface ApprovalItem extends SessionItemBase {
  type: 'approval';
  payload: {
    ask_seq: number; // seq of the approval_ask this responds to
    decision: 'allow' | 'deny' | 'always_allow';
  };
}

export interface SystemItem extends SessionItemBase {
  type: 'system';
  payload: {
    text: string;
  };
}

export type SessionItem =
  | UserItem
  | AssistantTextItem
  | ToolCalledItem
  | ToolResultItem
  | ApprovalAskItem
  | ApprovalItem
  | SystemItem;

// ---------------------------------------------------------------------------
// Entity refs & action receipts (carried on tool_result)
// ---------------------------------------------------------------------------

export interface EntityRef {
  type: string;
  id: string;
  title?: string;
}

export interface ActionReceipt {
  receipt_id: string;
  action_kind: string;
  habit_id?: string | null;
  habit_name?: string | null;
  was_inserted?: boolean;
  undoable?: boolean;
  log_id?: string | null;
  amount?: number | null;
  date?: string | null;
}

// ---------------------------------------------------------------------------
// SSE wire events — { seq, type, payload }
// ---------------------------------------------------------------------------

export type SSEEvent =
  | { seq: number; type: 'user'; payload: UserItem['payload'] }
  | { seq: number; type: 'assistant_text'; payload: AssistantTextItem['payload'] }
  | { seq: number; type: 'assistant_text_delta'; payload: { text: string } }
  | { seq: number; type: 'tool_called'; payload: ToolCalledItem['payload'] }
  | { seq: number; type: 'tool_result'; payload: ToolResultItem['payload'] }
  | { seq: number; type: 'approval_ask'; payload: ApprovalAskItem['payload'] }
  | { seq: number; type: 'approval'; payload: ApprovalItem['payload'] }
  | { seq: number; type: 'system'; payload: SystemItem['payload'] }
  | { seq: number; type: 'done'; payload: Record<string, never> };

// ---------------------------------------------------------------------------
// defineTool — one-module tool definition
// ---------------------------------------------------------------------------

export interface ToolDefinition<TArgs = Record<string, unknown>> {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
  sideEffect: 'read_only' | 'mutating';
  /** Execute the tool. Returns a JSON string (same format as old executors). */
  execute: (args: TArgs, ctx: ToolContext) => Promise<string>;
  /** Optional: extract structured canvas data from the result. */
  toCanvas?: (result: string) => unknown;
  /** Optional: extract entity refs from the result. */
  toEntityRefs?: (result: string) => EntityRef[];
  /** Optional: extract an action receipt from the result. */
  toReceipt?: (result: string) => ActionReceipt | null;
}

export interface ToolContext {
  token: string;
  timezone?: string;
  sessionId: string;
  idempotencyKey?: string;
  /** Desktop-provided local activity data for overview enrichment. */
  localOverviewActivity?: unknown;
}

// ---------------------------------------------------------------------------
// Session + store interfaces
// ---------------------------------------------------------------------------

export type SessionRunStatus = 'running' | null;

export interface Session {
  id: string;
  user_id: string;
  run_status: SessionRunStatus;
  run_heartbeat: string | null; // ISO 8601
  created_at: string;
  always_allow_scopes: string[]; // tool names the user has always-allowed
}

export interface SessionStore {
  /** Create or fetch a session. */
  getOrCreateSession(sessionId: string, userId: string): Promise<Session>;

  /** Try to acquire the session lock. Returns true if acquired. */
  tryLock(sessionId: string): Promise<boolean>;

  /** Release the session lock. */
  unlock(sessionId: string): Promise<void>;

  /** Update the heartbeat timestamp for crash recovery. */
  heartbeat(sessionId: string): Promise<void>;

  /** Append an item. Returns the assigned seq. */
  appendItem(sessionId: string, item: Omit<SessionItem, 'seq' | 'created_at' | 'session_id'>): Promise<number>;

  /** Get all items, optionally after a seq (for SSE replay). */
  getItems(sessionId: string, afterSeq?: number): Promise<SessionItem[]>;

  /** Check if a commandId has already been admitted. */
  hasCommandId(sessionId: string, commandId: string): Promise<boolean>;

  /** Add a scope to always-allow list. */
  addAlwaysAllowScope(sessionId: string, scope: string): Promise<void>;

  /** Get the session's always-allow scopes. */
  getAlwaysAllowScopes(sessionId: string): Promise<string[]>;
}

// ---------------------------------------------------------------------------
// Helper: defineTool factory
// ---------------------------------------------------------------------------

export function defineTool<TArgs = Record<string, unknown>>(
  def: ToolDefinition<TArgs>,
): ToolDefinition<TArgs> {
  return def;
}
