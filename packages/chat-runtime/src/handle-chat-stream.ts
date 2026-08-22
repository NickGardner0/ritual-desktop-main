import { createChatStreamResponse } from './stream-response.js';
import type { ChatStreamEvent } from './stream-response.js';
import type { ChatToolResults } from './types.js';
import { classifyChatRoute } from './chat-stream/classifier-router.js';
import { handleDeterministicFastPath } from './turn-narrative.js';
import {
  buildCanvasToolPayload,
  elapsed,
} from './chat-stream/shared.js';
import { awaitPromptFacts, composeSystemPrompt, prepareChatTurnContext } from './turn-context.js';
import { persistConversationMentions } from './persistence.js';
import { mergeDailyBreakdowns, runStreamingToolLoop } from './turn-tool-loop.js';
import { defaultAssistantKernel, type AssistantTurnRun } from './assistant-kernel.js';
import { getAssistantTurnStore } from './assistant-turn-store.js';
import type { ModelEngineMessage } from './model-engine/index.js';

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

function isAbortError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'name' in error && (error as { name?: string }).name === 'AbortError');
}

function conflictResponse(error: string, extra: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({ error, ...extra }), {
    status: 409,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleChatStreamRequest(context: ChatStreamRequestContext) {
  const t0 = performance.now();
  let turnRun: AssistantTurnRun | null = null;
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
    turnRun = await defaultAssistantKernel.runTurn({
      turnId: newTurnId(body.turnId),
      conversationId: providedConversationId || null,
      channel: 'dashboard',
      epoch,
      userMessage: latestUserContent,
      responseMode,
      store: getAssistantTurnStore(token),
      signal: context.signal,
    });
    let ownedTurn = turnRun.turn;

    if (turnRun.outcome === 'canceled' || ownedTurn.status === 'canceled') {
      return conflictResponse('Turn canceled', { reason: ownedTurn.error || 'stale_epoch' });
    }

    if (turnRun.outcome === 'replay') {
      if (!ownedTurn.assistantText) {
        return conflictResponse('Completed turn is missing durable assistant content', {
          turnId: ownedTurn.id,
        });
      }
      return createChatStreamResponse({
        conversationId: ownedTurn.conversationId,
        source: { type: 'complete', text: ownedTurn.assistantText },
        canvasToolPayload: ownedTurn.toolPayload,
        prefaceLine: '__STREAM_OPEN__',
      });
    }

    if (turnRun.outcome === 'in_flight') {
      return conflictResponse('Turn in flight', { status: ownedTurn.status, turnId: ownedTurn.id });
    }
    if (context.signal?.aborted) {
      ownedTurn = await turnRun.cancel('client_disconnected');
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

    const activeRun = turnRun;
    const activeTurn = activeRun.turn;
    const commitTurn = async (fullText: string, canvasToolPayload: Record<string, unknown> | null) => {
      if (context.signal?.aborted) {
        await activeRun.cancel('client_disconnected');
        return;
      }
      const conversationId = await conversationIdPromise;
      const receiptIds = Array.isArray((canvasToolPayload as { actionReceipts?: Array<{ receipt_id?: string }> } | null)?.actionReceipts)
        ? ((canvasToolPayload as { actionReceipts: Array<{ receipt_id?: string }> }).actionReceipts
          .map((receipt) => receipt.receipt_id)
          .filter((id): id is string => Boolean(id)))
        : [];
      try {
        await activeRun.complete({
          conversationId,
          assistantText: fullText,
          toolPayload: canvasToolPayload,
          receiptIds,
        });
      } catch (error) {
        await activeRun.fail(error);
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
          await activeRun.cancel('client_disconnected');
          return;
        }
        yield { type: 'phase', phase: 'context' };
        const facts = await awaitPromptFacts(factsPromise);
        if (context.signal?.aborted) {
          await activeRun.cancel('client_disconnected');
          return;
        }
        console.log(`⏱️ [${elapsed(t0)}] facts_ready count=${facts.length}`);
        const fullSystemPrompt = composeSystemPrompt(baseSystemPrompt, facts);
        const apiMessages: ModelEngineMessage[] = [
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
          await activeRun.cancel('client_disconnected');
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
          await activeRun.cancel('client_disconnected');
          return;
        }
        console.error('Chat API stream error:', error);
        resolveCanvas(null);
        await activeRun.fail(error);
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
            await activeRun.cancel('client_disconnected');
            return;
          }
          await commitTurn(fullText, canvasToolPayload);
        } finally {
          activeRun.dispose();
        }
      },
    });
  } catch (error) {
    turnRun?.dispose();
    if (isAbortError(error) || context.signal?.aborted) {
      if (turnRun) await turnRun.cancel('client_disconnected');
      return conflictResponse('Turn canceled', { reason: 'client_disconnected' });
    }
    console.error('Chat API error:', error);
    if (turnRun) {
      try {
        await turnRun.fail(error);
      } catch (transitionError) {
        console.warn('Assistant turn fail transition skipped:', transitionError);
      }
    }
    return new Response(JSON.stringify({
      error: 'Error processing request',
      details: error instanceof Error ? error.message : 'Unknown error',
      state: turnRun ? 'failed_retryable' : 'unsent',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
