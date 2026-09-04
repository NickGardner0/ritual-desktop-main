import { defineTool } from '../types.js';
import { executeGetDailyBiometrics } from '@ritual/chat-runtime/executors';

export const getDailyBiometricsTool = defineTool({
  name: 'getDailyBiometrics',
  description: 'Get biometrics data for a specific day.',
  parameters: {
    type: 'object',
    properties: {
      day: { type: 'string', description: 'Date YYYY-MM-DD (default: today)' },
    },
    required: [],
  },
  sideEffect: 'read_only',
  execute: (args, ctx) => executeGetDailyBiometrics(ctx.token, args, ctx.timezone),
});
