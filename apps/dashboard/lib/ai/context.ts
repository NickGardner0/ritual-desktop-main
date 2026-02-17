/**
 * Shared Context for Ritual AI Agents
 */

import { Agent } from '@ai-sdk-tools/agents';
import { openai } from '@ai-sdk/openai';
import type { LanguageModel, Tool } from 'ai';

/**
 * Application context passed to agents
 */
export interface RitualContext {
  userId: string;
  token: string;
  currentDateTime: string;
  timezone: string;
  chatId?: string;
  [key: string]: unknown;
}

/**
 * Agent configuration type
 */
interface AgentConfig<TContext extends Record<string, unknown>> {
  name: string;
  model: LanguageModel;
  instructions: string | ((context: TContext) => string);
  tools?: Record<string, Tool> | ((context: TContext) => Record<string, Tool>);
  handoffs?: Array<Agent<any>>;
  maxTurns?: number;
  temperature?: number;
  modelSettings?: Record<string, unknown>;
  matchOn?: (string | RegExp)[] | ((message: string) => boolean);
}

/**
 * Build application context dynamically
 */
export function buildRitualContext(params: {
  userId: string;
  token: string;
  chatId?: string;
  timezone?: string;
}): RitualContext {
  const now = new Date();
  return {
    userId: params.userId,
    token: params.token,
    chatId: params.chatId,
    currentDateTime: now.toISOString(),
    timezone: params.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

/**
 * Common rules for agents
 */
export const COMMON_AGENT_RULES = `<behavior_rules>
- Call tools immediately without explanatory text
- Use parallel tool calls when possible
- Provide specific numbers and actionable insights
- Lead with the most important information first
- Use markdown tables for lists and data comparisons
- Be encouraging and provide actionable advice
- Keep responses concise but informative
</behavior_rules>`;

/**
 * Format context for LLM system prompts
 */
export function formatContextForLLM(context: RitualContext): string {
  return `<context>
<current_date>${context.currentDateTime}</current_date>
<timezone>${context.timezone}</timezone>
</context>

Important: Use the current date above for time-sensitive operations.`;
}

/**
 * Create an agent with default settings
 */
export function createRitualAgent(config: AgentConfig<RitualContext>) {
  return new Agent({
    modelSettings: {
      parallel_tool_calls: true,
    },
    ...config,
  });
}

