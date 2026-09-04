/**
 * The agent loop — admit, lock, stream LLM, persist-before-execute, approvals.
 *
 * This is the entire kernel described in the plan.
 */

import type {
  SessionStore,
  SessionItem,
  ToolDefinition,
  ToolContext,
  SSEEvent,
  EntityRef,
  ActionReceipt,
} from './types.js';
// ---------------------------------------------------------------------------
// Minimal model-engine types (mirrors @ritual/chat-runtime/model-engine)
// ---------------------------------------------------------------------------

interface ModelEngineToolCall {
  id: string;
  name: string;
  arguments: string;
}

interface ModelEngineMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  toolCallId?: string;
  toolCalls?: ModelEngineToolCall[];
}

interface ModelEngineTool {
  type: 'function';
  function: { name: string; description?: string; parameters?: Record<string, unknown> };
}

type ModelEngineEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call_delta'; index: number; id?: string; name?: string; arguments?: string }
  | { type: 'done'; finishReason?: string | null };

export interface ModelEngineAdapter {
  stream(input: {
    model: string;
    messages: ModelEngineMessage[];
    tools?: ModelEngineTool[];
    temperature?: number;
    signal?: AbortSignal;
  }): AsyncIterable<ModelEngineEvent>;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface AgentLoopConfig {
  store: SessionStore;
  model: ModelEngineAdapter;
  tools: ToolDefinition[];
  systemPrompt: (ctx: { timezone?: string; alwaysAllowScopes: string[] }) => string;
  modelName?: string;
  temperature?: number;
  maxIterations?: number;
}

export interface AdmitResult {
  seq: number;
  alreadyAdmitted: boolean;
}

export interface RunResult {
  items: SessionItem[];
  pausedForApproval?: boolean;
}

// ---------------------------------------------------------------------------
// Admit — persist user item, return 200
// ---------------------------------------------------------------------------

export async function admit(
  config: AgentLoopConfig,
  sessionId: string,
  userId: string,
  commandId: string,
  text: string,
): Promise<AdmitResult> {
  await config.store.getOrCreateSession(sessionId, userId);

  // Idempotency: if this commandId was already admitted, no-op
  if (await config.store.hasCommandId(sessionId, commandId)) {
    const items = await config.store.getItems(sessionId);
    const existing = items.find(
      (i) => i.type === 'user' && i.payload.command_id === commandId,
    );
    return { seq: existing?.seq ?? 0, alreadyAdmitted: true };
  }

  const seq = await config.store.appendItem(sessionId, {
    type: 'user',
    payload: { command_id: commandId, text },
  });

  return { seq, alreadyAdmitted: false };
}

// ---------------------------------------------------------------------------
// Run — the main agent loop
// ---------------------------------------------------------------------------

export async function run(
  config: AgentLoopConfig,
  sessionId: string,
  options?: {
    token?: string;
    timezone?: string;
    localOverviewActivity?: unknown;
    emit?: (event: SSEEvent) => void;
    signal?: AbortSignal;
  },
): Promise<RunResult> {
  const { store, tools, model } = config;
  const maxIter = config.maxIterations ?? 10;
  const emit = options?.emit;

  // Acquire lock (Law 2)
  const locked = await store.tryLock(sessionId);
  if (!locked) {
    throw new Error('Session is already running');
  }

  const toolMap = new Map(tools.map((t) => [t.name, t]));
  const modelTools: ModelEngineTool[] = tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));

  const alwaysAllowScopes = await store.getAlwaysAllowScopes(sessionId);
  const newItems: SessionItem[] = [];

  try {
    for (let iter = 0; iter < maxIter; iter++) {
      if (options?.signal?.aborted) break;
      await store.heartbeat(sessionId);

      // Build messages from session items
      const allItems = await store.getItems(sessionId);
      const messages = itemsToMessages(allItems, config.systemPrompt({
        timezone: options?.timezone,
        alwaysAllowScopes,
      }));

      // Stream LLM
      let assistantText = '';
      const toolCalls: ModelEngineToolCall[] = [];
      const toolCallBuffers = new Map<number, { id: string; name: string; args: string }>();

      for await (const event of model.stream({
        model: config.modelName ?? 'gpt-4o-mini',
        messages,
        tools: modelTools,
        temperature: config.temperature ?? 0.3,
        signal: options?.signal,
      })) {
        if (event.type === 'text_delta') {
          assistantText += event.text;
          emit?.({ seq: 0, type: 'assistant_text_delta', payload: { text: event.text } });
        } else if (event.type === 'tool_call_delta') {
          let buf = toolCallBuffers.get(event.index);
          if (!buf) {
            buf = { id: event.id ?? '', name: event.name ?? '', args: '' };
            toolCallBuffers.set(event.index, buf);
          }
          if (event.id) buf.id = event.id;
          if (event.name) buf.name = event.name;
          if (event.arguments) buf.args += event.arguments;
        }
      }

      // Collect completed tool calls
      for (const [, buf] of [...toolCallBuffers.entries()].sort((a, b) => a[0] - b[0])) {
        toolCalls.push({ id: buf.id, name: buf.name, arguments: buf.args });
      }

      // Persist assistant text if any
      if (assistantText) {
        const seq = await store.appendItem(sessionId, {
          type: 'assistant_text',
          payload: { text: assistantText },
        });
        const item = (await store.getItems(sessionId)).find((i) => i.seq === seq)!;
        newItems.push(item);
        emit?.({ seq, type: 'assistant_text', payload: { text: assistantText } });
      }

      // No tool calls → done
      if (toolCalls.length === 0) break;

      // Execute each tool call
      for (const call of toolCalls) {
        let args: Record<string, unknown>;
        try {
          args = JSON.parse(call.arguments);
        } catch {
          args = {};
        }

        const tool = toolMap.get(call.name);
        const isMutating = tool?.sideEffect === 'mutating';
        const idempotencyKey = isMutating
          ? `${sessionId}:${call.id}`
          : undefined;

        // Law 5: persist tool_called before execute
        const calledSeq = await store.appendItem(sessionId, {
          type: 'tool_called',
          payload: {
            call_id: call.id,
            name: call.name,
            arguments: args,
            idempotency_key: idempotencyKey,
          },
        });
        const calledItem = (await store.getItems(sessionId)).find((i) => i.seq === calledSeq)!;
        newItems.push(calledItem);
        emit?.({ seq: calledSeq, type: 'tool_called', payload: calledItem.payload as any });

        // Law 6: mutating tools need approval
        if (isMutating && !alwaysAllowScopes.includes(call.name)) {
          const askSeq = await store.appendItem(sessionId, {
            type: 'approval_ask',
            payload: {
              call_id: call.id,
              name: call.name,
              arguments: args,
              idempotency_key: idempotencyKey!,
            },
          });
          const askItem = (await store.getItems(sessionId)).find((i) => i.seq === askSeq)!;
          newItems.push(askItem);
          emit?.({ seq: askSeq, type: 'approval_ask', payload: askItem.payload as any });

          // Unlock and return — client will POST approval decision
          await store.unlock(sessionId);
          return { items: newItems, pausedForApproval: true };
        }

        // Execute
        if (!tool) {
          const resultStr = JSON.stringify({ error: `Unknown tool: ${call.name}` });
          const resultSeq = await store.appendItem(sessionId, {
            type: 'tool_result',
            payload: { call_id: call.id, name: call.name, status: 'error', result: resultStr },
          });
          const resultItem = (await store.getItems(sessionId)).find((i) => i.seq === resultSeq)!;
          newItems.push(resultItem);
          emit?.({ seq: resultSeq, type: 'tool_result', payload: resultItem.payload as any });
          continue;
        }

        const ctx: ToolContext = {
          token: options?.token ?? '',
          timezone: options?.timezone,
          sessionId,
          idempotencyKey,
          localOverviewActivity: options?.localOverviewActivity,
        };

        let resultStr: string;
        let status: 'ok' | 'error' = 'ok';
        try {
          resultStr = await tool.execute(args as any, ctx);
        } catch (err) {
          status = 'error';
          resultStr = JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
        }

        const entityRefs = tool.toEntityRefs?.(resultStr) ?? [];
        const receipt = tool.toReceipt?.(resultStr) ?? null;
        const canvas = tool.toCanvas?.(resultStr) ?? undefined;

        const resultSeq = await store.appendItem(sessionId, {
          type: 'tool_result',
          payload: {
            call_id: call.id,
            name: call.name,
            status,
            result: resultStr,
            canvas,
            receipt,
            entity_refs: entityRefs.length > 0 ? entityRefs : undefined,
          },
        });
        const resultItem = (await store.getItems(sessionId)).find((i) => i.seq === resultSeq)!;
        newItems.push(resultItem);
        emit?.({ seq: resultSeq, type: 'tool_result', payload: resultItem.payload as any });
      }
    }
  } finally {
    await store.unlock(sessionId);
  }

  return { items: newItems };
}

// ---------------------------------------------------------------------------
// Resume after approval
// ---------------------------------------------------------------------------

export async function resumeAfterApproval(
  config: AgentLoopConfig,
  sessionId: string,
  askSeq: number,
  decision: 'allow' | 'deny' | 'always_allow',
  options?: {
    token?: string;
    timezone?: string;
    localOverviewActivity?: unknown;
    emit?: (event: SSEEvent) => void;
    signal?: AbortSignal;
  },
): Promise<RunResult> {
  const { store } = config;

  // Persist the approval decision
  const approvalSeq = await store.appendItem(sessionId, {
    type: 'approval',
    payload: { ask_seq: askSeq, decision },
  });
  options?.emit?.({ seq: approvalSeq, type: 'approval', payload: { ask_seq: askSeq, decision } });

  // Find the approval_ask to get the tool call details
  const items = await store.getItems(sessionId);
  const askItem = items.find((i) => i.seq === askSeq && i.type === 'approval_ask');
  if (!askItem || askItem.type !== 'approval_ask') {
    throw new Error(`Approval ask not found at seq ${askSeq}`);
  }

  if (decision === 'always_allow') {
    await store.addAlwaysAllowScope(sessionId, askItem.payload.name);
  }

  if (decision === 'deny') {
    // Persist a tool_result with denied status
    const resultSeq = await store.appendItem(sessionId, {
      type: 'tool_result',
      payload: {
        call_id: askItem.payload.call_id,
        name: askItem.payload.name,
        status: 'error',
        result: JSON.stringify({ error: 'User denied this action' }),
      },
    });
    options?.emit?.({
      seq: resultSeq,
      type: 'tool_result',
      payload: { call_id: askItem.payload.call_id, name: askItem.payload.name, status: 'error', result: JSON.stringify({ error: 'User denied this action' }) },
    });
    // Continue the loop so the model sees the denial
    return run(config, sessionId, options);
  }

  // Execute the approved tool
  const tool = config.tools.find((t) => t.name === askItem.payload.name);
  if (!tool) {
    throw new Error(`Tool not found: ${askItem.payload.name}`);
  }

  // Acquire lock for execution
  const locked = await store.tryLock(sessionId);
  if (!locked) {
    throw new Error('Session is already running');
  }

  const newItems: SessionItem[] = [];
  try {
    const ctx: ToolContext = {
      token: options?.token ?? '',
      timezone: options?.timezone,
      sessionId,
      idempotencyKey: askItem.payload.idempotency_key,
      localOverviewActivity: options?.localOverviewActivity,
    };

    let resultStr: string;
    let status: 'ok' | 'error' = 'ok';
    try {
      resultStr = await tool.execute(askItem.payload.arguments as any, ctx);
    } catch (err) {
      status = 'error';
      resultStr = JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
    }

    const entityRefs = tool.toEntityRefs?.(resultStr) ?? [];
    const receipt = tool.toReceipt?.(resultStr) ?? null;
    const canvas = tool.toCanvas?.(resultStr) ?? undefined;

    const resultSeq = await store.appendItem(sessionId, {
      type: 'tool_result',
      payload: {
        call_id: askItem.payload.call_id,
        name: askItem.payload.name,
        status,
        result: resultStr,
        canvas,
        receipt,
        entity_refs: entityRefs.length > 0 ? entityRefs : undefined,
      },
    });
    const resultItem = (await store.getItems(sessionId)).find((i) => i.seq === resultSeq)!;
    newItems.push(resultItem);
    options?.emit?.({ seq: resultSeq, type: 'tool_result', payload: resultItem.payload as any });
  } finally {
    await store.unlock(sessionId);
  }

  // Continue the loop
  const continuation = await run(config, sessionId, options);
  return { items: [...newItems, ...continuation.items], pausedForApproval: continuation.pausedForApproval };
}

// ---------------------------------------------------------------------------
// items → model messages
// ---------------------------------------------------------------------------

function itemsToMessages(items: SessionItem[], systemPrompt: string): ModelEngineMessage[] {
  const messages: ModelEngineMessage[] = [
    { role: 'system', content: systemPrompt },
  ];

  for (const item of items) {
    switch (item.type) {
      case 'user':
        messages.push({ role: 'user', content: item.payload.text });
        break;
      case 'system':
        messages.push({ role: 'system', content: item.payload.text });
        break;
      case 'assistant_text':
        messages.push({ role: 'assistant', content: item.payload.text });
        break;
      case 'tool_called': {
        // Group tool_called items into an assistant message with toolCalls
        const lastMsg = messages[messages.length - 1];
        const toolCall = {
          id: item.payload.call_id,
          name: item.payload.name,
          arguments: JSON.stringify(item.payload.arguments),
        };
        if (lastMsg?.role === 'assistant' && lastMsg.toolCalls) {
          lastMsg.toolCalls.push(toolCall);
        } else {
          messages.push({
            role: 'assistant',
            content: null,
            toolCalls: [toolCall],
          });
        }
        break;
      }
      case 'tool_result':
        messages.push({
          role: 'tool',
          content: item.payload.result,
          toolCallId: item.payload.call_id,
        });
        break;
      case 'approval_ask':
        // Not sent to model; the loop pauses
        break;
      case 'approval':
        // Not sent to model; handled by resumeAfterApproval
        break;
    }
  }

  return messages;
}
