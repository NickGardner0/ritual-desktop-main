import { defineTool } from '../types.js';
import { executeGetHabitStats } from '@ritual/chat-runtime/executors';

export const getHabitStatsTool = defineTool({
  name: 'getHabitStats',
  description: 'Get statistics for habits. Returns total, average (per day with data), min, max, standard deviation.',
  parameters: {
    type: 'object',
    properties: {
      habitName: { type: 'string', description: 'Specific habit name. Leave empty for all habits.' },
      startDate: { type: 'string', description: 'Start date YYYY-MM-DD' },
      endDate: { type: 'string', description: 'End date YYYY-MM-DD' },
      daysBack: { type: 'number', description: 'Look back N days (default 30)' },
    },
    required: [],
  },
  sideEffect: 'read_only',
  execute: (args, ctx) => executeGetHabitStats(ctx.token, args),
});
