/**
 * Triage Agent
 * 
 * Main entry point that routes requests to specialist agents.
 * For now, we only have the habit agent, but this structure allows
 * for future expansion (e.g., goals agent, wellness agent, etc.)
 */

import { openai } from '@ai-sdk/openai';
import { createRitualAgent, formatContextForLLM, type RitualContext } from '../context';
import { habitAgent } from './habit-agent';

export const triageAgent = createRitualAgent({
  name: 'triage',
  model: openai('gpt-4o-mini'),
  temperature: 0.1,
  modelSettings: {
    toolChoice: {
      type: 'tool',
      toolName: 'handoff_to_agent',
    },
  },
  instructions: (ctx: RitualContext) => `Route user requests to the appropriate specialist.

${formatContextForLLM(ctx)}

<agent-capabilities>
habits: Habit statistics, trends, daily breakdowns, progress tracking, averages, totals, computer activity, screen time, app usage, website visits, productivity tracking
</agent-capabilities>

<routing-rules>
- Route ALL habit-related queries to the habits agent
- Queries about tracking, statistics, progress, trends → habits
- Questions like "how many", "how much", "average", "total" → habits
- Specific habit names (workout, sleep, meditation, etc.) → habits
- Computer/screen time questions → habits (it handles computer activity)
- App usage questions (Slack, Chrome, VS Code, etc.) → habits
- Website usage questions (GitHub, Twitter, YouTube, etc.) → habits
- Productivity questions → habits
</routing-rules>`,
  handoffs: [habitAgent],
  maxTurns: 1,
});

