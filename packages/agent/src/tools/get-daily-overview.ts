import { defineTool } from '../types.js';
import { executeGetDailyOverview } from '@ritual/chat-runtime/executors';

export const getDailyOverviewTool = defineTool({
  name: 'getDailyOverview',
  description: 'Get a comprehensive daily recap for today across all tracked habits.',
  parameters: {
    type: 'object',
    properties: {
      appLimit: { type: 'number', description: 'Top apps/domains rows (default 10)' },
    },
    required: [],
  },
  sideEffect: 'read_only',
  execute: (args, ctx) =>
    executeGetDailyOverview(ctx.token, args, ctx.timezone, ctx.localOverviewActivity),
});
