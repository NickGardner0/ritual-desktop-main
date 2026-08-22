import OpenAI from 'openai';

import { getToolsForChannel } from './tool-registry.js';
import { buildSystemPrompt, isSmsV2PromptActive } from './system-prompt.js';
import { executeDeclaredToolCalls } from './tool-batch.js';
import { defaultAssistantKernel, isInFlightTurnStatus } from './assistant-kernel.js';
import { getAssistantTurnStore } from './assistant-turn-store.js';
import {
  elapsed,
  getOpenAIClient,
  safeJsonParse,
  type ToolExecutionContext,
} from './runtime-tools.js';

// ---------------------------------------------------------------------------
// SMS chat handler — non-streaming, pre-authed, returns plain JSON
// ---------------------------------------------------------------------------

export interface SmsChatRequest {
  turn_id?: string;
  user_message_id?: string;
  user_id: string;
  conversation_id: string;
  user_message: string;
  recent_messages: Array<{ role: string; content: string }>;
  timezone?: string;
  media_urls?: string[];
}

export interface SmsProactiveRequest {
  turn_id?: string;
  conversation_id?: string;
  user_id: string;
  trigger_type: string;
  trigger_prompt: string;
  timezone?: string;
}

export interface SmsChatResponse {
  text: string;
  tool_calls_made: string[];
}

type SmsToolExecution = {
  name: string;
  result: string;
};

const smsToolSchemas = getToolsForChannel('sms');

function formatSmsShortDate(value: string): string | null {
  if (!value || typeof value !== 'string') return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function formatSmsDateRange(start?: string | null, end?: string | null): string | null {
  const startLabel = start ? formatSmsShortDate(start) : null;
  const endLabel = end ? formatSmsShortDate(end) : null;
  if (!startLabel && !endLabel) return null;
  if (!startLabel) return endLabel;
  if (!endLabel || start === end) return startLabel;

  const [startMonth, startDay] = startLabel.split(' ');
  const [endMonth, endDay] = endLabel.split(' ');
  if (startMonth && endMonth && startMonth === endMonth) {
    return `${startMonth} ${startDay}-${endDay}`;
  }
  return `${startLabel} to ${endLabel}`;
}

function countInclusiveDays(start?: string | null, end?: string | null): number | null {
  if (!start || !end) return null;
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  return Math.max(1, Math.round((endMs - startMs) / 86400000) + 1);
}

function formatSmsNumber(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '0';
  return Number(value.toFixed(digits)).toString();
}

function formatSmsValue(value: number, unit?: string | null): string {
  const normalized = String(unit || '').toLowerCase();
  const compact = formatSmsNumber(value);
  if (normalized.includes('hour')) return `${compact}h`;
  if (normalized.includes('minute')) return `${compact} min`;
  if (normalized.includes('second')) return `${compact}s`;
  if (normalized.includes('milligram')) return `${compact}mg`;
  if (normalized.includes('ounce')) return `${compact} oz`;
  if (normalized.includes('mile')) return `${compact} mi`;
  if (normalized.includes('step')) return `${compact} steps`;
  return unit ? `${compact} ${unit}` : compact;
}

function cleanSmsSentence(value: string): string {
  return value
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,!?;:])/g, '$1')
    .trim()
    .replace(/^[•\-–—]\s*/, '')
    .replace(/[.!?;,:\s]+$/g, '');
}

function sanitizeSmsSegment(raw: string): string {
  const stripped = String(raw || '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\r\n/g, '\n');

  const pieces = stripped
    .split('\n')
    .map((line) => cleanSmsSentence(line))
    .filter((line) => {
      if (!line) return false;
      if (/^-{3,}$/.test(line)) return false;
      if (/^here['’]s a (quick )?rundown/i.test(line)) return false;
      if (/^if you need more details/i.test(line)) return false;
      if (/^feel free to ask/i.test(line)) return false;
      if (/^no heart rate data/i.test(line)) return false;
      if (/^there were no scheduled events/i.test(line)) return false;
      if (/suggests an interest in/i.test(line)) return false;
      return true;
    });

  return pieces.join(' ').replace(/\s+/g, ' ').trim();
}

function maybeBuildDeterministicSmsHabitReadReply(toolExecutions: SmsToolExecution[]): string | null {
  if (!toolExecutions.some((execution) => execution.name === 'getHabitStats')) {
    return null;
  }

  const allowedToolNames = new Set(['getHabitStats', 'getDailyBreakdown']);
  if (toolExecutions.some((execution) => !allowedToolNames.has(execution.name))) {
    return null;
  }

  const statsExecution = [...toolExecutions].reverse().find((execution) => execution.name === 'getHabitStats');
  const breakdownExecution = [...toolExecutions].reverse().find((execution) => execution.name === 'getDailyBreakdown');
  if (!statsExecution) return null;

  const stats = safeJsonParse<Record<string, unknown>>(statsExecution.result);
  const breakdown = breakdownExecution
    ? safeJsonParse<Record<string, unknown>>(breakdownExecution.result)
    : null;

  if (!stats || stats.error || stats.success === false) {
    return null;
  }

  const statsHabit = (stats.habit && typeof stats.habit === 'object')
    ? stats.habit as Record<string, unknown>
    : null;
  const breakdownHabit = (breakdown?.habit && typeof breakdown.habit === 'object')
    ? breakdown.habit as Record<string, unknown>
    : null;

  const habitName = typeof statsHabit?.name === 'string'
    ? statsHabit.name
    : typeof breakdownHabit?.name === 'string'
      ? breakdownHabit.name
      : null;
  if (!habitName) return null;

  const statsRange = (stats.date_range && typeof stats.date_range === 'object')
    ? stats.date_range as Record<string, unknown>
    : null;
  const breakdownRange = (breakdown?.date_range && typeof breakdown.date_range === 'object')
    ? breakdown.date_range as Record<string, unknown>
    : null;
  const startDate = typeof statsRange?.start === 'string'
    ? statsRange.start
    : typeof breakdownRange?.start === 'string'
      ? breakdownRange.start
      : null;
  const endDate = typeof statsRange?.end === 'string'
    ? statsRange.end
    : typeof breakdownRange?.end === 'string'
      ? breakdownRange.end
      : null;
  const rangeLabel = formatSmsDateRange(startDate, endDate);

  const unit = typeof statsHabit?.unit === 'string'
    ? statsHabit.unit
    : typeof breakdownHabit?.unit === 'string'
      ? breakdownHabit.unit
      : null;
  const averageValue = Number(
    typeof stats.average_per_day === 'number'
      ? stats.average_per_day
      : typeof stats.average === 'number'
        ? stats.average
        : Number.NaN,
  );
  const daysWithData = Number(
    typeof stats.days_with_data === 'number'
      ? stats.days_with_data
      : typeof breakdown?.days_with_data === 'number'
        ? breakdown.days_with_data
        : Number.NaN,
  );
  const totalDays = countInclusiveDays(startDate, endDate);

  const breakdownRows = Array.isArray(breakdown?.data)
    ? breakdown.data
        .map((entry) => {
          if (!entry || typeof entry !== 'object') return null;
          const row = entry as Record<string, unknown>;
          const date = typeof row.date === 'string' ? row.date : null;
          const value = typeof row.value === 'number' ? row.value : Number.NaN;
          if (!date || !Number.isFinite(value)) return null;
          return { date, value };
        })
        .filter((entry): entry is { date: string; value: number } => Boolean(entry))
    : [];

  const highest = breakdownRows.reduce<{ date: string; value: number } | null>(
    (best, current) => (!best || current.value > best.value ? current : best),
    null,
  );
  const lowest = breakdownRows.reduce<{ date: string; value: number } | null>(
    (best, current) => (!best || current.value < best.value ? current : best),
    null,
  );

  const openingBits = [
    rangeLabel ? `${rangeLabel}:` : null,
    `${habitName} logged on ${Number.isFinite(daysWithData) ? daysWithData : 0}${totalDays ? ` of ${totalDays}` : ''} ${totalDays === 1 ? 'day' : 'days'}`,
  ].filter(Boolean);

  const summaryParts = [
    `${openingBits.join(' ')}.`,
    Number.isFinite(averageValue)
      ? `Average was ${formatSmsValue(averageValue, unit)} per day with data.`
      : null,
    highest && lowest && highest.date !== lowest.date
      ? `Highest was ${formatSmsValue(highest.value, unit)} on ${formatSmsShortDate(highest.date)}; lowest was ${formatSmsValue(lowest.value, unit)} on ${formatSmsShortDate(lowest.date)}.`
      : highest
        ? `Peak was ${formatSmsValue(highest.value, unit)} on ${formatSmsShortDate(highest.date)}.`
        : null,
  ].filter(Boolean);

  return summaryParts.join(' ');
}

function maybeBuildDeterministicSmsActivityReply(toolExecutions: SmsToolExecution[]): string | null {
  if (!toolExecutions.some((execution) => execution.name === 'getActivitySummary')) {
    return null;
  }

  const allowedToolNames = new Set(['getActivitySummary', 'getDailyBiometrics', 'getCalendarEvents']);
  if (toolExecutions.some((execution) => !allowedToolNames.has(execution.name))) {
    return null;
  }

  const activityExecution = [...toolExecutions].reverse().find((execution) => execution.name === 'getActivitySummary');
  if (!activityExecution) return null;

  const parsed = safeJsonParse<Record<string, unknown>>(activityExecution.result);
  if (!parsed || parsed.error || parsed.success === false) {
    return null;
  }

  const fallbackSummary = typeof parsed.calendar_style_summary === 'string'
    ? parsed.calendar_style_summary
    : typeof parsed.rich_activity_summary === 'string'
      ? parsed.rich_activity_summary
      : '';
  const fallbackSentences = sanitizeSmsSegment(fallbackSummary)
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 2);

  const sentences: string[] = [];
  if (sentences.length === 0) {
    sentences.push(...fallbackSentences);
  }

  const normalized = sentences
    .map((sentence) => sanitizeSmsSegment(sentence))
    .filter(Boolean);

  return normalized.length > 0 ? normalized.join(' ') : null;
}

function maybeBuildDeterministicSmsReadReply(toolExecutions: SmsToolExecution[]): string | null {
  return (
    maybeBuildDeterministicSmsHabitReadReply(toolExecutions)
    || maybeBuildDeterministicSmsActivityReply(toolExecutions)
  );
}

function buildFallbackSmsLogReply(parsed: Record<string, unknown>): string | null {
  const habitName = typeof parsed.habit_name === 'string' ? parsed.habit_name : '';
  if (!habitName) return null;
  const amount = parsed.amount;
  const amountText = amount !== null && amount !== undefined ? `: ${amount}` : '';
  return `Logged ${habitName}${amountText}.`;
}

function maybeBuildDeterministicSmsLogReply(toolExecutions: SmsToolExecution[]): string | null {
  if (!toolExecutions.some((execution) => execution.name === 'logHabit')) {
    return null;
  }

  const allowedToolNames = new Set(['listHabits', 'createHabit', 'logHabit']);
  if (toolExecutions.some((execution) => !allowedToolNames.has(execution.name))) {
    return null;
  }

  const latestLogExecution = [...toolExecutions].reverse().find((execution) => execution.name === 'logHabit');
  if (!latestLogExecution) {
    return null;
  }

  try {
    const parsed = JSON.parse(latestLogExecution.result);
    if (!parsed || typeof parsed !== 'object' || parsed.error) {
      return null;
    }
    if (typeof parsed.sms_confirmation === 'string' && parsed.sms_confirmation.trim()) {
      return parsed.sms_confirmation.trim();
    }
    return buildFallbackSmsLogReply(parsed);
  } catch (error) {
    console.warn('⚠️ Failed to parse logHabit SMS confirmation payload:', error);
    return null;
  }
}

/**
 * Handle an SMS chat message. Runs the same tool-calling loop as the
 * in-app chat orchestrator but in non-streaming mode with the SMS
 * system prompt variant. No Clerk auth — the caller (Python backend)
 * has already verified identity via phone number.
 *
 * Returns a plain JSON response with the final text and list of tools used.
 */
export async function handleSmsChatPost(req: Request): Promise<Response> {
  const t0 = performance.now();
  let turn: Awaited<ReturnType<typeof defaultAssistantKernel.begin>> | null = null;
  let store: ReturnType<typeof getAssistantTurnStore> | null = null;

  try {
    // Verify internal secret
    const internalSecret = req.headers.get('x-internal-secret') || '';
    const expectedSecret = process.env.INTERNAL_SMS_CHAT_SECRET || '';
    if (!expectedSecret || internalSecret !== expectedSecret) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const body: SmsChatRequest = await req.json();
    const { user_id, user_message, recent_messages, timezone, media_urls, conversation_id } = body;

    console.log(`📱 [${elapsed(t0)}] SMS chat request: "${user_message.slice(0, 80)}"${media_urls?.length ? ` (+${media_urls.length} media)` : ''}`);

    // Build a composite token for internal service auth.
    // Format: "INTERNAL_BACKEND_TOKEN::user_id" — fetchPythonApi splits
    // this and attaches x-internal-user-id automatically so the Python
    // backend can resolve the user without a Clerk JWT.
    const rawToken = req.headers.get('x-backend-token') || process.env.INTERNAL_BACKEND_TOKEN || '';
    const token = user_id ? `${rawToken}::${user_id}` : rawToken;

    // Build conversation history for OpenAI
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const day = now.getDate();
    const today = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    const fullSystemPrompt = buildSystemPrompt({
      timezone: timezone || 'UTC',
      today,
      currentYear: year,
      isVoiceMode: false,
      channel: 'sms',
    });

    const apiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: fullSystemPrompt },
      // Include recent conversation history for multi-turn context
      ...recent_messages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    ];

    // Ensure the latest user message is the last one (it might already be
    // in recent_messages if the caller pre-appended it, but if the last
    // message in recent_messages doesn't match, add it).
    // When media_urls are present, build a multi-part content array with
    // text + image_url parts so GPT-4o-mini can understand images
    // (workout screenshots, food photos, sleep data, etc.)
    const lastMsg = recent_messages[recent_messages.length - 1];
    if (!lastMsg || lastMsg.content !== user_message || lastMsg.role !== 'user') {
      if (media_urls && media_urls.length > 0) {
        const contentParts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [];
        if (user_message) {
          contentParts.push({ type: 'text', text: user_message });
        } else {
          contentParts.push({
            type: 'text',
            text: 'The user sent this image. Analyze it and determine if it contains habit/health/fitness data to log, or answer any questions about it.',
          });
        }
        for (const url of media_urls) {
          contentParts.push({
            type: 'image_url',
            image_url: { url, detail: 'low' },
          });
        }
        apiMessages.push({ role: 'user', content: contentParts });
      } else {
        apiMessages.push({ role: 'user', content: user_message });
      }
    }

    const toolCallsMade: string[] = [];
    const smsToolExecutions: SmsToolExecution[] = [];
    store = getAssistantTurnStore(token);
    const turnId = body.turn_id || (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `sms_${Date.now()}`);
    turn = await defaultAssistantKernel.begin({
      turnId,
      conversationId: body.conversation_id,
      channel: 'sms',
      epoch: 0,
      userMessage: user_message || `[image: ${(media_urls || []).join(', ')}]`,
      userMessageId: body.user_message_id,
      store,
    });
    if (!turn || !store) {
      throw new Error('assistant turn store missing');
    }
    if (turn.status === 'completed' && turn.assistantText) {
      return new Response(
        JSON.stringify({ text: turn.assistantText, tool_calls_made: [] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (turn.status === 'canceled' || isInFlightTurnStatus(turn.status)) {
      return new Response(
        JSON.stringify({ error: turn.status === 'canceled' ? 'Turn canceled' : 'Turn in flight' }),
        { status: 409, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (turn.status === 'queued') {
      turn = await defaultAssistantKernel.transition(turn, 'running', store);
    }

    const toolCtx: ToolExecutionContext = {
      timezone,
      latestUserContent: user_message,
      weeklyOverviewQueryParams: {},
      conversationId: body.conversation_id,
    };

    // Non-streaming OpenAI call with tool loop (max 4 iterations for SMS)
    // Use gpt-4o (not mini) for better tool discrimination — misrouted
    // writes corrupt habit data, so accuracy matters more than cost here.
    console.log(`📱 [${elapsed(t0)}] OpenAI call #1 start`);
    let response = await getOpenAIClient().chat.completions.create({
      model: 'gpt-4o',
      messages: apiMessages,
      tools: smsToolSchemas,
      tool_choice: 'auto',
      temperature: 0.3,
    });
    console.log(`📱 [${elapsed(t0)}] OpenAI call #1 done`);

    let assistantMessage = response.choices[0].message;
    let iterations = 0;

    while (assistantMessage.tool_calls && iterations < 4) {
      iterations++;
      console.log(
        `📱 [${elapsed(t0)}] Tool loop #${iterations}:`,
        assistantMessage.tool_calls.map((t) => t.function.name),
      );

      apiMessages.push(assistantMessage);

      const toolCallResults = await executeDeclaredToolCalls({
        toolCalls: assistantMessage.tool_calls.map((toolCall) => ({
          id: toolCall.id,
          name: toolCall.function.name,
          arguments: toolCall.function.arguments || '{}',
        })),
        token,
        ctx: toolCtx,
        turn,
        kernel: defaultAssistantKernel,
      });

      for (const { toolCall, result } of toolCallResults) {
        toolCallsMade.push(toolCall.name);
        smsToolExecutions.push({
          name: toolCall.name,
          result,
        });
        apiMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: result,
        });
      }

      // Follow-up call (always non-streaming for SMS)
      console.log(`📱 [${elapsed(t0)}] OpenAI follow-up #${iterations} start`);
      response = await getOpenAIClient().chat.completions.create({
        model: 'gpt-4o',
        messages: apiMessages,
        tools: smsToolSchemas,
        tool_choice: 'auto',
        temperature: iterations < 3 ? 0.3 : 0.7,
      });
      assistantMessage = response.choices[0].message;
      console.log(`📱 [${elapsed(t0)}] OpenAI follow-up #${iterations} done`);
    }

    const deterministicSmsReply = maybeBuildDeterministicSmsLogReply(smsToolExecutions);
    const deterministicSmsReadReply = maybeBuildDeterministicSmsReadReply(smsToolExecutions);
    const finalText = deterministicSmsReply
      || deterministicSmsReadReply
      || assistantMessage.content
      || 'Sorry, I couldn\'t process that. Try again?';
    const abArm = isSmsV2PromptActive() ? 'v2' : 'v1';
    const sanitizedMessages = splitSmsSegments(finalText)
      .map((segment) => sanitizeSmsSegment(segment))
      .filter(Boolean);
    const messages = sanitizedMessages.length > 0
      ? sanitizedMessages
      : [sanitizeSmsSegment(finalText) || 'Sorry, I couldn\'t process that. Try again?'];
    const normalizedText = messages.join('\n---\n');

    console.log(
      `📱 [${elapsed(t0)}] SMS response ready (${normalizedText.length} chars, ${messages.length} segment${messages.length === 1 ? '' : 's'}, ${toolCallsMade.length} tools, arm=${abArm})`,
    );

    await defaultAssistantKernel.commit(turn, store, 0, {
      conversationId: conversation_id,
      assistantText: normalizedText,
    });

    return new Response(
      JSON.stringify({
        // Legacy field: the single concatenated reply. Backend falls back to
        // splitting on the delimiter if `messages` is missing, so this stays
        // safe during rolling deploys where sender + orchestrator versions
        // may briefly mismatch.
        text: normalizedText,
        // New field (Phase 1 T1.2): array of 1–4 segments to send as separate
        // texts with a small delay between. Empty array would be treated as
        // failure by the sender; splitSmsSegments guarantees >=1 segment.
        messages,
        tool_calls_made: toolCallsMade,
        ab_arm: abArm,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('📱 SMS chat error:', error);
    if (turn && store) {
      try {
        await defaultAssistantKernel.fail(turn, store, error);
      } catch (transitionError) {
        console.warn('SMS assistant turn fail skipped:', transitionError);
      }
    }
    return new Response(
      JSON.stringify({
        error: 'SMS chat processing failed',
        details: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

// ---------------------------------------------------------------------------
// SMS segment splitter (Phase 1 T1.2)
// ---------------------------------------------------------------------------

/** Max segments we'll send per turn. More than 4 feels spammy. */
const SMS_MAX_SEGMENTS = 4;
/** Each segment must fit in a natural-feeling single text. */
const SMS_SEGMENT_MAX_CHARS = 220;
/** Delimiter the v2 prompt asks the model to insert between beats. */
const SMS_SEGMENT_DELIMITER = /\n-{3,}\n/;

/**
 * Split an orchestrator reply into 1–4 SMS segments.
 *
 * Safe-by-default: if the model's output is malformed (no delimiter, too
 * many segments, or any segment over the char cap) we fall back to a
 * single-segment reply with the full original text. The caller can then
 * either send it as one message (v1 behavior) or rely on the carrier to
 * chunk long SMS.
 *
 * Contract: always returns at least one non-empty segment. Callers can
 * assume `messages[0]` is present.
 */
export function splitSmsSegments(raw: string): string[] {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) {
    return ['Sorry, I couldn\'t process that. Try again?'];
  }

  const parts = trimmed.split(SMS_SEGMENT_DELIMITER).map((p) => p.trim()).filter(Boolean);

  // No delimiter present, or only one chunk after splitting → single segment.
  if (parts.length <= 1) {
    return [trimmed];
  }

  // Too many segments → safest to collapse back to one reply.
  if (parts.length > SMS_MAX_SEGMENTS) {
    return [trimmed];
  }

  // Any over-length segment → collapse back. Don't truncate; losing content
  // silently is worse than showing a longer single message.
  if (parts.some((p) => p.length > SMS_SEGMENT_MAX_CHARS)) {
    return [trimmed];
  }

  return parts;
}

// ====================
// PROACTIVE SMS HANDLER
// ====================

/**
 * Non-streaming handler for proactive SMS messages (end-of-day recap,
 * morning briefing, etc.). Called by the Python proactive scheduler
 * via /api/chat/sms/proactive.
 *
 * Unlike the reactive handler, this doesn't have a user message —
 * the trigger_prompt tells the model what kind of proactive content
 * to generate, and the model uses tools to gather data.
 */
export async function handleSmsProactivePost(req: Request): Promise<Response> {
  const t0 = performance.now();
  let turn: Awaited<ReturnType<typeof defaultAssistantKernel.begin>> | null = null;
  let store: ReturnType<typeof getAssistantTurnStore> | null = null;

  try {
    // Verify internal secret
    const internalSecret = req.headers.get('x-internal-secret') || '';
    const expectedSecret = process.env.INTERNAL_SMS_CHAT_SECRET || '';
    if (!expectedSecret || internalSecret !== expectedSecret) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const body: SmsProactiveRequest = await req.json();
    const { user_id, trigger_type, trigger_prompt, timezone, conversation_id } = body;

    console.log(`📬 [${elapsed(t0)}] Proactive SMS: trigger="${trigger_type}" user=${user_id}`);

    // Build composite token for internal service auth
    const rawToken = req.headers.get('x-backend-token') || process.env.INTERNAL_BACKEND_TOKEN || '';
    const token = user_id ? `${rawToken}::${user_id}` : rawToken;

    // Build system prompt
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const day = now.getDate();
    const today = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    const fullSystemPrompt = buildSystemPrompt({
      timezone: timezone || 'UTC',
      today,
      currentYear: year,
      isVoiceMode: false,
      channel: 'sms',
    });

    const apiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: fullSystemPrompt },
      // The trigger prompt acts as the "user" message that drives generation
      { role: 'user', content: trigger_prompt },
    ];

    const toolCallsMade: string[] = [];
    store = getAssistantTurnStore(token);
    const turnId = body.turn_id || (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `sms_proactive_${Date.now()}`);
    turn = await defaultAssistantKernel.begin({
      turnId,
      conversationId: conversation_id || null,
      channel: 'sms',
      epoch: 0,
      userMessage: trigger_prompt,
      recordUserMessageInConversation: false,
      store,
    });
    if (!turn || !store) {
      throw new Error('assistant turn store missing');
    }
    if (turn.status === 'completed' && turn.assistantText) {
      return new Response(
        JSON.stringify({ text: turn.assistantText, trigger_type, tool_calls_made: [] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (turn.status === 'canceled' || isInFlightTurnStatus(turn.status)) {
      return new Response(
        JSON.stringify({ error: turn.status === 'canceled' ? 'Turn canceled' : 'Turn in flight' }),
        { status: 409, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (turn.status === 'queued') {
      turn = await defaultAssistantKernel.transition(turn, 'running', store);
    }

    const toolCtx: ToolExecutionContext = {
      timezone,
      latestUserContent: trigger_prompt,
      weeklyOverviewQueryParams: {},
    };

    // Non-streaming OpenAI call with tool loop (max 3 iterations for proactive)
    console.log(`📬 [${elapsed(t0)}] OpenAI call #1 start`);
    let response = await getOpenAIClient().chat.completions.create({
      model: 'gpt-4o',
      messages: apiMessages,
      tools: smsToolSchemas,
      tool_choice: 'auto',
      temperature: 0.5,
    });
    console.log(`📬 [${elapsed(t0)}] OpenAI call #1 done`);

    let assistantMessage = response.choices[0].message;
    let iterations = 0;

    while (assistantMessage.tool_calls && iterations < 3) {
      iterations++;
      console.log(
        `📬 [${elapsed(t0)}] Tool loop #${iterations}:`,
        assistantMessage.tool_calls.map((t) => t.function.name),
      );

      apiMessages.push(assistantMessage);

      const toolCallResults = await executeDeclaredToolCalls({
        toolCalls: assistantMessage.tool_calls.map((toolCall) => ({
          id: toolCall.id,
          name: toolCall.function.name,
          arguments: toolCall.function.arguments || '{}',
        })),
        token,
        ctx: toolCtx,
        turn,
        kernel: defaultAssistantKernel,
      });

      for (const { toolCall, result } of toolCallResults) {
        toolCallsMade.push(toolCall.name);
        apiMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: result,
        });
      }

      console.log(`📬 [${elapsed(t0)}] OpenAI follow-up #${iterations} start`);
      response = await getOpenAIClient().chat.completions.create({
        model: 'gpt-4o',
        messages: apiMessages,
        tools: smsToolSchemas,
        tool_choice: 'auto',
        temperature: 0.5,
      });
      assistantMessage = response.choices[0].message;
      console.log(`📬 [${elapsed(t0)}] OpenAI follow-up #${iterations} done`);
    }

    const finalText = assistantMessage.content || '';

    if (!finalText) {
      if (turn && store) {
        await defaultAssistantKernel.fail(turn, store, new Error('No proactive content generated'));
      }
      return new Response(
        JSON.stringify({ error: 'No proactive content generated' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    }

    console.log(
      `📬 [${elapsed(t0)}] Proactive response ready (${finalText.length} chars, ${toolCallsMade.length} tools)`,
    );

    if (turn && store) {
      await defaultAssistantKernel.commit(turn, store, 0, {
        assistantText: finalText,
      });
    }

    return new Response(
      JSON.stringify({ text: finalText, trigger_type, tool_calls_made: toolCallsMade }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('📬 Proactive SMS error:', error);
    if (turn && store) {
      try {
        await defaultAssistantKernel.fail(turn, store, error);
      } catch (transitionError) {
        console.warn('Proactive SMS assistant turn fail skipped:', transitionError);
      }
    }
    return new Response(
      JSON.stringify({
        error: 'Proactive SMS processing failed',
        details: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
