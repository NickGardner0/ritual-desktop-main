import { defineTool } from '../types.js';
import { executeGetScreenTimeSummary } from '@ritual/chat-runtime/executors';

export const getScreenTimeSummaryTool = defineTool({
  name: 'getScreenTimeSummary',
  description: 'Get iPhone/mobile screen time summary.',
  parameters: {
    type: 'object',
    properties: {
      startDate: { type: 'string', description: 'Start date YYYY-MM-DD' },
      endDate: { type: 'string', description: 'End date YYYY-MM-DD' },
      daysBack: { type: 'number', description: 'Look back N days (default 1)' },
      appLimit: { type: 'number', description: 'Top apps (default 10)' },
    },
    required: [],
  },
  sideEffect: 'read_only',
  execute: (args, ctx) => executeGetScreenTimeSummary(ctx.token, args, ctx.timezone),
});
