import { defineTool } from '../types.js';
import { executeGetHabitAnomalies } from '@ritual/chat-runtime/executors';

export const getHabitAnomaliesTool = defineTool({
  name: 'getHabitAnomalies',
  description: 'Identify unusual days for a habit using statistical analysis.',
  parameters: {
    type: 'object',
    properties: {
      habitName: { type: 'string', description: 'Habit name' },
      startDate: { type: 'string', description: 'Start date YYYY-MM-DD' },
      endDate: { type: 'string', description: 'End date YYYY-MM-DD' },
      daysBack: { type: 'number', description: 'Look back N days (default 30)' },
      zThreshold: { type: 'number', description: 'Z-score threshold (default 2.0)' },
      maxResults: { type: 'number', description: 'Max anomalies (default 5)' },
    },
    required: ['habitName'],
  },
  sideEffect: 'read_only',
  execute: (args, ctx) => executeGetHabitAnomalies(ctx.token, args as any),
});
