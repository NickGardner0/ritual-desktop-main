import OpenAI from 'openai';

import { classifyModelEngineError, ModelEngineError } from './errors.js';
import type {
  ModelEngineAdapter,
  ModelEngineContent,
  ModelEngineEvent,
  ModelEngineInput,
  ModelEngineMessage,
} from './types.js';

let testClient: OpenAI | null = null;

function openAiClient(): OpenAI {
  if (testClient) return testClient;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new ModelEngineError('OPENAI_API_KEY is not configured', 'fatal_provider');
  return new OpenAI({ apiKey });
}

function toOpenAiContent(
  content: ModelEngineContent,
): OpenAI.Chat.Completions.ChatCompletionMessageParam['content'] {
  if (!Array.isArray(content)) return content;
  return content.map((part) => part.type === 'text'
    ? { type: 'text' as const, text: part.text }
    : {
        type: 'image_url' as const,
        image_url: { url: part.imageUrl, detail: part.detail },
      });
}

function toOpenAiMessage(
  message: ModelEngineMessage,
): OpenAI.Chat.Completions.ChatCompletionMessageParam {
  if (message.role === 'assistant') {
    return {
      role: 'assistant',
      content: typeof message.content === 'string' || message.content === null ? message.content : null,
      tool_calls: message.toolCalls?.map((toolCall) => ({
        id: toolCall.id,
        type: 'function' as const,
        function: { name: toolCall.name, arguments: toolCall.arguments },
      })),
    };
  }
  if (message.role === 'tool') {
    return {
      role: 'tool',
      tool_call_id: message.toolCallId || '',
      content: typeof message.content === 'string' ? message.content : '',
    };
  }
  return {
    role: message.role,
    content: toOpenAiContent(message.content),
  } as OpenAI.Chat.Completions.ChatCompletionMessageParam;
}

export class OpenAIModelEngineAdapter implements ModelEngineAdapter {
  async *stream(input: ModelEngineInput): AsyncIterable<ModelEngineEvent> {
    if (input.signal?.aborted) {
      const error = new Error('client_disconnected');
      error.name = 'AbortError';
      throw error;
    }
    try {
      const response = await openAiClient().chat.completions.create(
        {
          model: input.model,
          messages: input.messages.map(toOpenAiMessage),
          tools: input.tools as OpenAI.Chat.Completions.ChatCompletionTool[] | undefined,
          tool_choice: input.toolChoice,
          temperature: input.temperature,
          max_tokens: input.maxTokens,
          response_format: input.responseFormat === 'json_object'
            ? { type: 'json_object' }
            : undefined,
          stream: true,
        },
        input.signal ? { signal: input.signal } : undefined,
      );

      for await (const chunk of response) {
        if (input.signal?.aborted) {
          const error = new Error('client_disconnected');
          error.name = 'AbortError';
          throw error;
        }
        const choice = chunk.choices[0];
        const text = choice?.delta?.content;
        if (text) yield { type: 'text_delta', text };
        for (const toolCall of choice?.delta?.tool_calls || []) {
          yield {
            type: 'tool_call_delta',
            index: toolCall.index,
            id: toolCall.id,
            name: toolCall.function?.name,
            arguments: toolCall.function?.arguments,
          };
        }
        if (choice?.finish_reason) {
          yield { type: 'done', finishReason: choice.finish_reason };
        }
      }
    } catch (error) {
      if (error instanceof ModelEngineError) throw error;
      const kind = classifyModelEngineError(error);
      if (kind === 'canceled') {
        const canceled = new Error('client_disconnected');
        canceled.name = 'AbortError';
        throw canceled;
      }
      throw new ModelEngineError(
        error instanceof Error ? error.message : String(error),
        kind,
        error,
      );
    }
  }
}

export function setOpenAIClientForTests(client: OpenAI | null): void {
  testClient = client;
}
