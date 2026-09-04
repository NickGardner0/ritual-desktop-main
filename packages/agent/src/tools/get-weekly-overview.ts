import { defineTool } from '../types.js';
import { executeGetWeeklyOverview } from '@ritual/chat-runtime/executors';

export const getWeeklyOverviewTool = defineTool({
  name: 'getWeeklyOverview',
  description: 'Get a comprehensive weekly recap across all tracked habits with totals, averages, and computer time.',
  parameters: {
    type: 'object',
    properties: {
      startDate: { type: 'string', description: 'Start date YYYY-MM-DD' },
      endDate: { type: 'string', description: 'End date YYYY-MM-DD' },
      daysBack: { type: 'number', description: 'Lookback days (default 7)' },
      appLimit: { type: 'number', description: 'Top apps/domains rows (default 10)' },
    },
    required: [],
  },
  sideEffect: 'read_only',
  execute: (args, ctx) =>
    executeGetWeeklyOverview(ctx.token, args, ctx.timezone, false, ctx.localOverviewActivity),
});
