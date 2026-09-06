import type { SessionItem, SSEEvent } from '@ritual/agent';
import { getAgentRequestUrl } from '@/lib/agent-url';
import { readAlwaysToolScopes } from '@/lib/chat-permission-memory';

export type AgentApprovalDecision = 'allow' | 'deny' | 'always_allow';

export async function readAgentSse(
  response: Response,
  onEvent: (event: SSEEvent) => void,
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (!raw) continue;
      try {
        const event = JSON.parse(raw) as SSEEvent | { error: string };
        if ('error' in event) {
          throw new Error(event.error);
        }
        onEvent(event);
      } catch (error) {
        if (error instanceof SyntaxError) continue;
        throw error;
      }
    }
  }
}

export function applySseEvent(
  items: SessionItem[],
  sessionId: string,
  event: SSEEvent,
): SessionItem[] {
  if (event.type === 'done' || event.type === 'assistant_text_delta') return items;
  const item = {
    session_id: sessionId,
    seq: event.seq,
    type: event.type,
    created_at: new Date().toISOString(),
    payload: event.payload,
  } as SessionItem;
  if (items.some((existing) => existing.seq === item.seq && existing.type === item.type)) {
    return items;
  }
  return [...items, item].sort((a, b) => a.seq - b.seq);
}

export async function postAgentPrompt(input: {
  token: string | null;
  sessionId: string;
  commandId: string;
  text: string;
  timezone: string;
  signal?: AbortSignal;
}): Promise<Response> {
  const response = await fetch(getAgentRequestUrl(), {
    method: 'POST',
    signal: input.signal,
    headers: {
      'Content-Type': 'application/json',
      ...(input.token ? { Authorization: `Bearer ${input.token}` } : {}),
    },
    body: JSON.stringify({
      sessionId: input.sessionId,
      commandId: input.commandId,
      text: input.text,
      timezone: input.timezone,
      alwaysAllowed: readAlwaysToolScopes(),
    }),
  });
  if (!response.ok) {
    const failure = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(failure.error || `Agent request failed: ${response.status}`);
  }
  return response;
}

export async function postAgentApproval(input: {
  token: string | null;
  sessionId: string;
  askSeq: number;
  decision: AgentApprovalDecision;
  timezone: string;
  signal?: AbortSignal;
}): Promise<Response> {
  const response = await fetch(getAgentRequestUrl('/approve'), {
    method: 'POST',
    signal: input.signal,
    headers: {
      'Content-Type': 'application/json',
      ...(input.token ? { Authorization: `Bearer ${input.token}` } : {}),
    },
    body: JSON.stringify({
      sessionId: input.sessionId,
      askSeq: input.askSeq,
      decision: input.decision,
      timezone: input.timezone,
    }),
  });
  if (!response.ok) {
    const failure = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(failure.error || `Agent approval failed: ${response.status}`);
  }
  return response;
}
