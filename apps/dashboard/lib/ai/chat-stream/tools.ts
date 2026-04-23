/**
 * OpenAI tool (function) definitions — single source of truth.
 *
 * All 16 tool schemas are defined here. The orchestrator imports this
 * array and passes it to every OpenAI chat.completions.create() call.
 *
 * Tool names are string constants — never rename them without updating
 * dispatchToolCall() and collectToolResult() in the orchestrator.
 */

import OpenAI from 'openai';

export const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
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
      name: 'getWeeklyOverview',
      description: 'Get a comprehensive weekly recap across ALL tracked habits with totals, averages, minimums, maximums, and per-day breakdowns. Also includes computer time totals and top apps/domains. Use for questions about tracked habits and habit metrics this week, not for reconstructing work/project activity.',
      parameters: {
        type: 'object',
        properties: {
          startDate: { type: 'string', description: 'Optional start date YYYY-MM-DD. If omitted, uses daysBack.' },
          endDate: { type: 'string', description: 'Optional end date YYYY-MM-DD. Defaults to today if omitted.' },
          daysBack: { type: 'number', description: 'Lookback window in days (default 7).' },
          appLimit: { type: 'number', description: 'Top apps/domains rows to return (default 10).' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getDailyOverview',
      description: 'Get a comprehensive daily recap for TODAY across ALL tracked habits as of now. Includes totals/averages/minimums/maximums, per-day rows, and computer time with top apps/domains. Use for questions about tracked habits or habit metrics today, not for "what work did I do today?".',
      parameters: {
        type: 'object',
        properties: {
          appLimit: { type: 'number', description: 'Top apps/domains rows to return (default 10).' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getMonthlyOverview',
      description: 'Get a comprehensive recap for the LAST 30 DAYS across ALL tracked habits. Includes totals/averages/minimums/maximums, per-day rows, and computer time with top apps/domains. Use for questions about tracked habits or habit metrics over the last month, not for reconstructing projects/workstreams.',
      parameters: {
        type: 'object',
        properties: {
          appLimit: { type: 'number', description: 'Top apps/domains rows to return (default 10).' },
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
      name: 'searchContextMemory',
      description: 'Search context-awareness memory built from visible active-window and active-tab text. Use for questions like "What was I working on today?", "What did I do in Cursor?", "What planning work did I do this morning?", or "Find when I read about...".',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural language search query describing what to find in context memory' },
          daysBack: { type: 'number', description: 'How many days back to search (default 7)' },
          limit: { type: 'number', description: 'Maximum results to return (default 10)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'searchScreenRecordings',
      description: 'Compatibility alias for context memory search. Prefer visible-context answers instead of OCR/screen-recording framing.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural language search query describing what to find in context memory' },
          daysBack: { type: 'number', description: 'How many days back to search (default 7)' },
          limit: { type: 'number', description: 'Maximum results to return (default 10)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getComputerTimeSpentBreakdown',
      description: 'Estimate where computer time was spent for a specific question/topic using visible-context memory plus hybrid retrieval, with legacy OCR only as fallback. Use for: "What did I spend time on?", "How much time did I spend on X?", "Where did my time go on my computer?", "What app did I spend the most time in?". Returns structured summary plus table rows.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural language description of what to measure (preserve user wording).' },
          daysBack: { type: 'number', description: 'How many days back to analyze (default 7).' },
          limit: { type: 'number', description: 'Max rows to return in top categories table (default 8, max 50).' },
          groupBy: { type: 'string', description: 'Bucket dimension: "app" (default), "window", or "domain".' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getActivitySummary',
      description: 'Get a rich activity summary with structured workstreams, claim cards, timeline segments, and evidence from context memory. Use for "what did I do today", "give me an activity summary", "recap my day/week", "what happened today". Returns the full story plan with broad_overview intent. Prefer this over searchContextMemory for overview/recap questions.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural language query (e.g., "what did I do today", "activity this week")' },
          daysBack: { type: 'number', description: 'How many days back to analyze (default 1 for today, 7 for week)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getDailyBiometrics',
      description: 'Get biometrics data for a specific day: heart rate summary (average, min, max BPM, source breakdown, lowest/highest windows). Use for "what was my heart rate today", "biometrics", "heart rate summary", "resting heart rate", "how was my heart rate".',
      parameters: {
        type: 'object',
        properties: {
          day: { type: 'string', description: 'Date in YYYY-MM-DD format (default: today)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getScreenTimeSummary',
      description: 'Get iPhone/mobile screen time summary: total active time and top apps by duration. Use for "how much time on my phone", "screen time", "phone usage", "mobile app usage". This is phone screen time, NOT computer time (use getComputerTimeSpentBreakdown for computer).',
      parameters: {
        type: 'object',
        properties: {
          startDate: { type: 'string', description: 'Start date YYYY-MM-DD (default: today)' },
          endDate: { type: 'string', description: 'End date YYYY-MM-DD (default: today)' },
          daysBack: { type: 'number', description: 'Alternative: look back N days (default 1)' },
          appLimit: { type: 'number', description: 'Top apps to return (default 10)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getCalendarEvents',
      description: 'Get scheduled blocks/events from the user calendar for a date range. Use for "what do I have scheduled", "calendar today", "upcoming events", "what\'s on my calendar".',
      parameters: {
        type: 'object',
        properties: {
          startDate: { type: 'string', description: 'Start date YYYY-MM-DD (default: today)' },
          endDate: { type: 'string', description: 'End date YYYY-MM-DD (default: today)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getStreaks',
      description: 'Get current and best-ever streaks for habits (consecutive days logged). Use for questions about streaks, consistency, "how many days in a row", "am I on a streak", "longest streak". Returns current_streak, best_streak, last_logged_date, and total_logged_days per habit.',
      parameters: {
        type: 'object',
        properties: {
          habitName: { type: 'string', description: 'Specific habit name. Leave empty to get streaks for ALL habits.' },
        },
        required: [],
      },
    },
  },
  // ── SMS-specific tools ──────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'logHabit',
      description: 'Write a new habit log entry. ONLY call when the user EXPLICITLY states a value or an action verb in past/present tense referring to themselves — e.g. "30mg caffeine", "ran 3 miles", "I read 30 pages", "just meditated for 10 minutes", "log 8 hours of sleep". NEVER call for QUESTIONS about existing data, even if a habit name is mentioned. Past-tense or interrogative phrasings like "how was my sleep…", "how much did I…", "what did I…", "show me my…", "tell me about my…", "did I…" are ALWAYS read queries — route those to getHabitStats / getDailyBreakdown / getWeeklyOverview instead. If the message is ambiguous between logging and asking, prefer the read tool and do NOT call logHabit. Match the habit name to one of the user\'s existing habits (call listHabits first if unsure).',
      parameters: {
        type: 'object',
        properties: {
          habitName: { type: 'string', description: 'Name of the habit to log, matching one of the user\'s existing habits (case-insensitive fuzzy match is OK)' },
          amount: { type: 'number', description: 'Numeric value to log (e.g. 30 for "30mg", 3 for "3 miles"). Null for boolean/checkbox habits.' },
          note: { type: 'string', description: 'Optional note to attach to the log entry (e.g. the original user message)' },
        },
        required: ['habitName'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'createHabit',
      description: 'Create a new habit for the user to start tracking. Use when the user says things like "start tracking meditation", "add a water intake habit", "I want to track my pushups". Call listHabits first to avoid creating duplicates.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name of the habit (e.g., "meditation", "water intake", "pushups")' },
          category: { type: 'string', description: 'Category for the habit. Choose from: health, fitness, mindfulness, nutrition, productivity, learning, social, sleep, or other.' },
          unitType: { type: 'string', description: 'Optional unit of measurement (e.g., "minutes", "oz", "reps", "pages", "mg"). Omit for simple checkbox/boolean habits.' },
        },
        required: ['name', 'category'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getSmsPreferences',
      description: 'Get the user\'s SMS chatbot preferences (proactive messaging settings, quiet hours, etc.). Use when the user asks about their SMS settings, notifications, or proactive message preferences.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'updateSmsPreferences',
      description: 'Update the user\'s SMS copilot preferences. Use when the user wants to change proactive messaging, daily narratives, interrupt behavior, quiet hours, or notification settings.',
      parameters: {
        type: 'object',
        properties: {
          proactiveEnabled: { type: 'boolean', description: 'Enable/disable proactive messages (end-of-day recap, morning briefing, etc.)' },
          quietHoursStart: { type: 'string', description: 'Start of quiet hours in HH:MM format (e.g. "22:00"). Set to null to remove.' },
          quietHoursEnd: { type: 'string', description: 'End of quiet hours in HH:MM format (e.g. "08:00"). Set to null to remove.' },
          allowedTriggers: { type: 'string', description: 'Comma-separated trigger types to allow. Options: "eod_recap" (end-of-day recap), "morning_briefing", "streak_alert" (celebrate milestones), "missed_habit_nudge" (gentle reminders), "weekly_milestone" (weekly highlights). Example: "eod_recap,streak_alert,missed_habit_nudge"' },
          maxProactivePerDay: { type: 'number', description: 'Maximum proactive messages per day (default 1, max 3)' },
          dailyNarrativeEnabled: { type: 'boolean', description: 'Enable or disable the end-of-day daily narrative SMS.' },
          interruptsEnabled: { type: 'boolean', description: 'Enable or disable high-confidence copilot interrupts.' },
          allowedInterruptKinds: { type: 'string', description: 'Comma-separated interrupt kinds to allow. Current option: "distraction_spiral".' },
          maxInterruptsPerDay: { type: 'number', description: 'Maximum copilot interrupts per day (default 2, max 3).' },
          minHoursBetweenInterrupts: { type: 'number', description: 'Minimum hours between copilot interrupts (default 4, min 1, max 24).' },
        },
        required: [],
      },
    },
  },
];
