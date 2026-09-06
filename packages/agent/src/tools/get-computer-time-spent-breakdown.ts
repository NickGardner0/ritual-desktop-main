import { defineTool } from '../types.js';
import { executeGetComputerTimeSpentBreakdown } from '@ritual/chat-runtime/executors';

export const getComputerTimeSpentBreakdownTool = defineTool({
  name: 'getComputerTimeSpentBreakdown',
  description: 'Estimate where computer time was spent using project/task attribution.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Natural language description of what to measure' },
      daysBack: { type: 'number', description: 'Days back (default 7)' },
      limit: { type: 'number', description: 'Max rows (default 8)' },
      groupBy: { type: 'string', description: 'Legacy grouping hint' },
    },
    required: ['query'],
  },
  sideEffect: 'read_only',
  execute: (args, ctx) =>
    executeGetComputerTimeSpentBreakdown(ctx.token, args as any, ctx.timezone),
});
