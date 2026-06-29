import type OpenAI from 'openai';
import { toolSchemas } from './tool-registry.js';
import { createChatStreamResponse } from './stream-response.js';
import type { ChatToolResults } from './types.js';
import { classifyChatRoute } from './chat-stream/classifier-router.js';
import {
  applyVoiceMode,
  handleDeterministicFastPath,
  resolveFinalStreamSource,
} from './chat-stream/narrative-router.js';
import {
  buildCanvasToolPayload,
  elapsed,
  getOpenAIClient,
  persistAssistantMessage,
  prepareChatTurnContext,
} from './chat-stream/shared.js';
import { mergeDailyBreakdowns, runToolLoop } from './chat-stream/tool-dispatch.js';

export type ChatStreamRequestBody = {
  messages: Array<{ role: string; content: string }>;
  timezone?: string;
  conversationId?: string | null;
  responseMode?: 'text' | 'voice';
  localOverviewActivity?: unknown;
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
    } = body;
    const prepared = await prepareChatTurnContext(token, messages, timezone, providedConversationId, responseMode);
    const {
      conversationIdPromise,
      immediateConversationId,
      deferredConversationIdPromise,
      isVoiceMode,
      latestUserContent,
      fullSystemPrompt,
    } = prepared;
    const route = classifyChatRoute(latestUserContent, timezone, isVoiceMode);
    console.log(`⏱️ [${elapsed(t0)}] route=${route.retrievalRoute} forced=${route.forcedToolName || 'none'} voice=${isVoiceMode}`);

    if (route.deterministicFastPath && route.forcedToolName) {
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

    const apiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: fullSystemPrompt },
      ...messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    ];

    const response = await getOpenAIClient().chat.completions.create({
      model: 'gpt-4o-mini',
      messages: apiMessages,
      tools: toolSchemas,
      tool_choice: route.forcedToolName
        ? { type: 'function', function: { name: route.forcedToolName } }
        : 'auto',
      temperature: 0.3,
    });

    const toolResults: ChatToolResults = { allStats: [], allBreakdowns: [] };
    const { assistantMessage, streamedSynthesisTokens } = await runToolLoop(
      t0,
      apiMessages,
      response.choices[0].message,
      toolResults,
      {
        token,
        timezone,
        localOverviewActivity,
        latestUserContent,
        weeklyOverviewQueryParams: route.weeklyOverviewQueryParams,
        strictThisWeekForWeeklyOverview: route.strictThisWeekForWeeklyOverview,
      },
      isVoiceMode,
    );

    let finalText = streamedSynthesisTokens ? '' : (assistantMessage.content || 'I was unable to process your request.');
    finalText = applyVoiceMode(finalText, toolResults, isVoiceMode);
    mergeDailyBreakdowns(toolResults);

    const canvasToolPayload = buildCanvasToolPayload(toolResults);
    const streamSource = resolveFinalStreamSource(t0, isVoiceMode, toolResults, streamedSynthesisTokens, finalText);

    if (streamSource.type === 'complete') {
      persistAssistantMessage(conversationIdPromise, token, streamSource.text, canvasToolPayload);
    }

    return createChatStreamResponse({
      conversationId: immediateConversationId,
      conversationIdPromise: deferredConversationIdPromise,
      source: streamSource,
      canvasToolPayload,
      prefaceLine: streamSource.type === 'stream' ? '__STREAM_OPEN__' : undefined,
      onComplete: streamSource.type === 'stream'
        ? (fullText) => persistAssistantMessage(conversationIdPromise, token, fullText, canvasToolPayload)
        : undefined,
    });
  } catch (error) {
    console.error('Chat API error:', error);
    return new Response(JSON.stringify({
      error: 'Error processing request',
      details: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
