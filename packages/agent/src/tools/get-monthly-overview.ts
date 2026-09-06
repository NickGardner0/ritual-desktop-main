import { defineTool } from '../types.js';
import { executeGetMonthlyOverview } from '@ritual/chat-runtime/executors';

export const getMonthlyOverviewTool = defineTool({
  name: 'getMonthlyOverview',
  description: 'Get a comprehensive 30-day recap across all tracked habits.',
  parameters: {
    type: 'object',
    properties: {
      appLimit: { type: 'number', description: 'Top apps/domains rows (default 10)' },
    },
    required: [],
  },
  sideEffect: 'read_only',
  execute: (args, ctx) =>
    executeGetMonthlyOverview(ctx.token, args, ctx.timezone, ctx.localOverviewActivity),
});
