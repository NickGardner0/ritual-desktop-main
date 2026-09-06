import { defineTool } from '../types.js';
import { executeGetCalendarEvents } from '@ritual/chat-runtime/executors';

export const getCalendarEventsTool = defineTool({
  name: 'getCalendarEvents',
  description: 'Get scheduled events from the user calendar.',
  parameters: {
    type: 'object',
    properties: {
      startDate: { type: 'string', description: 'Start date YYYY-MM-DD' },
      endDate: { type: 'string', description: 'End date YYYY-MM-DD' },
    },
    required: [],
  },
  sideEffect: 'read_only',
  execute: (args, ctx) => executeGetCalendarEvents(ctx.token, args, ctx.timezone),
});
