import { defineTool } from '../types.js';
import { executeGetActivitySummary } from '@ritual/chat-runtime/executors';

export const getActivitySummaryTool = defineTool({
  name: 'getActivitySummary',
  description: 'Get a rich activity summary with structured workstreams.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Natural language query' },
      daysBack: { type: 'number', description: 'Days back (default 1)' },
    },
    required: ['query'],
  },
  sideEffect: 'read_only',
  execute: (args, ctx) => executeGetActivitySummary(ctx.token, args as any, ctx.timezone),
});
