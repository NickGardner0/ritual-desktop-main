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

export type StreamSource = CompleteTextSource | RealTokenSource;

// ---------------------------------------------------------------------------
// Options for creating a chat stream response
// ---------------------------------------------------------------------------

export interface ChatStreamResponseOptions {
  /** Conversation ID to send to the client (null = omit). */
  conversationId: string | null;
  /** The text source — either complete text or a real-time token stream. */
  source: StreamSource;
  /** Canvas/visualization data sent after text (null = omit). */
  canvasToolPayload: Record<string, unknown> | null;
  /**
   * Called once the full text is available (after streaming completes).
   * Use for fire-and-forget persistence.
   */
  onComplete?: (fullText: string) => void;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a streaming Response in the chat-stream wire format.
 *
 * Wire format (line-based, newline-delimited):
 *   __CONVERSATION_ID__<id>__END_CONVERSATION_ID__   (first line, optional)
 *   0:"text chunk"                                    (JSON-encoded text deltas)
 *   __TOOL_DATA__<json>__END_TOOL_DATA__              (last line, optional)
 */
export function createChatStreamResponse(options: ChatStreamResponseOptions): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      // 1. Emit conversation ID
      if (options.conversationId) {
        controller.enqueue(
          encoder.encode(`__CONVERSATION_ID__${options.conversationId}__END_CONVERSATION_ID__\n`),
        );
      }

      // 2. Emit canvas tool data EARLY so the side panel appears immediately
      if (options.canvasToolPayload) {
        controller.enqueue(
          encoder.encode(`__TOOL_DATA__${JSON.stringify(options.canvasToolPayload)}__END_TOOL_DATA__\n`),
        );
      }

      // 3. Stream text content
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
      } else {
        // Real-stream: forward tokens from an async iterable as they arrive
        fullText = '';
        for await (const token of options.source.tokens) {
          fullText += token;
          controller.enqueue(encoder.encode(`0:${JSON.stringify(token)}\n`));
        }
      }

      // 4. Notify caller with full text (for persistence)
      if (options.onComplete) {
        options.onComplete(fullText);
      }

      controller.close();
    },
  });

  return new Response(stream, { headers: STREAM_HEADERS });
}
