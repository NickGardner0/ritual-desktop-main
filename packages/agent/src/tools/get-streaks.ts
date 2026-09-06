import { defineTool } from '../types.js';
import { executeGetStreaks } from '@ritual/chat-runtime/executors';

export const getStreaksTool = defineTool({
  name: 'getStreaks',
  description: 'Get current and best-ever streaks for habits.',
  parameters: {
    type: 'object',
    properties: {
      habitName: { type: 'string', description: 'Specific habit name. Leave empty for all.' },
    },
    required: [],
  },
  sideEffect: 'read_only',
  execute: (args, ctx) => executeGetStreaks(ctx.token, args),
});
