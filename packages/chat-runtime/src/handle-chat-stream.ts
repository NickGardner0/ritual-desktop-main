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
  persistAssistantMessage,
  prepareChatTurnContext,
} from './chat-stream/shared.js';
import { persistConversationMentions } from './persistence.js';
import { mergeDailyBreakdowns, runStreamingToolLoop } from './chat-stream/tool-dispatch.js';

export type ChatStreamRequestBody = {
  messages: Array<{ role: string; content: string }>;
  timezone?: string;
  conversationId?: string | null;
  responseMode?: 'text' | 'voice';
  localOverviewActivity?: unknown;
  entityRefs?: Array<{ type: string; id: string; title?: string }>;
};

export type ChatStreamRequestContext = {
  token: string;
  body: ChatStreamRequestBody;
};

export async function handleChatStreamRequest(context: ChatStreamRequestContext) {
  const t0 = performance.now();
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
    const prepared = prepareChatTurnContext(token, messages, timezone, providedConversationId, responseMode);
    const {
      conversationIdPromise,
      immediateConversationId,
      deferredConversationIdPromise,
      isVoiceMode,
      latestUserContent,
      baseSystemPrompt,
      factsPromise,
    } = prepared;
    const attachedRefs = Array.isArray(entityRefs)
      ? entityRefs.filter((ref) => ref && typeof ref.type === 'string' && typeof ref.id === 'string')
      : [];
    const route = classifyChatRoute(latestUserContent, timezone, isVoiceMode);
    console.log(`⏱️ [${elapsed(t0)}] route=${route.retrievalRoute} forced=${route.forcedToolName || 'none'} voice=${isVoiceMode}`);

    if (route.deterministicFastPath && route.forcedToolName) {
      persistConversationMentions({
        token,
        conversationIdPromise,
        userContent: latestUserContent,
        attachedRefs,
      });
      return handleDeterministicFastPath({
        t0,
        token,
        latestUserContent,
        timezone,
        localOverviewActivity,
        forcedToolName: route.forcedToolName,
        weeklyOverviewQueryParams: route.weeklyOverviewQueryParams,
        strictThisWeekForWeeklyOverview: route.strictThisWeekForWeeklyOverview,
        deferredOverviewFastPath: route.deferredOverviewFastPath,
        immediateConversationId,
        deferredConversationIdPromise,
        conversationIdPromise,
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
        yield { type: 'phase', phase: 'context' };
        const facts = await awaitPromptFacts(factsPromise);
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
            latestUserContent,
            weeklyOverviewQueryParams: route.weeklyOverviewQueryParams,
            strictThisWeekForWeeklyOverview: route.strictThisWeekForWeeklyOverview,
            conversationId: immediateConversationId,
            conversationIdPromise,
          },
          isVoiceMode,
          initialToolChoice: route.forcedToolName
            ? { type: 'function', function: { name: route.forcedToolName } }
            : 'auto',
        });

        mergeDailyBreakdowns(toolResults);
        resolveCanvas(buildCanvasToolPayload(toolResults));
        persistConversationMentions({
          token,
          conversationIdPromise,
          userContent: latestUserContent,
          attachedRefs,
          assistantRefs: toolResults.entityRefs,
        });
      } catch (error) {
        console.error('Chat API stream error:', error);
        resolveCanvas(null);
        yield { type: 'text', text: 'Sorry, there was an error processing your request. Please try again.' };
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
      onComplete: (fullText, canvasToolPayload) => {
        persistAssistantMessage(conversationIdPromise, token, fullText, canvasToolPayload);
      },
    });
  } catch (error) {
    console.error('Chat API error:', error);
    return new Response(JSON.stringify({
      error: 'Error processing request',
      details: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
