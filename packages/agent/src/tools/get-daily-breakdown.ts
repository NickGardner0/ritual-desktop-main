import { defineTool } from '../types.js';
import { executeGetDailyBreakdown } from '@ritual/chat-runtime/executors';

export const getDailyBreakdownTool = defineTool({
  name: 'getDailyBreakdown',
  description: 'Get day-by-day breakdown for a habit.',
  parameters: {
    type: 'object',
    properties: {
      habitName: { type: 'string', description: 'Habit name' },
      startDate: { type: 'string', description: 'Start date YYYY-MM-DD' },
      endDate: { type: 'string', description: 'End date YYYY-MM-DD' },
      daysBack: { type: 'number', description: 'Look back N days (default 30)' },
    },
    required: ['habitName'],
  },
  sideEffect: 'read_only',
  execute: (args, ctx) => executeGetDailyBreakdown(ctx.token, args as any, ctx.timezone),
});
