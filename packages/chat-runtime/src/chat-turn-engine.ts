import {
  handleChatStreamRequest,
  type ChatStreamRequestContext,
} from './handle-chat-stream.js';
import {
  handleSmsChatPost,
  handleSmsProactivePost,
} from './sms.js';

export interface ChatTurnEngine {
  stream(context: ChatStreamRequestContext): Promise<Response>;
  smsChat(request: Request): Promise<Response>;
  smsProactive(request: Request): Promise<Response>;
}

export class DefaultChatTurnEngine implements ChatTurnEngine {
  stream(context: ChatStreamRequestContext): Promise<Response> {
    return handleChatStreamRequest(context);
  }

  smsChat(request: Request): Promise<Response> {
    return handleSmsChatPost(request);
  }

  smsProactive(request: Request): Promise<Response> {
    return handleSmsProactivePost(request);
  }
}

export const defaultChatTurnEngine = new DefaultChatTurnEngine();

export function streamChatTurn(
  context: ChatStreamRequestContext,
  engine: ChatTurnEngine = defaultChatTurnEngine,
): Promise<Response> {
  return engine.stream(context);
}

export function runSmsChatTurn(
  request: Request,
  engine: ChatTurnEngine = defaultChatTurnEngine,
): Promise<Response> {
  return engine.smsChat(request);
}

export function runSmsProactiveTurn(
  request: Request,
  engine: ChatTurnEngine = defaultChatTurnEngine,
): Promise<Response> {
  return engine.smsProactive(request);
}
