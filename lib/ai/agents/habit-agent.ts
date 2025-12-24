/**
 * Habit Agent
 * 
 * Specialist agent for habit statistics, trends, and analysis.
 * Following the exact pattern from Midday's ai-sdk-tools.
 */

import { openai } from '@ai-sdk/openai';
import { tool } from 'ai';
import { z } from 'zod';
import { 
  createRitualAgent, 
  COMMON_AGENT_RULES, 
  formatContextForLLM,
  type RitualContext 
} from '../context';

const PYTHON_API_BASE = process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';

// Helper to make API calls with auth
async function fetchWithAuth(url: string, token: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetch(url, { headers });
}

/**
 * Create tools with context - exactly like Midday
 */
function createTools(ctx: RitualContext) {
  return {
    getHabitStats: tool({
      description: `Get statistics for habits over a date range. Use for totals, averages, trends.`,
      inputSchema: z.object({
        habitName: z.string().optional().describe('Specific habit name, or empty for all'),
        startDate: z.string().describe('Start date (YYYY-MM-DD)'),
        endDate: z.string().describe('End date (YYYY-MM-DD)'),
      }),
      execute: async (params) => {
        try {
          const habitsRes = await fetchWithAuth(`${PYTHON_API_BASE}/api/habits`, ctx.token);
          const logsRes = await fetchWithAuth(`${PYTHON_API_BASE}/api/habit-logs`, ctx.token);
          if (!habitsRes.ok || !logsRes.ok) throw new Error('Failed to fetch data');
          
          const habits = await habitsRes.json();
          const allLogs = await logsRes.json();

          // Filter logs by date
          const logs = allLogs.filter((log: any) => {
            const logDate = log.date || log.completed_at?.split('T')[0];
            return logDate >= params.startDate && logDate <= params.endDate;
          });

          // Filter habits by name
          let targetHabits = habits;
          if (params.habitName) {
            targetHabits = habits.filter((h: any) => 
              h.name.toLowerCase().includes(params.habitName!.toLowerCase())
            );
          }

          if (targetHabits.length === 0) return `No habit found matching "${params.habitName}"`;

          // Calculate stats
          const stats = targetHabits.map((habit: any) => {
            const habitLogs = logs.filter((l: any) => l.habit_id === habit.id);
            const byDate = new Map<string, { duration: number; amount: number }>();
            
            for (const log of habitLogs) {
              const date = log.date || log.completed_at?.split('T')[0] || '';
              const existing = byDate.get(date) || { duration: 0, amount: 0 };
              existing.duration = Math.max(existing.duration, log.duration || 0);
              existing.amount += log.amount || 0;
              byDate.set(date, existing);
            }

            const daysTracked = byDate.size;
            const totalDuration = Array.from(byDate.values()).reduce((s, d) => s + d.duration, 0);
            const totalAmount = Array.from(byDate.values()).reduce((s, d) => s + d.amount, 0);
            const isTimeBased = totalDuration > 0;

            return {
              name: habit.name,
              category: habit.category,
              unit: habit.unit_type || 'sessions',
              daysTracked,
              totalDurationMinutes: Math.round(totalDuration / 60),
              totalAmount: Math.round(totalAmount * 10) / 10,
              avgPerDay: isTimeBased 
                ? Math.round((totalDuration / 60) / Math.max(daysTracked, 1))
                : Math.round((totalAmount / Math.max(daysTracked, 1)) * 10) / 10,
            };
          });

          return { dateRange: { start: params.startDate, end: params.endDate }, habits: stats };
        } catch (error) {
          return { error: String(error) };
        }
      },
    }),

    getDailyBreakdown: tool({
      description: `Get day-by-day breakdown for trend analysis.`,
      inputSchema: z.object({
        habitName: z.string().describe('Habit name'),
        days: z.number().default(14).describe('Days to look back'),
      }),
      execute: async (params) => {
        try {
          const habitsRes = await fetchWithAuth(`${PYTHON_API_BASE}/api/habits`, ctx.token);
          const logsRes = await fetchWithAuth(`${PYTHON_API_BASE}/api/habit-logs`, ctx.token);
          if (!habitsRes.ok || !logsRes.ok) throw new Error('Failed to fetch data');
          
          const habits = await habitsRes.json();
          const habit = habits.find((h: any) => h.name.toLowerCase().includes(params.habitName.toLowerCase()));
          if (!habit) return { error: `No habit found matching "${params.habitName}"` };

          const allLogs = await logsRes.json();
          const startDate = new Date();
          startDate.setDate(startDate.getDate() - params.days);
          // Use local date, NOT toISOString() which converts to UTC
          const startStr = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`;

          const habitLogs = allLogs.filter((l: any) => {
            if (l.habit_id !== habit.id) return false;
            const logDate = l.date || l.completed_at?.split('T')[0];
            return logDate >= startStr;
          });

          const byDate = new Map<string, { duration: number; amount: number }>();
          for (const log of habitLogs) {
            const date = log.date || log.completed_at?.split('T')[0] || '';
            const existing = byDate.get(date) || { duration: 0, amount: 0 };
            existing.duration = Math.max(existing.duration, log.duration || 0);
            existing.amount += log.amount || 0;
            byDate.set(date, existing);
          }

          const isTimeBased = habit.unit_type?.toLowerCase().includes('hour') || habit.unit_type?.toLowerCase().includes('minute');
          const unit = isTimeBased ? 'min' : (habit.unit_type || 'units');

          const entries = Array.from(byDate.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, data]) => ({
              date,
              value: isTimeBased ? Math.round(data.duration / 60) : data.amount,
            }));

          if (entries.length === 0) return { error: `No data for "${habit.name}" in last ${params.days} days` };

          const values = entries.map(e => e.value);
          const summary = {
            average: Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10,
            best: Math.max(...values),
            lowest: Math.min(...values),
          };

          return { habit: habit.name, unit, days: params.days, daysWithData: entries.length, summary, dailyData: entries };
        } catch (error) {
          return { error: String(error) };
        }
      },
    }),

    listHabits: tool({
      description: `List all habits the user is tracking.`,
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const habitsRes = await fetchWithAuth(`${PYTHON_API_BASE}/api/habits`, ctx.token);
          if (!habitsRes.ok) throw new Error('Failed to fetch habits');
          const habits = await habitsRes.json();

          if (habits.length === 0) return { message: "No habits found. User hasn't set up any habits yet." };

          const byCategory: Record<string, Array<{ name: string; unit: string }>> = {};
          for (const habit of habits) {
            const category = habit.category || 'Uncategorized';
            if (!byCategory[category]) byCategory[category] = [];
            byCategory[category].push({ name: habit.name, unit: habit.unit_type || 'sessions' });
          }

          return { totalHabits: habits.length, byCategory };
        } catch (error) {
          return { error: String(error) };
        }
      },
    }),
  };
}

export const habitAgent = createRitualAgent({
  name: 'habits',
  model: openai('gpt-4o-mini'),
  temperature: 0.5,
  instructions: (ctx: RitualContext) => `You are a habit tracking assistant for Ritual.

${formatContextForLLM(ctx)}

${COMMON_AGENT_RULES}

<agent-specific-rules>
- Always use tools to get data - never make up numbers
- Calculate date ranges based on the current date provided above
- For "last 7 days": startDate = 7 days ago, endDate = today
- For "last month": startDate = 30 days ago, endDate = today
- Present statistics clearly with specific numbers
- Use markdown tables for daily breakdowns
- Provide encouraging insights
</agent-specific-rules>`,
  tools: createTools,
  maxTurns: 5,
  matchOn: [
    'habit', 'habits', 'track', 'workout', 'exercise', 'sleep', 'meditation',
    'how many', 'how much', 'average', 'total', 'trend', 'progress', 'stats',
  ],
});
