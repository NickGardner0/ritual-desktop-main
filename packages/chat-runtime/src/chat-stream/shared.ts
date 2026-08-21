import OpenAI from 'openai';
import { buildSystemPrompt } from '../system-prompt.js';
import { createConversation, createFactSuggestions, getPromptFacts, saveMessage } from '../persistence.js';
import type { ChatToolResults } from '../types.js';

let _openaiClient: OpenAI | null = null;

export function elapsed(startMs: number): string {
  return `${(performance.now() - startMs).toFixed(0)}ms`;
}

export function getOpenAIClient(): OpenAI {
  if (_openaiClient) return _openaiClient;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured');
  }
  _openaiClient = new OpenAI({ apiKey });
  return _openaiClient;
}

export function setOpenAIClientForTests(client: OpenAI | null): void {
  _openaiClient = client;
}

export function buildCanvasToolPayload(toolResults: ChatToolResults): Record<string, unknown> | null {
  const payload: Record<string, unknown> = {
    stats: toolResults.stats,
    dailyBreakdown: toolResults.dailyBreakdown,
    dailyBreakdownHabit: toolResults.dailyBreakdownHabit,
    correlation: toolResults.correlation,
    trends: toolResults.trends,
    anomalies: toolResults.anomalies,
    screenTimeSpent: toolResults.screenTimeSpent,
    weeklyOverview: toolResults.weeklyOverview,
    dailyOverview: toolResults.dailyOverview,
    monthlyOverview: toolResults.monthlyOverview,
    allStats: toolResults.allStats,
    allBreakdowns: toolResults.allBreakdowns,
    activitySummary: toolResults.activitySummary,
    dailyBiometrics: toolResults.dailyBiometrics,
    screenTimeSummary: toolResults.screenTimeSummary,
    calendarEvents: toolResults.calendarEvents,
    suggested_followups: toolResults.suggested_followups,
    reply_chips: toolResults.reply_chips,
    actionReceipts: toolResults.actionReceipts,
    entityRefs: toolResults.entityRefs,
  };

  for (const key of Object.keys(payload)) {
    const value = payload[key];
    if (value === undefined || value === null) {
      delete payload[key];
      continue;
    }
    if (Array.isArray(value) && value.length === 0) {
      delete payload[key];
    }
  }

  return Object.keys(payload).length > 0 ? payload : null;
}

export function safeJsonParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function deriveFactSuggestionsFromMessage(message: string): Array<Record<string, unknown>> {
  const normalized = message.trim();
  if (!normalized) return [];
  const lower = normalized.toLowerCase();

  const suggestions: Array<Record<string, unknown>> = [];

  if (/\bi prefer\b/.test(lower)) {
    suggestions.push({
      category: 'preference',
      subject: 'user',
      predicate: 'stated_preference',
      value: { statement: normalized },
      confidence: 0.66,
      visibility: 'prompt',
    });
  }

  if (/\b(my goal is|i want to|i'm trying to|i am trying to)\b/.test(lower)) {
    suggestions.push({
      category: 'goal',
      subject: 'user',
      predicate: 'stated_goal',
      value: { statement: normalized },
      confidence: 0.72,
      visibility: 'ui',
    });
  }

  if (/\b(don't|do not|never)\b/.test(lower) && /\b(remind|send|message|notify)\b/.test(lower)) {
    suggestions.push({
      category: 'constraint',
      subject: 'user',
      predicate: 'notification_constraint',
      value: { statement: normalized },
      confidence: 0.74,
      visibility: 'prompt',
    });
  }

  return suggestions.slice(0, 2);
}

export type PreparedChatTurn = {
  conversationIdPromise: Promise<string | null>;
  immediateConversationId: string | null;
  deferredConversationIdPromise: Promise<string | null> | undefined;
  isVoiceMode: boolean;
  latestUserContent: string;
  baseSystemPrompt: string;
  factsPromise: Promise<Array<Record<string, unknown>>>;
  userPersistPromise: Promise<boolean>;
};

const FACTS_CACHE_TTL_MS = 60_000;
const FACTS_TIMEOUT_MS = 1_200;

type FactsCacheEntry = {
  facts?: Array<Record<string, unknown>>;
  promise?: Promise<Array<Record<string, unknown>>>;
  expiresAt: number;
};

const promptFactsCache = new Map<string, FactsCacheEntry>();

export function startPromptFactsFetch(token: string): Promise<Array<Record<string, unknown>>> {
  const cached = promptFactsCache.get(token);
  if (cached?.facts && cached.expiresAt > Date.now()) {
    return Promise.resolve(cached.facts);
  }
  if (cached?.promise && cached.expiresAt > Date.now()) {
    return cached.promise;
  }

  const promise = getPromptFacts(token)
    .then((facts) => {
      promptFactsCache.set(token, {
        facts,
        expiresAt: Date.now() + FACTS_CACHE_TTL_MS,
      });
      return facts;
    })
    .catch((error) => {
      console.error('❌ Error loading prompt facts:', error);
      promptFactsCache.delete(token);
      return [] as Array<Record<string, unknown>>;
    });

  promptFactsCache.set(token, {
    promise,
    expiresAt: Date.now() + FACTS_CACHE_TTL_MS,
  });
  return promise;
}

export async function awaitPromptFacts(
  factsPromise: Promise<Array<Record<string, unknown>>>,
  timeoutMs = FACTS_TIMEOUT_MS,
): Promise<Array<Record<string, unknown>>> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Array<Record<string, unknown>>>((resolve) => {
    timeoutId = setTimeout(() => resolve([]), timeoutMs);
  });
  try {
    return await Promise.race([factsPromise, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export function composeSystemPrompt(
  baseSystemPrompt: string,
  promptFacts: Array<Record<string, unknown>>,
): string {
  const factPromptBlock = promptFacts.length > 0
    ? `\n\n[APPROVED USER FACTS]\n${promptFacts
      .map((fact) => `- ${String(fact.predicate || 'fact')}: ${JSON.stringify(fact.value || {})}`)
      .join('\n')}`
    : '';
  return `${baseSystemPrompt}${factPromptBlock}`;
}

export function prepareChatTurnContext(
  token: string,
  messages: Array<{ role: string; content: string }>,
  timezone: string | undefined,
  providedConversationId: string | null | undefined,
  responseMode: 'text' | 'voice',
): PreparedChatTurn {
  const conversationIdPromise: Promise<string | null> = providedConversationId
    ? Promise.resolve(providedConversationId)
    : createConversation(token);
  const immediateConversationId = providedConversationId || null;
  const deferredConversationIdPromise = providedConversationId ? undefined : conversationIdPromise;
  const isVoiceMode = responseMode === 'voice';
  const latestUserMessage = messages[messages.length - 1];
  const userPersistPromise =
    latestUserMessage?.role === 'user'
      ? persistUserMessage(conversationIdPromise, token, latestUserMessage.content)
      : Promise.resolve(true);

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const today = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const factsPromise = startPromptFactsFetch(token);
  const factSuggestions = deriveFactSuggestionsFromMessage(latestUserMessage?.content || '');
  if (factSuggestions.length > 0) void createFactSuggestions(token, factSuggestions);

  const baseSystemPrompt = buildSystemPrompt({
    timezone: timezone || 'UTC',
    today,
    currentYear: year,
    isVoiceMode,
  });

  return {
    conversationIdPromise,
    immediateConversationId,
    deferredConversationIdPromise,
    isVoiceMode,
    latestUserContent: latestUserMessage?.content || '',
    baseSystemPrompt,
    factsPromise,
    userPersistPromise,
  };
}

export async function persistUserMessage(
  conversationIdPromise: Promise<string | null>,
  token: string,
  text: string,
): Promise<boolean> {
  try {
    const conversationId = await conversationIdPromise;
    if (!conversationId || !text) return false;
    return saveMessage(token, conversationId, 'user', text);
  } catch (error) {
    console.error('❌ Failed to save user message:', error);
    return false;
  }
}

export async function persistAssistantMessage(
  conversationIdPromise: Promise<string | null>,
  token: string,
  text: string,
  canvasToolPayload: Record<string, unknown> | null,
): Promise<boolean> {
  try {
    const conversationId = await conversationIdPromise;
    if (!conversationId) return false;
    return saveMessage(token, conversationId, 'assistant', text, canvasToolPayload);
  } catch (error) {
    console.error('❌ Failed to save assistant message:', error);
    return false;
  }
}
