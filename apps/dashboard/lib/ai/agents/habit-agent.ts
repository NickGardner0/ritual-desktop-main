// @ts-nocheck
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

    // ============================================
    // COMPUTER ACTIVITY TOOLS
    // ============================================

    getComputerActivity: tool({
      description: `Get computer activity statistics including total screen time, app usage, and website visits. Use this for questions about computer time, screen time, productivity, app usage, or website visits.`,
      inputSchema: z.object({
        startDate: z.string().describe('Start date (YYYY-MM-DD)'),
        endDate: z.string().describe('End date (YYYY-MM-DD)'),
      }),
      execute: async (params) => {
        try {
          const queryParams = new URLSearchParams({
            start_date: params.startDate,
            end_date: params.endDate,
          });

          const [summaryRes, topAppsRes, topDomainsRes] = await Promise.all([
            fetchWithAuth(`${PYTHON_API_BASE}/api/watcher/stats/summary?${queryParams}`, ctx.token),
            fetchWithAuth(`${PYTHON_API_BASE}/api/watcher/stats/top-apps?${queryParams}&limit=10`, ctx.token),
            fetchWithAuth(`${PYTHON_API_BASE}/api/watcher/stats/top-domains?${queryParams}&limit=10`, ctx.token),
          ]);

          const summary = summaryRes.ok ? (await summaryRes.json()).data : null;
          const topApps = topAppsRes.ok ? (await topAppsRes.json()).data : [];
          const topDomains = topDomainsRes.ok ? (await topDomainsRes.json()).data : [];

          if (!summary || summary.total_hours === 0) {
            return { 
              message: "No computer activity data found for this period. The user may not have Computer Use enabled.",
              dateRange: { start: params.startDate, end: params.endDate }
            };
          }

          return {
            dateRange: { start: params.startDate, end: params.endDate },
            summary: {
              totalHours: Math.round(summary.total_hours * 10) / 10,
              avgDailyHours: Math.round(summary.avg_daily_hours * 10) / 10,
              daysTracked: summary.days_tracked,
              uniqueApps: summary.unique_apps,
            },
            topApps: topApps.slice(0, 5).map((app: any) => ({
              name: app.app_name,
              hours: Math.round(app.hours * 10) / 10,
            })),
            topWebsites: topDomains.slice(0, 5).map((domain: any) => ({
              domain: domain.domain,
              hours: Math.round(domain.hours * 10) / 10,
            })),
          };
        } catch (error) {
          return { error: String(error) };
        }
      },
    }),

    getAppUsage: tool({
      description: `Get detailed usage statistics for a specific app. Use when the user asks about time spent on a particular application like Slack, Chrome, VS Code, Cursor, etc.`,
      inputSchema: z.object({
        appName: z.string().describe('Name of the app to look up (e.g., "Slack", "Chrome", "Cursor")'),
        startDate: z.string().describe('Start date (YYYY-MM-DD)'),
        endDate: z.string().describe('End date (YYYY-MM-DD)'),
      }),
      execute: async (params) => {
        try {
          const queryParams = new URLSearchParams({
            start_date: params.startDate,
            end_date: params.endDate,
            limit: '50',
          });

          const topAppsRes = await fetchWithAuth(
            `${PYTHON_API_BASE}/api/watcher/stats/top-apps?${queryParams}`,
            ctx.token
          );

          if (!topAppsRes.ok) throw new Error('Failed to fetch app data');
          const topApps = (await topAppsRes.json()).data || [];

          // Find matching app (case-insensitive partial match)
          const matchingApps = topApps.filter((app: any) =>
            app.app_name.toLowerCase().includes(params.appName.toLowerCase())
          );

          if (matchingApps.length === 0) {
            // Return list of available apps as suggestion
            const availableApps = topApps.slice(0, 10).map((a: any) => a.app_name);
            return {
              found: false,
              message: `No app matching "${params.appName}" found in the tracked period.`,
              availableApps,
              dateRange: { start: params.startDate, end: params.endDate },
            };
          }

          const app = matchingApps[0];
          const totalHours = topApps.reduce((sum: number, a: any) => sum + a.hours, 0);
          const percentageOfTotal = Math.round((app.hours / totalHours) * 100);

          return {
            found: true,
            app: {
              name: app.app_name,
              bundleId: app.app_bundle_id,
              hours: Math.round(app.hours * 10) / 10,
              events: app.total_events,
              percentageOfTotal,
            },
            dateRange: { start: params.startDate, end: params.endDate },
          };
        } catch (error) {
          return { error: String(error) };
        }
      },
    }),

    getWebsiteUsage: tool({
      description: `Get detailed usage statistics for a specific website/domain. Use when the user asks about time spent on websites like GitHub, Twitter, YouTube, etc.`,
      inputSchema: z.object({
        domain: z.string().describe('Domain to look up (e.g., "github.com", "twitter.com", "youtube.com")'),
        startDate: z.string().describe('Start date (YYYY-MM-DD)'),
        endDate: z.string().describe('End date (YYYY-MM-DD)'),
      }),
      execute: async (params) => {
        try {
          const queryParams = new URLSearchParams({
            start_date: params.startDate,
            end_date: params.endDate,
            limit: '50',
          });

          const topDomainsRes = await fetchWithAuth(
            `${PYTHON_API_BASE}/api/watcher/stats/top-domains?${queryParams}`,
            ctx.token
          );

          if (!topDomainsRes.ok) throw new Error('Failed to fetch website data');
          const topDomains = (await topDomainsRes.json()).data || [];

          // Normalize the search domain
          const searchDomain = params.domain.toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, '');

          // Find matching domain
          const matchingDomains = topDomains.filter((d: any) =>
            d.domain.toLowerCase().includes(searchDomain) ||
            searchDomain.includes(d.domain.toLowerCase())
          );

          if (matchingDomains.length === 0) {
            const availableDomains = topDomains.slice(0, 10).map((d: any) => d.domain);
            return {
              found: false,
              message: `No website matching "${params.domain}" found in the tracked period.`,
              availableDomains,
              dateRange: { start: params.startDate, end: params.endDate },
            };
          }

          const domain = matchingDomains[0];
          const totalBrowsingHours = topDomains.reduce((sum: number, d: any) => sum + d.hours, 0);
          const percentageOfBrowsing = Math.round((domain.hours / totalBrowsingHours) * 100);

          return {
            found: true,
            website: {
              domain: domain.domain,
              hours: Math.round(domain.hours * 10) / 10,
              events: domain.total_events,
              percentageOfBrowsing,
            },
            dateRange: { start: params.startDate, end: params.endDate },
          };
        } catch (error) {
          return { error: String(error) };
        }
      },
    }),

    getDailyComputerActivity: tool({
      description: `Get day-by-day computer activity for trend analysis. Shows daily screen time over a period.`,
      inputSchema: z.object({
        days: z.number().default(7).describe('Number of days to look back'),
      }),
      execute: async (params) => {
        try {
          const queryParams = new URLSearchParams({
            days_back: params.days.toString(),
          });

          const dailyRes = await fetchWithAuth(
            `${PYTHON_API_BASE}/api/watcher/stats/daily?${queryParams}`,
            ctx.token
          );

          if (!dailyRes.ok) throw new Error('Failed to fetch daily data');
          const dailyData = (await dailyRes.json()).data || [];

          if (dailyData.length === 0) {
            return { message: "No daily computer activity data found." };
          }

          const values = dailyData.map((d: any) => d.active_hours);
          const avg = values.reduce((a: number, b: number) => a + b, 0) / values.length;
          const total = values.reduce((a: number, b: number) => a + b, 0);

          return {
            days: params.days,
            daysWithData: dailyData.length,
            summary: {
              totalHours: Math.round(total * 10) / 10,
              averageHours: Math.round(avg * 10) / 10,
              highestDay: Math.round(Math.max(...values) * 10) / 10,
              lowestDay: Math.round(Math.min(...values) * 10) / 10,
            },
            dailyData: dailyData.map((d: any) => ({
              date: d.day,
              hours: Math.round(d.active_hours * 10) / 10,
              apps: d.apps_count,
            })),
          };
        } catch (error) {
          return { error: String(error) };
        }
      },
    }),

    // ============================================
    // SCREEN RECORDING SEMANTIC SEARCH INFO
    // ============================================

    getScreenRecordingInfo: tool({
      description: `Get information about what screen recording data is available for semantic search. Use this when users ask questions like "what was I doing at 3pm", "when did I work on X", "find where I saw Y", or other questions about their specific screen activity that require searching through recordings.`,
      inputSchema: z.object({
        queryType: z.enum(['what_was_doing', 'find_content', 'when_did', 'general']).describe('Type of query the user is asking'),
        userQuestion: z.string().describe('The original question the user asked'),
      }),
      execute: async (params) => {
        return {
          available: true,
          searchFeature: 'AI Search',
          location: 'Activity Breakdown panel → AI Search tab',
          capabilities: [
            'Search by natural language (e.g., "React documentation")',
            'Find specific content you were viewing',
            'See thumbnails of matched moments',
            'Filter by time range',
          ],
          howToUse: `To answer "${params.userQuestion}", use the **AI Search** feature in the Activity Breakdown panel. Click on Activity Breakdown (monitor icon) in the sidebar, then select the "AI Search" tab. You can type natural language queries there.`,
          examples: [
            '"meeting notes" → finds when you were looking at meeting notes',
            '"API documentation" → finds when you were reading API docs',
            '"error message" → finds when you encountered errors',
          ],
          dataStored: 'OCR text from your screen + thumbnails (no video files, minimal storage)',
        };
      },
    }),
  };
}

export const habitAgent = createRitualAgent({
  name: 'habits',
  model: openai('gpt-4o-mini'),
  temperature: 0.5,
  instructions: (ctx: RitualContext) => `You are a habit and productivity tracking assistant for Ritual.

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

Computer Time Guidelines:
- Use getComputerActivity for general screen time questions
- Use getAppUsage when asked about specific apps (Slack, Chrome, VS Code, etc.)
- Use getWebsiteUsage when asked about specific websites (GitHub, Twitter, YouTube, etc.)
- Use getDailyComputerActivity for trends over time
- Format hours nicely: "2.5 hours" or "45 minutes" for smaller amounts
- When showing top apps/websites, present as a ranked list

Screen Recording Search Guidelines:
- Use getScreenRecordingInfo when users ask:
  * "What was I doing at [time]?" or "What was I working on?"
  * "When did I [do something]?" or "Find when I saw [something]"
  * Any question about finding specific content they were viewing
  * Questions about their screen history that need semantic search
- The AI Search feature uses OCR text from screen recordings to find moments
- Guide users to the Activity Breakdown → AI Search tab for these queries
- This is different from aggregate stats (which we can answer directly)
</agent-specific-rules>`,
  tools: createTools,
  maxTurns: 5,
  matchOn: [
    'habit', 'habits', 'track', 'workout', 'exercise', 'sleep', 'meditation',
    'how many', 'how much', 'average', 'total', 'trend', 'progress', 'stats',
    // Computer activity keywords
    'computer', 'screen time', 'app', 'apps', 'website', 'websites', 'browsing',
    'productivity', 'slack', 'chrome', 'safari', 'cursor', 'vscode', 'code',
    'github', 'twitter', 'youtube', 'reddit', 'time spent', 'usage',
    // Screen recording semantic search keywords
    'what was i doing', 'when did i', 'find when', 'looking at', 'working on',
    'saw', 'saw the', 'reading', 'screen', 'recording', 'moment', 'search for',
  ],
});
