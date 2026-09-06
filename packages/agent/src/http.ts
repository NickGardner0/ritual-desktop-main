/**
 * HTTP handlers for the desktop sidecar. The Vite SPA talks here;
 * Next.js is not the host.
 */
import { defaultModelEngine } from '@ritual/chat-runtime/model-engine';
import { admit, run, resumeAfterApproval, type AgentLoopConfig } from './loop.js';
import type { SSEEvent } from './types.js';
import { MemorySessionStore } from './store-memory.js';
import { allTools } from './tools/all.js';

export const store = new MemorySessionStore();

export function ritualSystemPrompt({
  timezone,
  alwaysAllowScopes,
}: {
  timezone?: string;
  alwaysAllowScopes: string[];
}): string {
  const now = new Date();
  const parts = [
    'You are Ritual, a personal AI that helps users track and understand their habits, health, and daily activity.',
    `Current date: ${now.toISOString().split('T')[0]}`,
  ];
  if (timezone) parts.push(`User timezone: ${timezone}`);
  if (alwaysAllowScopes.length > 0) {
    parts.push(`Always-allowed tools (no approval needed): ${alwaysAllowScopes.join(', ')}`);
  }
  return parts.join('\n');
}

export function makeConfig(token: string): AgentLoopConfig {
  return {
    store,
    model: defaultModelEngine as AgentLoopConfig['model'],
    tools: allTools.map((tool) => ({
      ...tool,
      execute: (args, ctx) => tool.execute(args, { ...ctx, token: token || ctx.token }),
    })),
    systemPrompt: ritualSystemPrompt,
  };
}

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function sseStream(write: (emit: (event: SSEEvent | { error: string }) => void) => Promise<void>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: SSEEvent | { error: string }) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      try {
        await write(emit);
      } catch (err) {
        emit({ error: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: SSE_HEADERS });
}

function isAgentPrompt(pathname: string): boolean {
  return pathname === '/agent' || pathname === '/api/agent';
}

function isAgentApprove(pathname: string): boolean {
  return pathname === '/agent/approve' || pathname === '/api/agent/approve';
}

function isAgentItems(pathname: string): boolean {
  return pathname === '/agent/items' || pathname === '/api/agent/items';
}

export function isAgentPath(pathname: string): boolean {
  return isAgentPrompt(pathname) || isAgentApprove(pathname) || isAgentItems(pathname);
}

export async function handleAgentRequest(input: {
  method: string;
  pathname: string;
  url: URL;
  token: string;
  body: string;
  signal?: AbortSignal;
}): Promise<Response | null> {
  if (!isAgentPath(input.pathname)) return null;

  if (input.method === 'GET' && isAgentItems(input.pathname)) {
    if (!input.token) return jsonResponse(401, { error: 'Unauthorized' });
    const sessionId = input.url.searchParams.get('sessionId') || '';
    const afterRaw = input.url.searchParams.get('afterSeq');
    const afterSeq = afterRaw != null && afterRaw !== '' ? Number(afterRaw) : undefined;
    if (!sessionId) return jsonResponse(400, { error: 'Missing sessionId' });
    const items = await store.getItems(
      sessionId,
      Number.isFinite(afterSeq) ? afterSeq : undefined,
    );
    return jsonResponse(200, { items });
  }

  if (input.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }
  if (!input.token) return jsonResponse(401, { error: 'Unauthorized' });

  if (isAgentApprove(input.pathname)) {
    const body = parseJson(input.body) as {
      sessionId?: string;
      askSeq?: number;
      decision?: 'allow' | 'deny' | 'always_allow';
      timezone?: string;
    };
    const { sessionId, askSeq, decision, timezone } = body;
    if (!sessionId || askSeq == null || !decision) {
      return jsonResponse(400, { error: 'Missing sessionId, askSeq, or decision' });
    }
    const config = makeConfig(input.token);
    return sseStream(async (emit) => {
      await resumeAfterApproval(config, sessionId, askSeq, decision, {
        token: input.token,
        timezone,
        emit,
        signal: input.signal,
      });
      emit({ seq: 0, type: 'done', payload: {} });
    });
  }

  const body = parseJson(input.body) as {
    sessionId?: string;
    commandId?: string;
    text?: string;
    timezone?: string;
    alwaysAllowed?: string[];
  };
  const { sessionId, commandId, text, timezone, alwaysAllowed } = body;
  if (!sessionId || !commandId || !text) {
    return jsonResponse(400, { error: 'Missing sessionId, commandId, or text' });
  }

  const config = makeConfig(input.token);
  const userId = input.token;
  await config.store.getOrCreateSession(sessionId, userId);
  if (Array.isArray(alwaysAllowed)) {
    for (const scope of alwaysAllowed) {
      if (typeof scope === 'string' && scope) {
        await config.store.addAlwaysAllowScope(sessionId, scope);
      }
    }
  }

  const admitResult = await admit(config, sessionId, userId, commandId, text);

  return sseStream(async (emit) => {
    if (!admitResult.alreadyAdmitted) {
      emit({ seq: admitResult.seq, type: 'user', payload: { command_id: commandId, text } });
      await run(config, sessionId, {
        token: input.token,
        timezone,
        emit,
        signal: input.signal,
      });
    }
    emit({ seq: 0, type: 'done', payload: {} });
  });
}

function parseJson(raw: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}
