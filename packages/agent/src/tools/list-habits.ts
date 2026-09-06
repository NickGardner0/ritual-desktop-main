import { defineTool } from '../types.js';
import { executeListHabits } from '@ritual/chat-runtime/executors';

export const listHabitsTool = defineTool({
  name: 'listHabits',
  description: 'List all habits the user is tracking.',
  parameters: { type: 'object', properties: {} },
  sideEffect: 'read_only',
  execute: (_args, ctx) => executeListHabits(ctx.token),
});
