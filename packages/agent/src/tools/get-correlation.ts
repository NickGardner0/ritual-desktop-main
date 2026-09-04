import { defineTool } from '../types.js';
import { executeGetCorrelation } from '@ritual/chat-runtime/executors';

export const getCorrelationTool = defineTool({
  name: 'getCorrelation',
  description: 'Calculate correlation between two habits.',
  parameters: {
    type: 'object',
    properties: {
      habit1Name: { type: 'string', description: 'First habit name' },
      habit2Name: { type: 'string', description: 'Second habit name' },
      daysBack: { type: 'number', description: 'Days to analyze (default 30)' },
    },
    required: ['habit1Name', 'habit2Name'],
  },
  sideEffect: 'read_only',
  execute: (args, ctx) => executeGetCorrelation(ctx.token, args as any),
});
