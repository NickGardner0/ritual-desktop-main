import { streamText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { NextRequest } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { logger } from '@/lib/logger';
import { tinybirdService } from '@/lib/tinybird-service';

// Python backend API configuration
const PYTHON_API_BASE = process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';

// Check for OpenAI API key
if (!process.env.OPENAI_API_KEY) {
  logger.error('❌ OPENAI_API_KEY is not set in environment variables');
}

export async function POST(req: NextRequest) {
  try {
    logger.info('🔍 Chat stream API called');
    
    // Try to get token from Authorization header first (sent by frontend)
    const authHeader = req.headers.get('Authorization');
    let token: string | null = null;
    let clerkUserId: string | null = null;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
      logger.info('✅ Got token from Authorization header');
    }
    
    // Try Clerk auth as fallback
    try {
      const authResult = await auth();
      if (authResult.userId) {
        clerkUserId = authResult.userId;
        if (!token) {
          token = await authResult.getToken();
        }
      }
    } catch (authError) {
      logger.error('⚠️ Clerk auth() error (using header token if available):', authError);
    }

    if (!token && !clerkUserId) {
      logger.error('❌ No authentication found');
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const { messages, userId } = await req.json();
    
    logger.info('📝 Received messages:', messages?.length);
    
    // Use userId from request if Clerk auth failed
    const effectiveUserId = clerkUserId || userId;
    const effectiveToken = token;
    
    logger.info('🔍 API /api/chat/stream called:', {
      hasClerkUserId: !!clerkUserId,
      hasToken: !!token,
      messageLength: messages.length
    });

    // Fetch user's current habits from Python backend AND analytics from Tinybird
    let userHabits: any[] = [];
    let habitStats: any = null;
    let tinybirdSummary: any = null;
    let tinybirdTrends: any = null;
    
    try {
      const headers: Record<string, string> = {};
      if (effectiveToken) {
        headers['Authorization'] = `Bearer ${effectiveToken}`;
      }
      
      // Fetch habits from Python backend (Turso)
      const habitsResponse = await fetch(`${PYTHON_API_BASE}/api/habits`, {
        headers
      });
      if (habitsResponse.ok) {
        userHabits = await habitsResponse.json();
        logger.info('✅ Fetched habits from Python backend:', userHabits.length);
      }

      // Fetch analytics from Tinybird (much faster and richer analytics)
      // Use 90 days to ensure AI has full month data for accurate monthly calculations
      if (effectiveUserId) {
        try {
          // Get summary stats from Tinybird (90 days for full monthly context)
          tinybirdSummary = await tinybirdService.getUserHabitsSummary(effectiveUserId, 90);
          logger.info('✅ Fetched Tinybird summary:', tinybirdSummary);
          
          // Get trends from Tinybird (90 days for full monthly context)
          tinybirdTrends = await tinybirdService.getHabitTrends(effectiveUserId, 'day', 90);
          logger.info('✅ Fetched Tinybird trends:', tinybirdTrends);
        } catch (tinybirdError) {
          logger.error('⚠️ Error fetching from Tinybird (continuing with limited data):', tinybirdError);
        }
      }

      // Fallback: Also fetch from Python backend if Tinybird data is unavailable
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const startDate = thirtyDaysAgo.toISOString().split('T')[0];
      const today = new Date().toISOString().split('T')[0];

      // Get logs for all habits from Python backend
      const logsPromises = userHabits.map(async (habit) => {
        try {
          const logsResponse = await fetch(
            `${PYTHON_API_BASE}/api/habits/${habit.id}/logs?start_date=${startDate}&end_date=${today}`,
            { headers }
          );
          if (logsResponse.ok) {
            const logs = await logsResponse.json();
            return { habitName: habit.name, logs };
          }
        } catch (error) {
          logger.error(`Failed to fetch logs for habit ${habit.name}:`, error);
        }
        return null;
      });

      const logsData = await Promise.all(logsPromises);
      habitStats = logsData.filter(Boolean);
      
    } catch (error) {
      logger.error('❌ Error fetching habit data:', error);
    }

    // Build context about user's habits
    const habitsContext = userHabits.length > 0 
      ? `\n\nUSER'S HABITS:\n${userHabits.map(h => `- "${h.name}" (Category: ${h.category}${h.unit_type ? `, Unit: ${h.unit_type}` : ''})`).join('\n')}`
      : '\n\nNote: User has no habits tracked yet.';

    // Build context from Tinybird analytics (preferred - more detailed)
    let tinybirdContext = '';
    if (tinybirdSummary && tinybirdSummary.data && tinybirdSummary.data.length > 0) {
      logger.info('🔍 Building Tinybird context from summary data:', {
        dataLength: tinybirdSummary.data.length,
        habitNames: tinybirdSummary.data.map((s: any) => s.habit_name)
      });
      
      tinybirdContext = `\n\nANALYTICS DATA (Last 30 Days from Tinybird):\n${tinybirdSummary.data.map((stat: any) => {
        const parts = [`- ${stat.habit_name}: ${stat.completed_count || 0} entries`];
        if (stat.total_duration_seconds > 0) {
          // Convert to hours for hour-based habits, minutes for minute-based
          const unit = stat.unit || '';
          if (unit.toLowerCase().includes('hour')) {
            parts.push(`${Math.round((stat.total_duration_seconds / 3600) * 10) / 10} total hours`);
            parts.push(`avg ${Math.round((stat.total_duration_seconds / stat.completed_count / 3600) * 10) / 10} hours per entry`);
          } else {
            parts.push(`${Math.round(stat.total_duration_seconds / 60)} total minutes`);
          }
        }
        if (stat.total_amount > 0) {
          parts.push(`${stat.total_amount} total ${stat.unit || 'units'}`);
        }
        if (stat.avg_amount > 0) {
          parts.push(`avg ${Math.round(stat.avg_amount * 10) / 10} per entry`);
        }
        if (stat.current_streak > 0) {
          parts.push(`${stat.current_streak}-day streak`);
        }
        if (stat.last_completed_date) {
          parts.push(`last: ${stat.last_completed_date}`);
        }
        return parts.join(', ');
      }).join('\n')}`;
      
      logger.info('✅ Tinybird context built, length:', tinybirdContext.length);
    } else {
      logger.warn('⚠️ No Tinybird summary data available:', {
        hasSummary: !!tinybirdSummary,
        hasData: !!tinybirdSummary?.data,
        dataLength: tinybirdSummary?.data?.length || 0
      });
    }

    // Add detailed trend information if available (day-by-day breakdown)
    if (tinybirdTrends && tinybirdTrends.data && tinybirdTrends.data.length > 0) {
      const trendsByHabit = new Map();
      tinybirdTrends.data.forEach((trend: any) => {
        if (!trendsByHabit.has(trend.habit_name)) {
          trendsByHabit.set(trend.habit_name, []);
        }
        trendsByHabit.get(trend.habit_name).push(trend);
      });
      
      tinybirdContext += `\n\nDAILY TRENDS (Last 90 Days - for calculating averages and analyzing patterns):\n${Array.from(trendsByHabit.entries()).map(([habitName, trends]: [string, any]) => {
        // Show day-by-day data for month calculations
        const dailyData = trends.map((t: any) => {
          // Check if this is hour-based or minute-based
          const matchingHabit = userHabits.find(h => h.name === habitName);
          const unitType = matchingHabit?.unit_type || t.unit || '';
          
          let valueStr = '';
          if (t.total_duration > 0) {
            if (unitType.toLowerCase().includes('hour')) {
              const hours = Math.round((t.total_duration / 3600) * 10) / 10;
              valueStr = `${hours} hours`;
            } else {
              const minutes = Math.round(t.total_duration / 60);
              valueStr = `${minutes} minutes`;
            }
          }
          if (t.total_amount > 0) {
            valueStr = valueStr ? `${valueStr}, ${t.total_amount} ${t.unit || 'units'}` : `${t.total_amount} ${t.unit || 'units'}`;
          }
          
          return `${t.date}: ${valueStr || 'logged'}`;
        });
        return `- ${habitName}:\n  ${dailyData.join('\n  ')}`;
      }).join('\n')}`;
      
      logger.info('✅ Added detailed daily trends to context:', {
        habitsWithTrends: Array.from(trendsByHabit.keys()),
        totalDays: tinybirdTrends.data.length
      });
    }

    // Build context about recent activity from Python backend (fallback)
    const statsContext = habitStats && habitStats.length > 0 && !tinybirdContext
      ? `\n\nRECENT ACTIVITY (Last 30 Days):\n${habitStats.map((stat: any) => {
          const logs = stat.logs || [];
          const totalEntries = logs.length;
          const totalDuration = logs.reduce((sum: number, log: any) => sum + (log.duration || 0), 0);
          const totalAmount = logs.reduce((sum: number, log: any) => sum + (log.amount || 0), 0);
          return `- ${stat.habitName}: ${totalEntries} entries${totalDuration > 0 ? `, ${Math.round(totalDuration / 60)} total minutes` : ''}${totalAmount > 0 ? `, ${totalAmount} total` : ''}`;
        }).join('\n')}`
      : '';

    const systemPrompt = `You are a helpful and insightful habit tracking assistant. You help users understand their habits, patterns, and progress.

Current date: ${new Date().toISOString().split('T')[0]}

Your capabilities:
- Answer questions about their habits and tracking data
- Provide insights and analysis of their behavior patterns
- Offer encouragement and suggestions for improvement
- Help them understand trends and correlations
- Give actionable advice based on their data
- Query analytics from Tinybird for rich insights

Be conversational, friendly, and supportive. Use the data provided to give specific, personalized insights.

${habitsContext}${tinybirdContext || statsContext}

When the user asks questions:
- Reference specific habits and data points when relevant
- Calculate and explain trends if asked (use the trend data provided)
- **CRITICAL DATE FILTERING**: If asked about a specific month (e.g., "November"), ONLY use dates from that month. For "November 2025", ONLY include dates starting with "2025-11-" in your calculations. Do NOT include October or December dates.
- For time-based metrics, durations are stored in seconds - convert appropriately (hours or minutes based on the unit type)
- Show your math when calculating averages (e.g., "Based on 25 days in November (2025-11-01 to 2025-11-26): 177 total hours / 25 days = 7.1 hours average")
- Mention streaks and progress metrics when available
- Be encouraging about progress
- Suggest actionable next steps
- Keep responses concise but informative (2-4 sentences usually)

CRITICAL: If the analytics data shows entries with total_duration_seconds > 0, that means data EXISTS for that habit. Calculate averages and totals from the data provided. Don't say "no data" if there are entries listed above.

ACCURACY RULE: You have 90 days of data. When calculating monthly statistics, filter by the exact month prefix (e.g., "2025-11-" for November 2025). Never mix data from different months.

Remember: You're here to help them build better habits and understand their behavior patterns better. The analytics data comes from Tinybird which tracks all their habit logs.`;

    logger.info('📋 System prompt length:', systemPrompt.length);
    logger.info('📋 Context included:', {
      hasHabitsContext: habitsContext.length > 0,
      hasTinybirdContext: tinybirdContext.length > 0,
      hasStatsContext: statsContext.length > 0,
    });
    
    // Log the full system prompt for debugging (first 2000 chars)
    logger.info('📋 System prompt preview:', systemPrompt.substring(0, 2000));

    // Check for OpenAI API key before proceeding
    if (!process.env.OPENAI_API_KEY) {
      logger.error('❌ OPENAI_API_KEY is missing');
      return new Response(JSON.stringify({ 
        error: 'OpenAI API key not configured'
      }), { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Stream the response using Vercel AI SDK with custom streaming
    logger.info('🤖 Calling OpenAI with system prompt');
    
    try {
      const result = await streamText({
        model: openai('gpt-4o-mini'),
        system: systemPrompt,
        messages: messages,
        temperature: 0.7,
      });

      logger.info('✅ Stream initialized, creating custom response');
      
      // Create a custom stream that's easier for our client to parse
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of result.textStream) {
              // Send each chunk in a simple format: just the text with a newline
              const data = `0:"${chunk}"\n`;
              controller.enqueue(encoder.encode(data));
            }
            controller.close();
          } catch (error) {
            logger.error('Error in stream:', error);
            controller.error(error);
          }
        },
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Transfer-Encoding': 'chunked',
        },
      });
    } catch (streamError) {
      logger.error('❌ Error creating stream:', streamError);
      return new Response(JSON.stringify({ 
        error: 'Failed to generate response',
        details: streamError instanceof Error ? streamError.message : 'Unknown error'
      }), { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  } catch (error) {
    logger.error('❌ Error in streaming chat API:', error);
    return new Response(JSON.stringify({ 
      error: 'Error processing request',
      details: error instanceof Error ? error.message : 'Unknown error'
    }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

