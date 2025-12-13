import { NextRequest } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const PYTHON_API_BASE = process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';

// ====================
// API HELPERS
// ====================

async function fetchPythonApi(endpoint: string, token: string, params?: Record<string, string | number>) {
  const url = new URL(`${PYTHON_API_BASE}${endpoint}`);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.append(key, String(value));
      }
    });
  }
  
  console.log(`🐍 Calling Python API: ${url.toString()}`);
  
  const response = await fetch(url.toString(), {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error(`❌ Python API error: ${response.status}`, errorText);
    throw new Error(`API error: ${response.status} - ${errorText}`);
  }
  
  return response.json();
}

// ====================
// CONVERSATION PERSISTENCE HELPERS
// ====================

async function createConversation(token: string): Promise<string | null> {
  try {
    const response = await fetch(`${PYTHON_API_BASE}/api/conversations`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    if (response.ok) {
      const data = await response.json();
      console.log('💬 Created new conversation:', data.id);
      return data.id;
    }
    console.error('❌ Failed to create conversation:', await response.text());
    return null;
  } catch (error) {
    console.error('❌ Error creating conversation:', error);
    return null;
  }
}

async function saveMessage(
  token: string,
  conversationId: string,
  role: 'user' | 'assistant',
  content: string,
  toolPayload?: Record<string, unknown> | null
): Promise<boolean> {
  try {
    const response = await fetch(`${PYTHON_API_BASE}/api/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        role,
        content,
        tool_payload: toolPayload || null,
      }),
    });
    if (response.ok) {
      console.log(`💾 Saved ${role} message to conversation ${conversationId}`);
      return true;
    }
    console.error('❌ Failed to save message:', await response.text());
    return false;
  } catch (error) {
    console.error('❌ Error saving message:', error);
    return false;
  }
}

// ====================
// MEMORY HELPERS
// ====================

interface EffectiveMemory {
  default_time_window_days: number;
  preferred_timezone: string | null;
  preferred_response_style: 'concise' | 'balanced' | 'detailed';
  preferred_units: Record<string, string> | null;
  preferred_focus_habits: string[] | null;
}

const DEFAULT_MEMORY: EffectiveMemory = {
  default_time_window_days: 30,
  preferred_timezone: null,
  preferred_response_style: 'balanced',
  preferred_units: null,
  preferred_focus_habits: null,
};

async function getEffectiveMemory(
  token: string,
  conversationId?: string | null
): Promise<EffectiveMemory> {
  try {
    const url = new URL(`${PYTHON_API_BASE}/api/chat/memory/effective`);
    if (conversationId) {
      url.searchParams.append('conversation_id', conversationId);
    }
    
    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    
    if (response.ok) {
      const memory = await response.json();
      console.log('🧠 Loaded effective memory:', memory);
      return {
        default_time_window_days: memory.default_time_window_days ?? DEFAULT_MEMORY.default_time_window_days,
        preferred_timezone: memory.preferred_timezone ?? DEFAULT_MEMORY.preferred_timezone,
        preferred_response_style: memory.preferred_response_style ?? DEFAULT_MEMORY.preferred_response_style,
        preferred_units: memory.preferred_units ?? DEFAULT_MEMORY.preferred_units,
        preferred_focus_habits: memory.preferred_focus_habits ?? DEFAULT_MEMORY.preferred_focus_habits,
      };
    }
    console.warn('⚠️ Failed to load memory, using defaults');
    return DEFAULT_MEMORY;
  } catch (error) {
    console.error('❌ Error loading memory:', error);
    return DEFAULT_MEMORY;
  }
}

function buildMemoryPromptSection(memory: EffectiveMemory): string {
  const styleDescriptions: Record<string, string> = {
    concise: 'Keep responses brief and to-the-point. Use bullet points. Limit to 3-4 key insights.',
    balanced: 'Provide moderate detail. Include context but stay focused.',
    detailed: 'Give thorough explanations. Include more analysis and context.',
  };

  const lines: string[] = [
    '',
    '--- USER PREFERENCES ---',
    `Default analysis window: Last ${memory.default_time_window_days} days (use this when no specific dates mentioned)`,
    `Response style: ${memory.preferred_response_style} - ${styleDescriptions[memory.preferred_response_style] || styleDescriptions.balanced}`,
  ];

  if (memory.preferred_timezone) {
    lines.push(`Preferred timezone: ${memory.preferred_timezone} (use for interpreting "yesterday", "last week", etc.)`);
  }

  if (memory.preferred_focus_habits && memory.preferred_focus_habits.length > 0) {
    lines.push(`Focus habits: ${memory.preferred_focus_habits.join(', ')} (suggest these when relevant, but don't assume intent)`);
  }

  lines.push('--- END PREFERENCES ---');
  lines.push('');

  return lines.join('\n');
}

// ====================
// TOOL DEFINITIONS
// ====================

const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'getHabitStats',
      description: 'Get statistics for habits. Returns total, average (per day with data), min, max, standard deviation. Use for questions about totals, averages, performance.',
      parameters: {
        type: 'object',
        properties: {
          habitName: { type: 'string', description: 'Specific habit name (e.g., "sleep", "workout", "daily walk"). Leave empty for all habits.' },
          startDate: { type: 'string', description: 'Start date in YYYY-MM-DD format' },
          endDate: { type: 'string', description: 'End date in YYYY-MM-DD format' },
          daysBack: { type: 'number', description: 'Alternative to dates: look back N days from today (default 30)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getDailyBreakdown',
      description: 'REQUIRED: Get day-by-day breakdown for a habit. MUST be called alongside getHabitStats for ANY habit question to populate the side panel table. Use same date range as getHabitStats.',
      parameters: {
        type: 'object',
        properties: {
          habitName: { type: 'string', description: 'Habit name to get breakdown for' },
          startDate: { type: 'string', description: 'Start date in YYYY-MM-DD format (use same as getHabitStats)' },
          endDate: { type: 'string', description: 'End date in YYYY-MM-DD format (use same as getHabitStats)' },
          daysBack: { type: 'number', description: 'Alternative to dates: look back N days from today (default 30)' },
        },
        required: ['habitName'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getCorrelation',
      description: 'Calculate correlation between two habits. Use for questions like "Is there a connection between X and Y?"',
      parameters: {
        type: 'object',
        properties: {
          habit1Name: { type: 'string', description: 'First habit name' },
          habit2Name: { type: 'string', description: 'Second habit name' },
          daysBack: { type: 'number', description: 'Days to analyze (default 30)' },
        },
        required: ['habit1Name', 'habit2Name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'listHabits',
      description: 'List all habits the user is tracking. Use to see what habits are available.',
      parameters: { type: 'object', properties: {} },
    },
  },
];

// ====================
// TOOL EXECUTION - Calls Python Analytics API
// ====================

async function executeGetHabitStats(token: string, params: { 
  habitName?: string;
  startDate?: string;
  endDate?: string;
  daysBack?: number;
}, defaultDaysBack: number = 30) {
  // Use memory's default if no explicit date params provided
  const effectiveDaysBack = params.daysBack || (params.startDate || params.endDate ? undefined : defaultDaysBack);
  console.log('📊 getHabitStats called:', params, 'defaultDaysBack:', defaultDaysBack, 'effective:', effectiveDaysBack);
  
  try {
    const result = await fetchPythonApi('/api/analytics/stats', token, {
      habit_name: params.habitName || '',
      start_date: params.startDate || '',
      end_date: params.endDate || '',
      days_back: effectiveDaysBack || defaultDaysBack,
    });
    
    if (!result.success) {
      return JSON.stringify({
        error: result.error,
        available_habits: result.available_habits
      });
    }
    
    return JSON.stringify(result);
  } catch (error) {
    console.error('❌ getHabitStats error:', error);
    return JSON.stringify({ error: String(error) });
  }
}

async function executeGetDailyBreakdown(token: string, params: { 
  habitName: string; 
  startDate?: string;
  endDate?: string;
  daysBack?: number;
}, timezone?: string, defaultDaysBack: number = 30) {
  // Use memory's default if no explicit date params provided
  const effectiveDaysBack = params.daysBack || (params.startDate || params.endDate ? undefined : defaultDaysBack);
  console.log('📊 getDailyBreakdown called:', params, 'timezone:', timezone, 'defaultDaysBack:', defaultDaysBack, 'effective:', effectiveDaysBack);
  
  try {
    const result = await fetchPythonApi('/api/analytics/daily-breakdown', token, {
      habit_name: params.habitName,
      start_date: params.startDate || '',
      end_date: params.endDate || '',
      days_back: effectiveDaysBack || defaultDaysBack,
      timezone: timezone || '',
    });
    
    if (!result.success) {
      return JSON.stringify({
        error: result.error,
        available_habits: result.available_habits
      });
    }
    
    return JSON.stringify(result);
  } catch (error) {
    console.error('❌ getDailyBreakdown error:', error);
    return JSON.stringify({ error: String(error) });
  }
}

async function executeGetCorrelation(token: string, params: { 
  habit1Name: string; 
  habit2Name: string;
  daysBack?: number;
}, defaultDaysBack: number = 30) {
  // Use memory's default if no explicit daysBack provided
  const effectiveDaysBack = params.daysBack || defaultDaysBack;
  console.log('📊 getCorrelation called:', params, 'defaultDaysBack:', defaultDaysBack, 'effective:', effectiveDaysBack);
  
  try {
    const result = await fetchPythonApi('/api/analytics/correlation', token, {
      habit1_name: params.habit1Name,
      habit2_name: params.habit2Name,
      days_back: effectiveDaysBack,
    });
    
    if (!result.success) {
      return JSON.stringify({
        error: result.error,
        available_habits: result.available_habits
      });
    }
    
    return JSON.stringify(result);
  } catch (error) {
    console.error('❌ getCorrelation error:', error);
    return JSON.stringify({ error: String(error) });
  }
}

async function executeListHabits(token: string) {
  console.log('📊 listHabits called');
  
  try {
    const result = await fetchPythonApi('/api/analytics/list-habits', token);
    return JSON.stringify(result);
  } catch (error) {
    console.error('❌ listHabits error:', error);
    return JSON.stringify({ error: String(error) });
  }
}

// ====================
// MAIN API HANDLER
// ====================

export async function POST(req: NextRequest) {
  try {
    // Auth
    const authHeader = req.headers.get('Authorization');
    let token: string | null = null;
    
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    }
    
    try {
      const authResult = await auth();
      if (authResult.userId && !token) {
          token = await authResult.getToken();
      }
    } catch {
      // Use header token
    }

    if (!token) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
        status: 401, headers: { 'Content-Type': 'application/json' }
      });
    }

    const { messages, timezone, conversationId: providedConversationId } = await req.json();
    
    // Get or create conversation ID for persistence
    let conversationId = providedConversationId;
    if (!conversationId) {
      conversationId = await createConversation(token);
      console.log('📝 New conversation created:', conversationId);
    }
    
    // Load effective memory (user preferences + conversation overrides)
    const effectiveMemory = await getEffectiveMemory(token, conversationId);
    const defaultDaysBack = effectiveMemory.default_time_window_days;
    
    // Get the latest user message to save
    const latestUserMessage = messages[messages.length - 1];
    
    // Save the user message to the conversation (don't block on this)
    if (conversationId && latestUserMessage?.role === 'user') {
      // Fire and forget - don't block the response
      saveMessage(token, conversationId, 'user', latestUserMessage.content).catch(err => {
        console.error('❌ Failed to save user message:', err);
      });
    }
    
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1; // 1-indexed
    
    // Build memory prompt section
    const memorySection = buildMemoryPromptSection(effectiveMemory);

    // System prompt
    const systemPrompt = `You are a helpful habit tracking assistant for Ritual.
You provide accurate insights about the user's habit data using the analytics tools.

Current date: ${today}
Current year: ${currentYear}
Timezone: ${timezone || 'UTC'}

IMPORTANT: All statistics come from the Python backend (single source of truth).
- "average" means total divided by DAYS WITH DATA (not per entry)
- Always use tools to get real data - never make up numbers

CRITICAL - ALWAYS call BOTH tools for habit questions:
1. getHabitStats - for totals, averages, min/max
2. getDailyBreakdown - for the daily table in the side panel
The user's side panel shows a daily breakdown table that REQUIRES getDailyBreakdown data.
Even for simple questions like "What was my sleep in October?", call BOTH tools with the SAME date range.

TIME DATA: The getDailyBreakdown response includes an "entries" array for each day with individual log times.
- Each entry has a "time" field (HH:MM format) showing when the habit was logged
- For habits like caffeine, this shows what time each coffee was consumed
- When relevant (e.g., asking about patterns), mention the times in your response
- Example: "You had 200mg at 8:30 and another 100mg at 14:00"

RESPONSE FORMAT - Keep it concise:
1. Brief intro (1-2 sentences)
2. Key findings with **bold** numbers
3. If time patterns are relevant, mention notable times
4. For correlations: state the coefficient and what it means
5. End with 1-2 actionable insights

DATE RANGE INTERPRETATION - Use the current year (${currentYear}) unless explicitly specified:
- "this month" → startDate = first of current month, endDate = today
- "last week" → daysBack = 7
- "October" → startDate = ${currentYear}-10-01, endDate = ${currentYear}-10-31
- "November" → startDate = ${currentYear}-11-01, endDate = ${currentYear}-11-30
- When a month is mentioned without a year, ALWAYS use ${currentYear}
- Only use a past year if the user explicitly says "October 2024" or similar

MULTI-MONTH QUERIES: When the user asks about multiple months (e.g., "October and November"), use a SINGLE combined date range:
- "October and November" → startDate = ${currentYear}-10-01, endDate = ${currentYear}-11-30
- Do NOT make separate tool calls for each month - use one call with the full range

NEVER list every single day's data in your response - the user sees that in a side panel.
Be encouraging and supportive!
${memorySection}`;

    // Build messages for OpenAI
    const apiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...messages.map((m: { role: string; content: string }) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    ];

    // Call OpenAI
    let response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: apiMessages,
      tools,
      tool_choice: 'auto',
      temperature: 0.7,
    });

    let assistantMessage = response.choices[0].message;

    // Collect tool results for frontend canvas
    // Note: For multi-habit/multi-period queries, we accumulate results
    const toolResults: { 
      stats?: any[]; 
      dailyBreakdown?: any; 
      dailyBreakdownHabit?: any; 
      correlation?: any;
      allStats?: any[];  // Accumulate all stats calls
      allBreakdowns?: { habit: any; data: any[] }[];  // Accumulate all breakdown calls
    } = {
      allStats: [],
      allBreakdowns: []
    };

    // Handle tool calls (loop up to 5 times for complex queries)
    let iterations = 0;
    while (assistantMessage.tool_calls && iterations < 5) {
      iterations++;
      console.log(`🔧 Tool call iteration ${iterations}:`, assistantMessage.tool_calls.map(t => t.function.name));
      
      apiMessages.push(assistantMessage);

      for (const toolCall of assistantMessage.tool_calls) {
        const args = JSON.parse(toolCall.function.arguments || '{}');
        let result: string;

        try {
          switch (toolCall.function.name) {
            case 'getHabitStats':
              result = await executeGetHabitStats(token, args, defaultDaysBack);
              // Store stats for canvas - accumulate all calls
              try {
                const parsed = JSON.parse(result);
                if (parsed.success && parsed.habits) {
                  // Accumulate all stats calls for multi-habit queries
                  toolResults.allStats = toolResults.allStats || [];
                  toolResults.allStats.push(...parsed.habits);
                  // Also keep the most recent for backwards compatibility
                  toolResults.stats = parsed.habits;
                }
              } catch {}
              break;
            case 'getDailyBreakdown':
              result = await executeGetDailyBreakdown(token, args, timezone, defaultDaysBack);
              // Store daily breakdown for canvas - accumulate all calls
              try {
                const parsed = JSON.parse(result);
                if (parsed.success) {
                  // Accumulate all breakdown calls for multi-period queries
                  toolResults.allBreakdowns = toolResults.allBreakdowns || [];
                  if (parsed.habit && parsed.data) {
                    toolResults.allBreakdowns.push({
                      habit: parsed.habit,
                      data: parsed.data
                    });
                  }
                  // Keep the most recent/primary for backwards compatibility
                  // Use the FIRST breakdown (usually the main habit being asked about)
                  if (!toolResults.dailyBreakdown || toolResults.dailyBreakdown.length === 0) {
                    toolResults.dailyBreakdown = parsed.data || [];
                    if (parsed.habit) {
                      toolResults.dailyBreakdownHabit = parsed.habit;
                    }
                  }
                }
              } catch {}
              break;
            case 'getCorrelation':
              result = await executeGetCorrelation(token, args, defaultDaysBack);
              // Store correlation for canvas
              try {
                const parsed = JSON.parse(result);
                if (parsed.success) {
                  toolResults.correlation = parsed;
                }
              } catch {}
              break;
            case 'listHabits':
              result = await executeListHabits(token);
              break;
            default:
              result = JSON.stringify({ error: `Unknown tool: ${toolCall.function.name}` });
          }
        } catch (error) {
          console.error(`❌ Tool ${toolCall.function.name} error:`, error);
          result = JSON.stringify({ error: String(error) });
        }

        console.log(`📊 Tool ${toolCall.function.name} result length:`, result.length);

        apiMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: result,
        });
      }

      response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: apiMessages,
        tools,
        tool_choice: 'auto',
        temperature: 0.7,
      });

      assistantMessage = response.choices[0].message;
    }

    const finalText = assistantMessage.content || 'I was unable to process your request.';
    
    // Merge breakdown data if multiple calls were made for the same habit
    if (toolResults.allBreakdowns && toolResults.allBreakdowns.length > 1) {
      // Check if all breakdowns are for the same habit
      const habitIds = toolResults.allBreakdowns.map(b => b.habit?.id).filter(Boolean);
      const uniqueHabitIds = [...new Set(habitIds)];
      
      if (uniqueHabitIds.length === 1) {
        // Same habit, different periods - merge the data
        const mergedData: any[] = [];
        const seenDates = new Set<string>();
        
        for (const breakdown of toolResults.allBreakdowns) {
          for (const entry of (breakdown.data || [])) {
            if (!seenDates.has(entry.date)) {
              seenDates.add(entry.date);
              mergedData.push(entry);
            }
          }
        }
        
        // Sort by date
        mergedData.sort((a, b) => a.date.localeCompare(b.date));
        
        // Update the primary breakdown with merged data
        toolResults.dailyBreakdown = mergedData;
        toolResults.dailyBreakdownHabit = toolResults.allBreakdowns[0].habit;
        
        console.log('📦 Merged breakdown data from', toolResults.allBreakdowns.length, 'calls:', mergedData.length, 'entries');
      }
    }
    
    // Log tool results being sent
    console.log('📦 Tool results for canvas:', Object.keys(toolResults));

    // Save assistant message with tool payload (fire and forget)
    if (conversationId) {
      const toolPayloadToSave = Object.keys(toolResults).length > 0 ? toolResults : null;
      saveMessage(token, conversationId, 'assistant', finalText, toolPayloadToSave).catch(err => {
        console.error('❌ Failed to save assistant message:', err);
      });
    }

    // Stream response in chunks for faster perceived performance
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        // Send conversation ID first so client can track it
        if (conversationId) {
          controller.enqueue(encoder.encode(`__CONVERSATION_ID__${conversationId}__END_CONVERSATION_ID__\n`));
        }
        
        // Stream in larger chunks (sentences or phrases) for faster delivery
        // while still providing a streaming feel
        const words = finalText.split(' ');
        const chunkSize = 5; // Send 5 words at a time for balance
        
        for (let i = 0; i < words.length; i += chunkSize) {
          const chunkWords = words.slice(i, i + chunkSize);
          const chunk = (i === 0 ? '' : ' ') + chunkWords.join(' ');
          controller.enqueue(encoder.encode(`0:${JSON.stringify(chunk)}\n`));
          // Minimal delay just to give streaming feel without slowing down
          await new Promise(resolve => setTimeout(resolve, 5));
        }
        
        // Send tool results as metadata for canvas
        if (Object.keys(toolResults).length > 0) {
          controller.enqueue(encoder.encode(`\n__TOOL_DATA__${JSON.stringify(toolResults)}__END_TOOL_DATA__\n`));
        }
        
        controller.close();
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error) {
    console.error('Chat API error:', error);
    return new Response(JSON.stringify({ 
      error: 'Error processing request',
      details: error instanceof Error ? error.message : 'Unknown error'
    }), { 
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
}
