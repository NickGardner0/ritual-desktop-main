import { dispatchToolCall, withToolErrorHandling, type ToolExecutionContext } from './runtime-tools.js';
import { getToolSideEffect } from './tool-registry.js';
import type { ToolSideEffect } from './assistant-turn.js';
import { mutationClientEventId } from './assistant-turn.js';
import {
  defaultAssistantKernel,
  type AssistantKernel,
} from './assistant-kernel.js';
import type { AssistantTurnRecord } from './assistant-turn.js';

export type DeclaredToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type DeclaredToolResult = {
  toolCall: DeclaredToolCall;
  result: string;
  sideEffect: ToolSideEffect;
};

export function planToolBatch(names: string[]): 'parallel' | 'serial' {
  return names.some((name) => getToolSideEffect(name) === 'mutating')
    ? 'serial'
    : 'parallel';
}

export async function mapInBatchMode<T, R>(
  items: T[],
  mode: 'parallel' | 'serial',
  runOne: (item: T) => Promise<R>,
): Promise<R[]> {
  if (mode === 'parallel') {
    return Promise.all(items.map((item) => runOne(item)));
  }
  const results: R[] = [];
  for (const item of items) {
    results.push(await runOne(item));
  }
  return results;
}

async function runOne(
  toolCall: DeclaredToolCall,
  token: string,
  ctx: ToolExecutionContext,
  turnId?: string,
): Promise<DeclaredToolResult> {
  const args = JSON.parse(toolCall.arguments || '{}');
  const result = await withToolErrorHandling(toolCall.name, () =>
    dispatchToolCall(toolCall.name, token, args, {
      ...ctx,
      toolCallId: toolCall.id,
      clientEventId: turnId ? mutationClientEventId(turnId, toolCall.id) : ctx.clientEventId,
    }),
  );
  return {
    toolCall,
    result,
    sideEffect: getToolSideEffect(toolCall.name),
  };
}

export async function executeDeclaredToolCalls(options: {
  toolCalls: DeclaredToolCall[];
  token: string;
  ctx: ToolExecutionContext;
  turn?: AssistantTurnRecord | null;
  kernel?: AssistantKernel;
  signal?: AbortSignal;
}): Promise<DeclaredToolResult[]> {
  const { toolCalls, token, ctx, turn, kernel = defaultAssistantKernel, signal } = options;
  if (!toolCalls.length) return [];
  if (signal?.aborted) {
    const error = new Error('client_disconnected');
    error.name = 'AbortError';
    throw error;
  }

  const mode = planToolBatch(toolCalls.map((toolCall) => toolCall.name));
  const heldMutation = mode === 'serial' && turn;
  if (heldMutation) {
    kernel.acquireMutation(turn);
  }

  try {
    return mapInBatchMode(toolCalls, mode, async (toolCall) => {
      if (signal?.aborted) {
        const error = new Error('client_disconnected');
        error.name = 'AbortError';
        throw error;
      }
      return runOne(toolCall, token, ctx, turn?.id);
    });
  } finally {
    if (heldMutation) {
      kernel.releaseMutation(turn);
    }
  }
}
