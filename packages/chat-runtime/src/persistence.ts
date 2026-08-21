/**
 * Conversation persistence helpers (create, save messages).
 *
 * Used by the orchestrator for conversation persistence.
 */

const PYTHON_API_BASE = process.env.PYTHON_API_URL || process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';

export async function createConversation(token: string): Promise<string | null> {
  try {
    const response = await fetch(`${PYTHON_API_BASE}/api/conversations`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    if (response.ok) {
      const data = await response.json();
      console.log('💬 Created new conversation:', data.id);
      return data.id;
    }
    console.error('❌ Failed to create conversation:', await response.text());
    return null;
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
    const response = await fetch(`${PYTHON_API_BASE}/api/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        role,
        content,
        tool_payload: toolPayload || null,
      }),
    });
    if (response.ok) {
      console.log(`💾 Saved ${role} message to conversation ${conversationId}`);
      return true;
    }
    console.error('❌ Failed to save message:', await response.text());
    return false;
  } catch (error) {
    console.error('❌ Error saving message:', error);
    return false;
  }
}

export async function getPromptFacts(token: string): Promise<Array<Record<string, unknown>>> {
  try {
    const response = await fetch(`${PYTHON_API_BASE}/api/ai-facts?status=active`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data?.items) ? data.items.filter((item: any) => item?.visibility === 'prompt' || item?.visibility === 'ui') : [];
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
  try {
    await Promise.all(
      suggestions.map((suggestion) =>
        fetch(`${PYTHON_API_BASE}/api/ai-facts`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ...suggestion,
            status: 'pending',
            source_type: suggestion.source_type || 'assistant',
          }),
        }).catch((error) => {
          console.error('❌ Error storing fact suggestion:', error);
        }),
      ),
    );
  } catch (error) {
    console.error('❌ Error storing fact suggestions:', error);
  }
}

const ENTITY_MENTION_TOKEN_RE = /\[\[([a-z_]+):([^\]]+)\]\]/g;
const ENTITY_TYPE_ALIASES: Record<string, string> = {
  report: 'artifact',
  calendar: 'calendar_block',
};
const ENTITY_TYPES = new Set([
  'habit',
  'habit_log',
  'task',
  'routine',
  'artifact',
  'conversation',
  'experiment',
  'calendar_block',
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
    const response = await fetch(`${PYTHON_API_BASE}/api/entities/references/sync`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ source, targets, provenance }),
    });
    if (!response.ok) {
      console.error('❌ Failed to sync entity mentions:', await response.text());
      return false;
    }
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
