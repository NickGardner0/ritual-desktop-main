import { defineTool } from '../types.js';
import { executeGetHabitTrends } from '@ritual/chat-runtime/executors';

export const getHabitTrendsTool = defineTool({
  name: 'getHabitTrends',
  description: 'Compare habit performance between current and previous period.',
  parameters: {
    type: 'object',
    properties: {
      habitName: { type: 'string', description: 'Specific habit name. Leave empty for all.' },
      windowDays: { type: 'number', description: 'Period length in days (default 30)' },
    },
    required: [],
  },
  sideEffect: 'read_only',
  execute: (args, ctx) => executeGetHabitTrends(ctx.token, args),
});
