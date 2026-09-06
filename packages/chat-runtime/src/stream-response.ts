/**
 * Stream response helpers for the chat-stream API.
 *
 * Wire format (line-based, newline-delimited):
 *   __CONVERSATION_ID__<id>__END_CONVERSATION_ID__
 *   __STREAM_OPEN__
 *   __PHASE__{"phase":"context"}__END_PHASE__
 *   __TOOL__{"event":"start","id":"...","name":"listHabits"}__END_TOOL__
 *   __PERMISSION__{"event":"ask",...}__END_PERMISSION__
 *   0:"text chunk"
 *   __TOOL_DATA__<json>__END_TOOL_DATA__
 */

// ---------------------------------------------------------------------------
// Wire format constants
// ---------------------------------------------------------------------------

const STREAM_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  'Connection': 'keep-alive',
} as const;

// ---------------------------------------------------------------------------
// Stream source types
// ---------------------------------------------------------------------------

/** Pre-computed text emitted immediately (no fake drip). */
export interface CompleteTextSource {
  type: 'complete';
  text: string;
}

/** Real-time token stream from an OpenAI streaming call. */
export interface RealTokenSource {
  type: 'stream';
  tokens: AsyncIterable<string>;
}

export type ChatStreamPhase = 'context' | 'searching' | 'tool' | 'answering';

export const PHASE_LABELS: Record<ChatStreamPhase, string> = {
  context: 'Preparing context...',
  searching: 'Thinking...',
  tool: 'Fetching data...',
  answering: 'Writing...',
};

export type ChatToolStreamEvent = {
  type: 'tool';
  event: 'start' | 'result' | 'error';
  id: string;
  name: string;
  label?: string;
};

export type ChatPermissionStreamEvent = {
  type: 'permission';
  event: 'ask';
  id: string;
  name: string;
  scope: string;
  profile: string;
};

export type ChatStreamEvent =
  | { type: 'phase'; phase: ChatStreamPhase; label?: string }
  | { type: 'text'; text: string }
  | ChatToolStreamEvent
  | ChatPermissionStreamEvent;

/** Mixed phase + token stream so the HTTP body can open before model work finishes. */
export interface EventStreamSource {
  type: 'events';
  events: AsyncIterable<ChatStreamEvent>;
}

export type StreamSource = CompleteTextSource | RealTokenSource | EventStreamSource;

export function formatPhaseLine(phase: ChatStreamPhase, label?: string | null): string {
  return `__PHASE__${JSON.stringify({ phase, label: label ?? null })}__END_PHASE__`;
}

export function formatToolLine(event: Omit<ChatToolStreamEvent, 'type'>): string {
  return `__TOOL__${JSON.stringify(event)}__END_TOOL__`;
}

export function parseToolLine(line: string): ChatToolStreamEvent | null {
  const match = line.match(/__TOOL__(.+?)__END_TOOL__/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]) as { event?: unknown; id?: unknown; name?: unknown; label?: unknown };
    if (
      (parsed?.event === 'start' || parsed?.event === 'result' || parsed?.event === 'error')
      && typeof parsed.id === 'string'
      && typeof parsed.name === 'string'
    ) {
      return {
        type: 'tool',
        event: parsed.event,
        id: parsed.id,
        name: parsed.name,
        label: typeof parsed.label === 'string' ? parsed.label : undefined,
      };
    }
  } catch {
    return null;
  }
  return null;
}

export function formatPermissionLine(event: Omit<ChatPermissionStreamEvent, 'type'>): string {
  return `__PERMISSION__${JSON.stringify(event)}__END_PERMISSION__`;
}

export function parsePermissionLine(line: string): ChatPermissionStreamEvent | null {
  const match = line.match(/__PERMISSION__(.+?)__END_PERMISSION__/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]) as {
      event?: unknown;
      id?: unknown;
      name?: unknown;
      scope?: unknown;
      profile?: unknown;
    };
    if (
      parsed?.event === 'ask'
      && typeof parsed.id === 'string'
      && typeof parsed.name === 'string'
      && typeof parsed.scope === 'string'
      && typeof parsed.profile === 'string'
    ) {
      return {
        type: 'permission',
        event: 'ask',
        id: parsed.id,
        name: parsed.name,
        scope: parsed.scope,
        profile: parsed.profile,
      };
    }
  } catch {
    return null;
  }
  return null;
}

export function parsePhaseLine(line: string): { phase: ChatStreamPhase; label: string | null } | null {
  const match = line.match(/__PHASE__(.+?)__END_PHASE__/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]) as { phase?: unknown; label?: unknown };
    if (
      parsed?.phase === 'context'
      || parsed?.phase === 'searching'
      || parsed?.phase === 'tool'
      || parsed?.phase === 'answering'
    ) {
      return {
        phase: parsed.phase,
        label: typeof parsed.label === 'string' && parsed.label.trim() ? parsed.label : null,
      };
    }
  } catch {
    return null;
  }
  return null;
}

export function labelForChatPhase(phase: ChatStreamPhase, label?: string | null): string {
  if (label && label.trim()) return label;
  return PHASE_LABELS[phase];
}

// ---------------------------------------------------------------------------
// Options for creating a chat stream response
// ---------------------------------------------------------------------------

export interface ChatStreamResponseOptions {
  /** Conversation ID to send to the client (null = omit). */
  conversationId: string | null;
  /** Deferred conversation ID for paths that should not block response creation. */
  conversationIdPromise?: Promise<string | null>;
  /** The text source — either complete text or a real-time token stream. */
  source: StreamSource;
  /** Canvas/visualization data sent after text (null = omit). */
  canvasToolPayload: Record<string, unknown> | null;
  /** Deferred canvas/visualization data for paths that hot-load text first. */
  canvasToolPayloadPromise?: Promise<Record<string, unknown> | null>;
  /** Raw line emitted before text streaming starts to flush the response body immediately. */
  prefaceLine?: string;
  /**
   * Called once the full text is available (after streaming completes).
   * Persistence should finish before the stream is closed.
   */
  onComplete?: (
    fullText: string,
    canvasToolPayload: Record<string, unknown> | null,
  ) => void | Promise<void>;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a streaming Response in the chat-stream wire format.
 *
 * Wire format (line-based, newline-delimited):
 *   __CONVERSATION_ID__<id>__END_CONVERSATION_ID__   (first line, optional)
 *   __STREAM_OPEN__                                   (optional flush preface)
 *   __PHASE__{"phase":"context"}__END_PHASE__         (optional progress)
 *   0:"text chunk"                                    (JSON-encoded text deltas)
 *   __TOOL_DATA__<json>__END_TOOL_DATA__              (last line, optional)
 */
export function createChatStreamResponse(options: ChatStreamResponseOptions): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const enqueueLine = (line: string) => {
        controller.enqueue(encoder.encode(`${line}\n`));
      };

      // 1. Emit conversation ID
      if (options.conversationId) {
        enqueueLine(`__CONVERSATION_ID__${options.conversationId}__END_CONVERSATION_ID__`);
      }

      const deferredConversationIdPromise = !options.conversationId && options.conversationIdPromise
        ? options.conversationIdPromise
            .then((conversationId) => {
              if (conversationId) {
                enqueueLine(`__CONVERSATION_ID__${conversationId}__END_CONVERSATION_ID__`);
              }
              return conversationId;
            })
            .catch(() => null)
        : Promise.resolve<string | null>(options.conversationId);

      // 2. Emit canvas tool data EARLY so the side panel appears immediately
      if (options.canvasToolPayload) {
        enqueueLine(`__TOOL_DATA__${JSON.stringify(options.canvasToolPayload)}__END_TOOL_DATA__`);
      }

      const deferredCanvasToolPayloadPromise = options.canvasToolPayloadPromise
        ? options.canvasToolPayloadPromise
            .then((payload) => {
              if (payload) {
                enqueueLine(`__TOOL_DATA__${JSON.stringify(payload)}__END_TOOL_DATA__`);
              }
              return payload;
            })
            .catch(() => null)
        : Promise.resolve<Record<string, unknown> | null>(options.canvasToolPayload);

      // 3. Optionally flush the response body before text is ready.
      if (options.prefaceLine) {
        enqueueLine(options.prefaceLine);
      }

      // 4. Stream text content
      let fullText: string;

      if (options.source.type === 'complete') {
        fullText = options.source.text;
        enqueueLine(`0:${JSON.stringify(fullText)}`);
      } else if (options.source.type === 'events') {
        fullText = '';
        for await (const event of options.source.events) {
          if (event.type === 'phase') {
            enqueueLine(formatPhaseLine(event.phase, event.label));
            continue;
          }
          if (event.type === 'tool') {
            enqueueLine(formatToolLine({
              event: event.event,
              id: event.id,
              name: event.name,
              label: event.label,
            }));
            continue;
          }
          if (event.type === 'permission') {
            enqueueLine(formatPermissionLine({
              event: event.event,
              id: event.id,
              name: event.name,
              scope: event.scope,
              profile: event.profile,
            }));
            continue;
          }
          if (!event.text) continue;
          fullText += event.text;
          enqueueLine(`0:${JSON.stringify(event.text)}`);
        }
      } else {
        // Real-stream: forward tokens from an async iterable as they arrive
        fullText = '';
        for await (const token of options.source.tokens) {
          fullText += token;
          enqueueLine(`0:${JSON.stringify(token)}`);
        }
      }

      const finalCanvasToolPayload = await deferredCanvasToolPayloadPromise;
      await deferredConversationIdPromise;

      // 5. Notify caller with full text (for persistence)
      if (options.onComplete) {
        await options.onComplete(fullText, finalCanvasToolPayload);
      }

      controller.close();
    },
  });

  return new Response(stream, { headers: STREAM_HEADERS });
}
