/**
 * Stream response helpers for the chat-stream API.
 *
 * Extracted from orchestrator.ts during Phase 5 refactoring.
 * Encapsulates the wire format (conversation ID, text chunks, tool data)
 * and supports both fake-streaming (complete text) and real streaming
 * (async token iterable from OpenAI).
 */

// ---------------------------------------------------------------------------
// Wire format constants
// ---------------------------------------------------------------------------

const STREAM_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  'Connection': 'keep-alive',
} as const;

/** Number of words per fake-stream chunk */
const FAKE_STREAM_CHUNK_SIZE = 5;

/** Delay (ms) between fake-stream chunks for perceived streaming feel */
const FAKE_STREAM_DELAY_MS = 5;

// ---------------------------------------------------------------------------
// Stream source types
// ---------------------------------------------------------------------------

/** Pre-computed text that gets drip-fed in word chunks (fake streaming). */
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

export type ChatStreamEvent =
  | { type: 'phase'; phase: ChatStreamPhase; label?: string }
  | { type: 'text'; text: string };

/** Mixed phase + token stream so the HTTP body can open before model work finishes. */
export interface EventStreamSource {
  type: 'events';
  events: AsyncIterable<ChatStreamEvent>;
}

export type StreamSource = CompleteTextSource | RealTokenSource | EventStreamSource;

export function formatPhaseLine(phase: ChatStreamPhase, label?: string | null): string {
  return `__PHASE__${JSON.stringify({ phase, label: label ?? null })}__END_PHASE__`;
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
        label: typeof parsed.label === 'string' ? parsed.label : null,
      };
    }
  } catch {
    return null;
  }
  return null;
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
   * Use for fire-and-forget persistence.
   */
  onComplete?: (fullText: string, canvasToolPayload: Record<string, unknown> | null) => void;
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
        // Fake-stream: drip-feed pre-computed text in word chunks
        fullText = options.source.text;
        const words = fullText.split(' ');
        for (let i = 0; i < words.length; i += FAKE_STREAM_CHUNK_SIZE) {
          const chunkWords = words.slice(i, i + FAKE_STREAM_CHUNK_SIZE);
          const chunk = (i === 0 ? '' : ' ') + chunkWords.join(' ');
          controller.enqueue(encoder.encode(`0:${JSON.stringify(chunk)}\n`));
          await new Promise((resolve) => setTimeout(resolve, FAKE_STREAM_DELAY_MS));
        }
      } else if (options.source.type === 'events') {
        fullText = '';
        for await (const event of options.source.events) {
          if (event.type === 'phase') {
            enqueueLine(formatPhaseLine(event.phase, event.label));
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
        options.onComplete(fullText, finalCanvasToolPayload);
      }

      controller.close();
    },
  });

  return new Response(stream, { headers: STREAM_HEADERS });
}
