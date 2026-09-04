import { defineTool, type ActionReceipt, type EntityRef } from '../types.js';
import { executeLogHabit } from '@ritual/chat-runtime/executors';

export const logHabitTool = defineTool({
  name: 'logHabit',
  description: 'Log a habit entry for the user.',
  parameters: {
    type: 'object',
    properties: {
      habitName: { type: 'string', description: 'Habit name (fuzzy match OK)' },
      amount: { type: 'number', description: 'Numeric value to log' },
      unitType: { type: 'string', description: 'Unit as the user stated it' },
      note: { type: 'string', description: 'Optional note' },
    },
    required: ['habitName'],
  },
  sideEffect: 'mutating',
  execute: (args, ctx) =>
    executeLogHabit(ctx.token, args as any, ctx.timezone, {
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
      if (parsed.log_id) refs.push({ type: 'habit_log', id: parsed.log_id, title: parsed.habit_name });
    } catch { /* ignore */ }
    return refs;
  },
});
