/**
 * Conversation persistence helpers (create, save messages).
 *
 * Used by the orchestrator for conversation persistence.
 */

import { fetchPythonApi, fetchPythonApiPost } from './executors/shared-api.js';

export async function createConversation(token: string): Promise<string | null> {
  try {
    const data = await fetchPythonApiPost('/api/conversations', token, {});
    const id = typeof data?.id === 'string' ? data.id : null;
    if (id) console.log('💬 Created new conversation:', id);
    return id;
  } catch (error) {
    console.error('❌ Error creating conversation:', error);
    return null;
  }
}

export async function saveMessage(
  token: string,
  conversationId: string,
  role: 'user' | 'assistant',
  content: string,
  toolPayload?: Record<string, unknown> | null
): Promise<boolean> {
  try {
    await fetchPythonApiPost(`/api/conversations/${conversationId}/messages`, token, {
      role,
      content,
      tool_payload: toolPayload || null,
    });
    console.log(`💾 Saved ${role} message to conversation ${conversationId}`);
    return true;
  } catch (error) {
    console.error('❌ Error saving message:', error);
    return false;
  }
}

export async function getPromptFacts(token: string): Promise<Array<Record<string, unknown>>> {
  try {
    const data = await fetchPythonApi('/api/ai-facts', token, { status: 'active' });
    return Array.isArray(data?.items)
      ? data.items.filter((item: { visibility?: string }) => item?.visibility === 'prompt' || item?.visibility === 'ui')
      : [];
  } catch (error) {
    console.error('❌ Error loading prompt facts:', error);
    return [];
  }
}

export async function createFactSuggestions(
  token: string,
  suggestions: Array<Record<string, unknown>>,
): Promise<void> {
  if (!suggestions.length) return;
  await Promise.all(
    suggestions.map((suggestion) =>
      fetchPythonApiPost('/api/ai-facts', token, {
        ...suggestion,
        status: 'pending',
        source_type: suggestion.source_type || 'assistant',
      }).catch((error) => {
        console.error('❌ Error storing fact suggestion:', error);
      }),
    ),
  );
}

const ENTITY_MENTION_TOKEN_RE = /\[\[([a-z_]+):([^\]]+)\]\]/g;
const ENTITY_TYPE_ALIASES: Record<string, string> = {
  report: 'artifact',
  calendar: 'calendar_event',
};
const ENTITY_TYPES = new Set([
  'habit',
  'habit_log',
  'task',
  'routine',
  'artifact',
  'conversation',
  'experiment',
  'calendar_event',
  'calendar_occurrence',
  'day',
  'time_window',
]);

export function canonicalChatEntityType(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (ENTITY_TYPES.has(value)) return value;
  return ENTITY_TYPE_ALIASES[value] || null;
}

export function parseEntityMentionTokens(text: string): Array<{ type: string; id: string }> {
  const items: Array<{ type: string; id: string }> = [];
  const seen = new Set<string>();
  const pattern = new RegExp(ENTITY_MENTION_TOKEN_RE.source, 'g');
  for (const match of String(text || '').matchAll(pattern)) {
    const type = canonicalChatEntityType(match[1]);
    const id = String(match[2] || '').trim();
    if (!type || !id) continue;
    const key = `${type}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ type, id });
  }
  return items;
}

export function collectChatMentionTargets(
  userContent: string,
  attachedRefs: Array<{ type: string; id: string }> = [],
): Array<{ type: string; id: string }> {
  const items: Array<{ type: string; id: string }> = [];
  const seen = new Set<string>();
  for (const ref of [...parseEntityMentionTokens(userContent), ...attachedRefs]) {
    const type = canonicalChatEntityType(ref.type);
    const id = String(ref.id || '').trim();
    if (!type || !id) continue;
    const key = `${type}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ type, id });
  }
  return items;
}

export async function syncEntityMentions(
  token: string,
  source: { type: string; id: string },
  targets: Array<{ type: string; id: string }>,
  provenance: 'user' | 'assistant' | 'workflow' = 'user',
): Promise<boolean> {
  try {
    await fetchPythonApiPost('/api/entities/references/sync', token, {
      source,
      targets,
      provenance,
    } as Record<string, unknown>);
    return true;
  } catch (error) {
    console.error('❌ Error syncing entity mentions:', error);
    return false;
  }
}

export function persistConversationMentions(options: {
  token: string;
  conversationIdPromise: Promise<string | null>;
  userContent: string;
  attachedRefs?: Array<{ type: string; id: string }>;
  assistantRefs?: Array<{ type: string; id: string }>;
}): void {
  const { token, conversationIdPromise, userContent, attachedRefs = [], assistantRefs = [] } = options;
  void conversationIdPromise.then(async (conversationId) => {
    if (!conversationId) return;
    const source = { type: 'conversation', id: conversationId };
    const userTargets = collectChatMentionTargets(userContent, attachedRefs);
    if (userTargets.length) {
      await syncEntityMentions(token, source, userTargets, 'user');
    }
    const assistantTargets = collectChatMentionTargets('', assistantRefs);
    if (assistantTargets.length) {
      await syncEntityMentions(token, source, assistantTargets, 'assistant');
    }
  }).catch((error) => {
    console.error('❌ Error persisting conversation mentions:', error);
  });
}
