import { Hono } from 'hono';
import { cors } from 'hono/cors';
import {
  handleChatStreamRequest,
  type ChatStreamRequestBody,
  type ChatStreamRequestContext,
} from '@ritual/chat-runtime';
import { UnauthorizedError, verifyBearerToken } from '../lib/auth.js';

type ChatRouterDeps = {
  verifyToken?: (authorizationHeader: string | null | undefined) => Promise<string>;
  handleChatStream?: (context: ChatStreamRequestContext) => Promise<Response>;
};

function getAllowedOrigins(): string[] {
  const envOrigins = (process.env.CHAT_API_CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return Array.from(new Set([
    'http://localhost:3000',
    'https://localhost:3000',
    'tauri://localhost',
    ...envOrigins,
  ]));
}

export function createChatRouter(deps: ChatRouterDeps = {}) {
  const app = new Hono();
  const verifyToken = deps.verifyToken || verifyBearerToken;
  const handleChatStream = deps.handleChatStream || handleChatStreamRequest;
  const allowedOrigins = getAllowedOrigins();

  app.use('*', cors({
    origin: (origin) => {
      if (!origin) return '';
      return allowedOrigins.includes(origin) ? origin : '';
    },
    allowHeaders: ['Authorization', 'Content-Type'],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    credentials: true,
  }));

  app.get('/healthz', (c) => c.json({ ok: true }));

  app.post('/chat/stream', async (c) => {
    try {
      const token = await verifyToken(c.req.header('Authorization'));
      const body = await c.req.json<ChatStreamRequestBody>();
      const response = await handleChatStream({ token, body });
      return response;
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        return c.json({ error: error.message || 'Unauthorized' }, 401);
      }

      console.error('Chat API route error:', error);
      return c.json({
        error: 'Error processing request',
        details: error instanceof Error ? error.message : 'Unknown error',
      }, 500);
    }
  });

  return app;
}
