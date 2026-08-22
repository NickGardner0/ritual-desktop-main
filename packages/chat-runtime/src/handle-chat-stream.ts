import type OpenAI from 'openai';
import { createChatStreamResponse } from './stream-response.js';
import type { ChatStreamEvent } from './stream-response.js';
import type { ChatToolResults } from './types.js';
import { classifyChatRoute } from './chat-stream/classifier-router.js';
import { handleDeterministicFastPath } from './chat-stream/narrative-router.js';
import {
  awaitPromptFacts,
  buildCanvasToolPayload,
  composeSystemPrompt,
  elapsed,
  prepareChatTurnContext,
} from './chat-stream/shared.js';
import { persistConversationMentions } from './persistence.js';
import { mergeDailyBreakdowns, runStreamingToolLoop } from './chat-stream/tool-dispatch.js';
import { defaultAssistantKernel, isInFlightTurnStatus } from './assistant-kernel.js';
import { getAssistantTurnStore } from './assistant-turn-store.js';
import { isTerminalTurnStatus, type AssistantTurnRecord } from './assistant-turn.js';
import type { AssistantTurnStore } from './assistant-turn-store.js';

export type ChatStreamRequestBody = {
  messages: Array<{ role: string; content: string }>;
  timezone?: string;
  conversationId?: string | null;
  responseMode?: 'text' | 'voice';
  localOverviewActivity?: unknown;
  entityRefs?: Array<{ type: string; id: string; title?: string }>;
  turnId?: string | null;
  epoch?: number;
};

export type ChatStreamRequestContext = {
  token: string;
  body: ChatStreamRequestBody;
  signal?: AbortSignal;
};

function newTurnId(provided?: string | null): string {
  if (provided && provided.trim()) return provided.trim();
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `turn_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

async function commitOwnedTurn(
  turn: AssistantTurnRecord,
  store: AssistantTurnStore,
  epoch: number,
  fullText: string,
  canvasToolPayload: Record<string, unknown> | null,
  receiptIds: string[],
  conversationId: string | null,
): Promise<void> {
  await defaultAssistantKernel.commit(turn, store, epoch, {
    conversationId,
    assistantText: fullText,
    toolPayload: canvasToolPayload,
    receiptIds,
  });
}

async function failOwnedTurn(
  turn: AssistantTurnRecord | null,
  store: AssistantTurnStore | null,
  error: unknown,
): Promise<void> {
  if (!turn || !store) return;
  try {
    await defaultAssistantKernel.fail(turn, store, error);
  } catch (transitionError) {
    console.warn('Assistant turn fail transition skipped:', transitionError);
  }
}

async function cancelOwnedTurn(
  turn: AssistantTurnRecord,
  store: AssistantTurnStore,
  reason: unknown,
): Promise<AssistantTurnRecord> {
  try {
    return await defaultAssistantKernel.cancel(turn, store, reason);
  } catch (transitionError) {
    console.warn('Assistant turn cancel transition skipped:', transitionError);
    return turn;
  }
}

function isAbortError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'name' in error && (error as { name?: string }).name === 'AbortError');
}

function conflictResponse(error: string, extra: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({ error, ...extra }), {
    status: 409,
    headers: { 'Content-Type': 'application/json' },
  });
}

function bindAbortToTurn(
  signal: AbortSignal | undefined,
  turn: AssistantTurnRecord,
  store: AssistantTurnStore,
): () => void {
  if (!signal) return () => {};
  const onAbort = () => {
    void cancelOwnedTurn(turn, store, 'client_disconnected');
  };
  if (signal.aborted) {
    onAbort();
    return () => {};
  }
  signal.addEventListener('abort', onAbort, { once: true });
  return () => signal.removeEventListener('abort', onAbort);
}

export async function handleChatStreamRequest(context: ChatStreamRequestContext) {
  const t0 = performance.now();
  let turn: AssistantTurnRecord | null = null;
  let store: AssistantTurnStore | null = null;
  let unbindAbort = () => {};
  const epoch = Number.isFinite(context.body.epoch) ? Number(context.body.epoch) : 0;
  try {
    const { token, body } = context;
    if (!token?.trim()) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const {
      messages,
      timezone,
      conversationId: providedConversationId,
      responseMode = 'text',
      localOverviewActivity,
      entityRefs,
    } = body;
    const latestUserContent = [...messages]
      .reverse()
      .find((message) => message.role === 'user')?.content?.trim() || '';
    if (!latestUserContent) {
      return new Response(JSON.stringify({ error: 'A non-empty user message is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    store = getAssistantTurnStore(token);
    turn = await defaultAssistantKernel.begin({
      turnId: newTurnId(body.turnId),
      conversationId: providedConversationId || null,
      channel: 'dashboard',
      epoch,
      userMessage: latestUserContent,
      responseMode,
      store,
    });
    if (!turn || !store) {
      throw new Error('assistant turn store missing');
    }
    let ownedTurn = turn;
    const ownedStore = store;

    if (context.signal?.aborted) {
      ownedTurn = await cancelOwnedTurn(ownedTurn, ownedStore, 'client_disconnected');
      turn = ownedTurn;
    }

    if (ownedTurn.status === 'canceled') {
      return conflictResponse('Turn canceled', { reason: ownedTurn.error || 'stale_epoch' });
    }

    if (ownedTurn.status === 'completed' && ownedTurn.assistantText) {
      return createChatStreamResponse({
        conversationId: ownedTurn.conversationId,
        source: { type: 'complete', text: ownedTurn.assistantText },
        canvasToolPayload: ownedTurn.toolPayload,
        prefaceLine: '__STREAM_OPEN__',
      });
    }

    if (isInFlightTurnStatus(ownedTurn.status)) {
      return conflictResponse('Turn in flight', { status: ownedTurn.status, turnId: ownedTurn.id });
    }

    if (ownedTurn.status === 'queued') {
      ownedTurn = await defaultAssistantKernel.transition(ownedTurn, 'running', ownedStore);
      turn = ownedTurn;
    }

    unbindAbort = bindAbortToTurn(context.signal, ownedTurn, ownedStore);
    if (context.signal?.aborted) {
      ownedTurn = await cancelOwnedTurn(ownedTurn, ownedStore, 'client_disconnected');
      turn = ownedTurn;
      return conflictResponse('Turn canceled', { reason: 'client_disconnected' });
    }

    const prepared = prepareChatTurnContext(token, messages, timezone, ownedTurn.conversationId, responseMode);
    const {
      conversationIdPromise,
      immediateConversationId,
      deferredConversationIdPromise,
      isVoiceMode,
      latestUserContent: preparedUserContent,
      baseSystemPrompt,
      factsPromise,
    } = prepared;
    const attachedRefs = Array.isArray(entityRefs)
      ? entityRefs.filter((ref) => ref && typeof ref.type === 'string' && typeof ref.id === 'string')
      : [];
    const route = classifyChatRoute(preparedUserContent, timezone, isVoiceMode);
    console.log(`⏱️ [${elapsed(t0)}] route=${route.retrievalRoute} forced=${route.forcedToolName || 'none'} voice=${isVoiceMode} turn=${ownedTurn.id}`);

    const activeTurn = ownedTurn;
    const activeStore = ownedStore;
    const commitTurn = async (fullText: string, canvasToolPayload: Record<string, unknown> | null) => {
      if (context.signal?.aborted) {
        await cancelOwnedTurn(activeTurn, activeStore, 'client_disconnected');
        return;
      }
      const latest = await activeStore.get(activeTurn.id);
      if (!latest) throw new Error('Accepted assistant turn disappeared before commit');
      if (isTerminalTurnStatus(latest.status) || latest.status === 'failed' || latest.status === 'failed_retryable') return;
      const conversationId = await conversationIdPromise;
      const receiptIds = Array.isArray((canvasToolPayload as { actionReceipts?: Array<{ receipt_id?: string }> } | null)?.actionReceipts)
        ? ((canvasToolPayload as { actionReceipts: Array<{ receipt_id?: string }> }).actionReceipts
          .map((receipt) => receipt.receipt_id)
          .filter((id): id is string => Boolean(id)))
        : [];
      try {
        await commitOwnedTurn(latest, activeStore, epoch, fullText, canvasToolPayload, receiptIds, conversationId);
      } catch (error) {
        await failOwnedTurn(latest, activeStore, error);
        throw error;
      }
    };

    if (route.deterministicFastPath && route.forcedToolName) {
      persistConversationMentions({
        token,
        conversationIdPromise,
        userContent: preparedUserContent,
        attachedRefs,
      });
      return handleDeterministicFastPath({
        t0,
        token,
        latestUserContent: preparedUserContent,
        timezone,
        localOverviewActivity,
        forcedToolName: route.forcedToolName,
        weeklyOverviewQueryParams: route.weeklyOverviewQueryParams,
        strictThisWeekForWeeklyOverview: route.strictThisWeekForWeeklyOverview,
        deferredOverviewFastPath: route.deferredOverviewFastPath,
        immediateConversationId,
        deferredConversationIdPromise,
        conversationIdPromise,
        commitTurn,
      });
    }

    const toolResults: ChatToolResults = { allStats: [], allBreakdowns: [] };
    let resolveCanvas: (payload: Record<string, unknown> | null) => void = () => {};
    const canvasToolPayloadPromise = new Promise<Record<string, unknown> | null>((resolve) => {
      resolveCanvas = resolve;
    });

    console.log(`⏱️ [${elapsed(t0)}] response_open`);

    async function* streamTurnEvents(): AsyncGenerator<ChatStreamEvent> {
      try {
        if (context.signal?.aborted) {
          await cancelOwnedTurn(activeTurn, activeStore, 'client_disconnected');
          return;
        }
        yield { type: 'phase', phase: 'context' };
        const facts = await awaitPromptFacts(factsPromise);
        if (context.signal?.aborted) {
          await cancelOwnedTurn(activeTurn, activeStore, 'client_disconnected');
          return;
        }
        console.log(`⏱️ [${elapsed(t0)}] facts_ready count=${facts.length}`);
        const fullSystemPrompt = composeSystemPrompt(baseSystemPrompt, facts);
        const apiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
          { role: 'system', content: fullSystemPrompt },
          ...(attachedRefs.length
            ? [{
                role: 'system' as const,
                content: `The user attached object references as EntityRef values. Use these identities rather than guessing titles:\n${JSON.stringify(attachedRefs)}`,
              }]
            : []),
          ...messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        ];

        yield* runStreamingToolLoop({
          t0,
          apiMessages,
          toolResults,
          dispatchContext: {
            token,
            timezone,
            localOverviewActivity,
            latestUserContent: preparedUserContent,
            weeklyOverviewQueryParams: route.weeklyOverviewQueryParams,
            strictThisWeekForWeeklyOverview: route.strictThisWeekForWeeklyOverview,
            conversationId: immediateConversationId,
            conversationIdPromise,
            turn: activeTurn,
            kernel: defaultAssistantKernel,
            signal: context.signal,
          },
          isVoiceMode,
          initialToolChoice: route.forcedToolName
            ? { type: 'function', function: { name: route.forcedToolName } }
            : 'auto',
          signal: context.signal,
        });

        if (context.signal?.aborted) {
          await cancelOwnedTurn(activeTurn, activeStore, 'client_disconnected');
          return;
        }

        mergeDailyBreakdowns(toolResults);
        resolveCanvas(buildCanvasToolPayload(toolResults));
        persistConversationMentions({
          token,
          conversationIdPromise,
          userContent: preparedUserContent,
          attachedRefs,
          assistantRefs: toolResults.entityRefs,
        });
      } catch (error) {
        if (isAbortError(error) || context.signal?.aborted) {
          await cancelOwnedTurn(activeTurn, activeStore, 'client_disconnected');
          return;
        }
        console.error('Chat API stream error:', error);
        resolveCanvas(null);
        await failOwnedTurn(activeTurn, activeStore, error);
        throw error;
      }
    }

    return createChatStreamResponse({
      conversationId: immediateConversationId,
      conversationIdPromise: deferredConversationIdPromise,
      source: {
        type: 'events',
        events: streamTurnEvents(),
      },
      canvasToolPayload: null,
      canvasToolPayloadPromise,
      prefaceLine: '__STREAM_OPEN__',
      onComplete: async (fullText, canvasToolPayload) => {
        try {
          if (context.signal?.aborted) {
            await cancelOwnedTurn(activeTurn, activeStore, 'client_disconnected');
            return;
          }
          const latest = await activeStore.get(activeTurn.id);
          if (!latest) throw new Error('Accepted assistant turn disappeared before completion');
          if (isTerminalTurnStatus(latest.status) || latest.status === 'failed' || latest.status === 'failed_retryable') return;
          await commitTurn(fullText, canvasToolPayload);
        } finally {
          unbindAbort();
        }
      },
    });
  } catch (error) {
    unbindAbort();
    if (isAbortError(error) || context.signal?.aborted) {
      if (turn && store) {
        await cancelOwnedTurn(turn, store, 'client_disconnected');
      }
      return conflictResponse('Turn canceled', { reason: 'client_disconnected' });
    }
    console.error('Chat API error:', error);
    await failOwnedTurn(turn, store, error);
    return new Response(JSON.stringify({
      error: 'Error processing request',
      details: error instanceof Error ? error.message : 'Unknown error',
      state: turn ? 'failed_retryable' : 'unsent',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
