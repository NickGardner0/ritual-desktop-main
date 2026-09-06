import { defineTool, type ActionReceipt, type EntityRef } from '../types.js';
import { executeCreateHabit } from '@ritual/chat-runtime/executors';

export const createHabitTool = defineTool({
  name: 'createHabit',
  description: 'Create a new habit for the user to start tracking.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Habit name' },
      category: { type: 'string', description: 'Category (health, fitness, mindfulness, etc.)' },
      unitType: { type: 'string', description: 'Optional unit of measurement' },
    },
    required: ['name', 'category'],
  },
  sideEffect: 'mutating',
  execute: (args, ctx) =>
    executeCreateHabit(ctx.token, args as any, {
      conversationId: ctx.sessionId,
      clientEventId: ctx.idempotencyKey,
    }),
  toReceipt: (result: string): ActionReceipt | null => {
    try {
      const parsed = JSON.parse(result);
      if (parsed.receipt_id) return parsed as ActionReceipt;
    } catch { /* ignore */ }
    return null;
  },
  toEntityRefs: (result: string): EntityRef[] => {
    const refs: EntityRef[] = [];
    try {
      const parsed = JSON.parse(result);
      if (parsed.habit_id) refs.push({ type: 'habit', id: parsed.habit_id, title: parsed.habit_name });
    } catch { /* ignore */ }
    return refs;
  },
});
