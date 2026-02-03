import { NextRequest } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const PYTHON_API_BASE = process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';

// ====================
// VOICE MODE POST-PROCESSING (Phase 4A)
// ====================

function formatVoiceResponse(text: string): string {
  if (!text) return text;
  
  const MAX_CHARS = 650;
  const MAX_BULLETS = 3;
  
  let result = text;
  
  // Remove markdown tables (replace with simple text)
  // Note: Using RegExp constructor to avoid Tailwind extracting the pattern as a class
  result = result.replace(new RegExp('\\|[^\\n]+\\|', 'g'), '');
  result = result.replace(new RegExp('[\\-:]+\\|[\\-:|]+', 'g'), '');
  
  // Limit bullet lists to MAX_BULLETS items
  const bulletPattern = /^[\s]*[-*•]\s.+$/gm;
  const bullets = result.match(bulletPattern) || [];
  if (bullets.length > MAX_BULLETS) {
    // Keep only first MAX_BULLETS bullets
    let bulletCount = 0;
    result = result.replace(bulletPattern, (match) => {
      bulletCount++;
      return bulletCount <= MAX_BULLETS ? match : '';
    });
  }
  
  // Remove excessive newlines
  result = result.replace(/\n{3,}/g, '\n\n');
  
  // Trim to max characters (but don't cut mid-sentence if possible)
  if (result.length > MAX_CHARS) {
    // Try to cut at a sentence boundary
    const truncated = result.substring(0, MAX_CHARS);
    const lastSentenceEnd = Math.max(
      truncated.lastIndexOf('. '),
      truncated.lastIndexOf('? '),
      truncated.lastIndexOf('! ')
    );
    
    if (lastSentenceEnd > MAX_CHARS * 0.5) {
      result = truncated.substring(0, lastSentenceEnd + 1);
    } else {
      // Check if we're cutting important numeric content
      const hasNumbers = /\d+(\.\d+)?%?/.test(truncated.substring(MAX_CHARS - 100));
      if (hasNumbers) {
        console.warn('⚠️ Voice post-processing: skipping trim to preserve numeric content');
      } else {
        result = truncated + '...';
      }
    }
  }
  
  // Ensure response ends with a question (add generic one if missing)
  const trimmedResult = result.trim();
  if (!trimmedResult.endsWith('?')) {
    // Check if there's a question somewhere near the end
    const lastQuestionMark = trimmedResult.lastIndexOf('?');
    if (lastQuestionMark > trimmedResult.length - 100) {
      // There's a question near the end, just trim after it
      result = trimmedResult.substring(0, lastQuestionMark + 1);
    } else {
      // Add a generic follow-up question
      result = trimmedResult + '\n\nWant me to break this down further?';
    }
  }
  
  return result.trim();
}

// Generate reply chips based on tool results
function generateReplyChips(toolResults: Record<string, unknown>): string[] {
  const chips: string[] = [];
  
  // Based on trends data
  if (toolResults.trends) {
    const trends = toolResults.trends as { trends?: Array<{ habit_name: string }> };
    if (trends.trends && trends.trends.length > 0) {
      const topHabit = trends.trends[0].habit_name;
      chips.push(`Show anomalies for ${topHabit}`.substring(0, 32));
      chips.push('Last 90 days');
    }
  }
  
  // Based on anomalies data
  if (toolResults.anomalies) {
    chips.push('Show trends');
    chips.push('Last 7 days');
  }
  
  // Based on stats/breakdown
  if (toolResults.stats || toolResults.dailyBreakdown) {
    chips.push('Last 7 days');
    chips.push('Last 30 days');
    chips.push('Show anomalies');
  }
  
  // Fallback generic chips
  if (chips.length === 0) {
    chips.push('Last 7 days');
    chips.push('Last 30 days');
    chips.push('Show insights');
  }
  
  // Dedupe and limit to 3
  return [...new Set(chips)].slice(0, 3);
}

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
  {
    type: 'function',
    function: {
      name: 'getHabitTrends',
      description: 'Compare habit performance between current period and previous period. Returns direction (up/down/flat), percent change, and confidence level. Use for questions about "what changed", "insights", "overview", "how am I doing", "progress".',
      parameters: {
        type: 'object',
        properties: {
          habitName: { type: 'string', description: 'Specific habit name. Leave empty to get trends for ALL habits.' },
          windowDays: { type: 'number', description: 'Period length in days (default 30). Compares last N days vs previous N days.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getHabitAnomalies',
      description: 'Identify unusual days (spikes or drops) for a habit using statistical analysis. Use for questions about "weird days", "spikes", "drops", "unusual", "outliers", "anomalies".',
      parameters: {
        type: 'object',
        properties: {
          habitName: { type: 'string', description: 'Habit name to analyze for anomalies' },
          startDate: { type: 'string', description: 'Start date in YYYY-MM-DD format' },
          endDate: { type: 'string', description: 'End date in YYYY-MM-DD format' },
          daysBack: { type: 'number', description: 'Alternative to dates: look back N days (default 30)' },
          zThreshold: { type: 'number', description: 'Z-score threshold for anomaly detection (default 2.0, higher = fewer anomalies)' },
          maxResults: { type: 'number', description: 'Maximum anomalies to return (default 5)' },
        },
        required: ['habitName'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'searchScreenRecordings',
      description: 'Search through screen recordings and computer activity using AI-powered semantic search. Use for questions like "What was I working on yesterday?", "When was I looking at...", "Find when I was reading about...", "What apps did I use...", "Show me what I was doing when...".',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural language search query describing what to find in screen recordings' },
          daysBack: { type: 'number', description: 'How many days back to search (default 7)' },
          limit: { type: 'number', description: 'Maximum results to return (default 10)' },
        },
        required: ['query'],
      },
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
}) {
  console.log('📊 getHabitStats called:', params);
  
  try {
    const result = await fetchPythonApi('/api/analytics/stats', token, {
      habit_name: params.habitName || '',
      start_date: params.startDate || '',
      end_date: params.endDate || '',
      days_back: params.daysBack ?? 30,
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
}, timezone?: string) {
  console.log('📊 getDailyBreakdown called:', params, 'timezone:', timezone);
  
  try {
    const result = await fetchPythonApi('/api/analytics/daily-breakdown', token, {
      habit_name: params.habitName,
      start_date: params.startDate || '',
      end_date: params.endDate || '',
      days_back: params.daysBack ?? 30,
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
}) {
  console.log('📊 getCorrelation called:', params);
  
  try {
    const result = await fetchPythonApi('/api/analytics/correlation', token, {
      habit1_name: params.habit1Name,
      habit2_name: params.habit2Name,
      days_back: params.daysBack ?? 30,
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

async function executeGetHabitTrends(token: string, params: {
  habitName?: string;
  windowDays?: number;
}) {
  console.log('📊 getHabitTrends called:', params);
  
  try {
    const result = await fetchPythonApi('/api/analytics/trends', token, {
      habit_name: params.habitName || '',
      window_days: params.windowDays ?? 30,
    });
    
    if (!result.success) {
      return JSON.stringify({
        error: result.error,
        available_habits: result.available_habits
      });
    }
    
    return JSON.stringify(result);
  } catch (error) {
    console.error('❌ getHabitTrends error:', error);
    return JSON.stringify({ error: String(error) });
  }
}

async function executeGetHabitAnomalies(token: string, params: {
  habitName: string;
  startDate?: string;
  endDate?: string;
  daysBack?: number;
  zThreshold?: number;
  maxResults?: number;
}) {
  console.log('📊 getHabitAnomalies called:', params);
  
  try {
    const result = await fetchPythonApi('/api/analytics/anomalies', token, {
      habit_name: params.habitName,
      start_date: params.startDate || '',
      end_date: params.endDate || '',
      days_back: params.daysBack ?? 30,
      z_threshold: params.zThreshold ?? 2.0,
      max_results: params.maxResults ?? 5,
    });
    
    if (!result.success) {
      return JSON.stringify({
        error: result.error,
        available_habits: result.available_habits
      });
    }
    
    return JSON.stringify(result);
  } catch (error) {
    console.error('❌ getHabitAnomalies error:', error);
    return JSON.stringify({ error: String(error) });
  }
}

// Screen recording search types
interface ScreenRecordingResult {
  frame_id: number;
  timestamp: number;
  app_bundle_id: string;
  app_name: string;
  window_title: string | null;
  ocr_text: string;
  relevance_score: number;
}

function executeSearchScreenRecordings(
  params: { query: string; daysBack?: number; limit?: number },
  screenRecordingResults: ScreenRecordingResult[] | null | undefined
): string {
  console.log('🖥️ searchScreenRecordings called:', params);
  console.log('🖥️ screenRecordingResults count:', screenRecordingResults?.length ?? 0);
  
  // Distinguish between "service not available" (null/undefined) and "no results" (empty array)
  if (screenRecordingResults === null || screenRecordingResults === undefined) {
    return JSON.stringify({
      success: false,
      error: 'Screen recording search is not available. The embedding service may not be initialized.',
      hint: 'Enable AI Search in the Computer Activity panel to use this feature.',
    });
  }
  
  // Service is available but no results found
  if (screenRecordingResults.length === 0) {
    return JSON.stringify({
      success: true,
      query: params.query,
      days_searched: params.daysBack ?? 7,
      result_count: 0,
      results: [],
      message: `No screen recordings found matching "${params.query}". Try different keywords or check if screen recording is enabled.`,
    });
  }
  
  // Don't apply additional time filter here - the frontend already handled time filtering
  // and fell back to all results if needed. Just use what we received.
  const limit = params.limit ?? 10;
  const filteredResults = screenRecordingResults.slice(0, limit);
  
  // Calculate the time range from the actual results
  const timestamps = filteredResults.map(r => r.timestamp);
  const oldestTimestamp = Math.min(...timestamps);
  const newestTimestamp = Math.max(...timestamps);
  const daysCovered = Math.ceil((newestTimestamp - oldestTimestamp) / (24 * 60 * 60 * 1000)) || 1;
  
  // Format results for the AI
  const formattedResults = filteredResults.map(r => ({
    timestamp: new Date(r.timestamp).toISOString(),
    app: r.app_name,
    window: r.window_title || 'Unknown',
    content_preview: r.ocr_text.substring(0, 300) + (r.ocr_text.length > 300 ? '...' : ''),
    relevance: Math.round(r.relevance_score * 100) + '%',
  }));
  
  console.log('🖥️ Returning', formattedResults.length, 'formatted results to AI');
  
  return JSON.stringify({
    success: true,
    query: params.query,
    days_searched: daysCovered,
    result_count: formattedResults.length,
    results: formattedResults,
  });
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

    const { messages, timezone, conversationId: providedConversationId, responseMode = 'text', screenRecordingResults } = await req.json();
    
    // Get or create conversation ID for persistence
    let conversationId = providedConversationId;
    if (!conversationId) {
      conversationId = await createConversation(token);
      console.log('📝 New conversation created:', conversationId);
    }
    
    // Determine if we're in voice mode
    const isVoiceMode = responseMode === 'voice';
    console.log(`🎤 Response mode: ${responseMode}`);
    
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
    // Use local date components, NOT toISOString() which converts to UTC
    const year = now.getFullYear();
    const month = now.getMonth() + 1; // 1-indexed
    const day = now.getDate();
    const today = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const currentYear = year;
    const currentMonth = month;

    // System prompt
    const systemPrompt = `You are a helpful habit tracking assistant for Ritual.
You provide accurate insights about the user's habit data using the analytics tools.

Current date: ${today}
Current year: ${currentYear}
Timezone: ${timezone || 'UTC'}

IMPORTANT: All statistics come from the Python backend (single source of truth).
- "average" means total divided by DAYS WITH DATA (not per entry)
- Always use tools to get real data - never make up numbers

=== TOOL ROUTING GUIDE ===

FOR OVERVIEW/INSIGHTS QUESTIONS ("what changed", "insights", "how am I doing", "overview", "progress", "lately"):
→ Use getHabitTrends (leave habitName empty to get ALL habits)
→ Summarize top 3 improving and top 3 declining habits
→ Include percent change and confidence level in your response
→ If confidence is "low", mention "limited data"

FOR SPECIFIC HABIT QUESTIONS ("How's my sleep?", "Tell me about my workouts"):
→ Call BOTH getHabitStats AND getDailyBreakdown with same date range
→ The user sees a side panel with daily breakdown - it REQUIRES getDailyBreakdown data

FOR ANOMALY/OUTLIER QUESTIONS ("weird days", "spikes", "drops", "unusual", "outliers"):
→ Use getHabitAnomalies for the specific habit mentioned
→ Reference specific dates and values in your response
→ If a trend shows extreme change with high confidence, suggest checking anomalies

FOR RELATIONSHIP QUESTIONS ("connection between X and Y", "correlation"):
→ Use getCorrelation
→ State the coefficient and what it means

FOR SCREEN RECORDING / COMPUTER ACTIVITY QUESTIONS ("what was I working on", "when did I look at", "find when I was", "what apps did I use", "show me what I was doing"):
→ Use searchScreenRecordings with a natural language query
→ The search uses AI to find relevant moments from screen recordings
→ Summarize what was found: apps used, content viewed, approximate times
→ If results include OCR text (content from screen), mention key details
→ Time is returned as ISO timestamp - convert to readable format
→ If no results, suggest the user may need to enable AI Search in settings

=== RESPONSE FORMAT ===
1. Brief intro (1-2 sentences)
2. Key findings with **bold** numbers
3. For trends: mention direction (↑/↓) and percent change
4. For anomalies: cite specific dates
5. For low confidence data: say "Note: limited data for this period"
6. End with 1-2 actionable insights

Keep it concise - the user sees detailed data in a side panel.

=== DATE HANDLING ===
- Use current year (${currentYear}) unless explicitly specified
- "this month" → startDate = first of current month, endDate = today
- "last week" → daysBack = 7
- Month names without year → use ${currentYear}

=== CONSTRAINTS ===
- NEVER list every single day's data - user sees that in side panel
- NEVER make up numbers - all data comes from tools
- Max 2 tool call rounds for performance
- Be encouraging and supportive!`;

    // Voice-style prompt addition (Phase 4A)
    const voiceStylePrompt = `

=== VOICE STYLE MODE (ACTIVE) ===
You are now in conversational voice mode. Respond as if speaking aloud.

RULES:
1. BE BRIEF: 2-6 short sentences max. No long paragraphs.
2. SPEAK NATURALLY: Short sentences, conversational tone. No markdown tables. No "Here are 10 things..."
3. END WITH ONE QUESTION: Always end with a simple follow-up question offering a choice.
   Examples: "Want the last 7 days or last 30?" / "Should I check for anomalies?" / "Compare with another habit?"
4. NUMBERS FROM TOOLS ONLY: Same grounding rules. If confidence is low, say so in one sentence.
5. NO UI REFERENCES: Don't say "in the canvas panel" - instead say "I can show a breakdown if you want."

FORMAT:
- Summary (1-2 sentences with key number)
- Key insight (1 sentence)
- Follow-up question (ends with ?)

Keep total response under 500 characters when possible.`;

    // Build the full system prompt
    const fullSystemPrompt = isVoiceMode ? systemPrompt + voiceStylePrompt : systemPrompt;

    // Build messages for OpenAI
    const apiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: fullSystemPrompt },
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
      trends?: any;  // Phase 3: Habit trends data
      anomalies?: any;  // Phase 3: Anomaly detection data
      screenRecordings?: any;  // Screen recording search results
      allStats?: any[];  // Accumulate all stats calls
      allBreakdowns?: { habit: any; data: any[] }[];  // Accumulate all breakdown calls
      suggested_followups?: string[];  // Phase 3: Follow-up suggestions
      reply_chips?: string[];  // Phase 4A: Voice mode reply chips
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
              result = await executeGetHabitStats(token, args);
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
              result = await executeGetDailyBreakdown(token, args, timezone);
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
              result = await executeGetCorrelation(token, args);
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
            case 'getHabitTrends':
              result = await executeGetHabitTrends(token, args);
              // Store trends for canvas
              try {
                const parsed = JSON.parse(result);
                if (parsed.success) {
                  toolResults.trends = parsed;
                  // Capture suggested follow-ups
                  if (parsed.suggested_followups) {
                    toolResults.suggested_followups = parsed.suggested_followups;
                  }
                }
              } catch {}
              break;
            case 'getHabitAnomalies':
              result = await executeGetHabitAnomalies(token, args);
              // Store anomalies for canvas
              try {
                const parsed = JSON.parse(result);
                if (parsed.success) {
                  toolResults.anomalies = parsed;
                  // Capture suggested follow-ups (merge with existing)
                  if (parsed.suggested_followups) {
                    toolResults.suggested_followups = [
                      ...(toolResults.suggested_followups || []),
                      ...parsed.suggested_followups
                    ].slice(0, 3);  // Max 3 suggestions
                  }
                }
              } catch {}
              break;
            case 'searchScreenRecordings':
              result = executeSearchScreenRecordings(args, screenRecordingResults);
              // Store screen recording results for canvas
              try {
                const parsed = JSON.parse(result);
                if (parsed.success && parsed.results) {
                  toolResults.screenRecordings = parsed;
                }
              } catch {}
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

    let finalText = assistantMessage.content || 'I was unable to process your request.';
    
    // Apply voice mode post-processing (Phase 4A)
    if (isVoiceMode) {
      console.log('🎤 Applying voice mode post-processing');
      finalText = formatVoiceResponse(finalText);
      
      // Generate reply chips for voice mode
      const replyChips = generateReplyChips(toolResults);
      toolResults.reply_chips = replyChips;
      console.log('💬 Generated reply chips:', replyChips);
    }
    
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