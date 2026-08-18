import { fetchPythonApiPatch, fetchPythonApiPost } from './shared-api.js';

async function resolveConversationId(ctx?: {
  conversationId?: string | null;
  conversationIdPromise?: Promise<string | null>;
}): Promise<string | null> {
  if (ctx?.conversationId) return ctx.conversationId;
  if (ctx?.conversationIdPromise) {
    try {
      return (await ctx.conversationIdPromise) || null;
    } catch {
      return null;
    }
  }
  return null;
}

function newClientEventId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `evt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function withConversationMention(notes: string | undefined, conversationId: string | null): string | undefined {
  if (!conversationId) return notes?.trim() || undefined;
  const token = `[[conversation:${conversationId}]]`;
  const current = (notes || '').trim();
  if (current.includes(token)) return current;
  return current ? `${current}\n\n${token}` : token;
}

export async function executeCreateTask(token: string, params: {
  title: string;
  notes?: string;
  dueAt?: string;
  scheduledFor?: string;
  priority?: string;
  category?: string;
}, conversationCtx?: {
  conversationId?: string | null;
  conversationIdPromise?: Promise<string | null>;
}) {
  try {
    const conversationId = await resolveConversationId(conversationCtx);
    const body: Record<string, unknown> = {
      title: params.title,
      notes: withConversationMention(params.notes, conversationId) || null,
      source: 'ai',
      client_event_id: newClientEventId(),
      conversation_id: conversationId,
    };
    if (params.dueAt) body.due_at = params.dueAt;
    if (params.scheduledFor) body.scheduled_for = params.scheduledFor;
    if (params.priority) body.priority = params.priority;
    if (params.category) body.category = params.category;

    const result = await fetchPythonApiPost('/api/tasks', token, body);
    const receiptId = result?.receipt_id ?? null;
    const wasInserted = result?.was_inserted !== false;

    return JSON.stringify({
      success: true,
      task_id: result.id,
      task_title: result.title,
      status: result.status,
      was_inserted: wasInserted,
      receipt: receiptId
        ? {
            receipt_id: receiptId,
            was_inserted: wasInserted,
            undoable: true,
            task_id: result.id,
            task_title: result.title,
          }
        : null,
      message: `Created task "${result.title}"`,
    });
  } catch (error) {
    console.error('❌ createTask error:', error);
    return JSON.stringify({ error: String(error) });
  }
}

export async function executeUpdateTask(token: string, params: {
  id: string;
  title?: string;
  notes?: string;
  status?: string;
  dueAt?: string;
}) {
  try {
    const taskId = String(params.id || '').trim();
    if (!taskId) {
      return JSON.stringify({ error: 'updateTask requires a task id from a mention or a createTask result.' });
    }
    const body: Record<string, unknown> = {};
    if (params.title != null) body.title = params.title;
    if (params.notes != null) body.notes = params.notes;
    if (params.status != null) body.status = params.status;
    if (params.dueAt != null) body.due_at = params.dueAt;
    if (!Object.keys(body).length) {
      return JSON.stringify({ error: 'updateTask needs at least one field to change.' });
    }

    const result = await fetchPythonApiPatch(`/api/tasks/${encodeURIComponent(taskId)}`, token, body);
    return JSON.stringify({
      success: true,
      task_id: result.id,
      task_title: result.title,
      status: result.status,
      receipt: null,
      message: `Updated task "${result.title}"`,
    });
  } catch (error) {
    console.error('❌ updateTask error:', error);
    return JSON.stringify({ error: String(error) });
  }
}
