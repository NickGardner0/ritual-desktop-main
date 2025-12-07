import { generateObject } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { NextRequest } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { logger } from '@/lib/logger';

// Python backend API configuration
const PYTHON_API_BASE = process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';

export async function POST(req: NextRequest) {
  try {
    // Try to get token from Authorization header first (sent by frontend)
    const authHeader = req.headers.get('Authorization');
    let token: string | null = null;
    let clerkUserId: string | null = null;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7); // Remove 'Bearer ' prefix
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

    const { messages, userId, selectedDate }: { messages: Array<{role: string, content: string}>, userId: string, selectedDate?: string } = await req.json();
    const lastMessage = messages[messages.length - 1]?.content;
    
    // Use userId from request if Clerk auth failed
    const effectiveUserId = clerkUserId || userId;
    const effectiveToken = token;
    
    logger.info('🔍 API /api/chat/habits called:', {
      hasClerkUserId: !!clerkUserId,
      hasToken: !!token,
      // Don't log userId in production
      effectiveUserId: process.env.NODE_ENV === 'development' ? effectiveUserId : '[REDACTED]',
      messageLength: messages.length
    });

    logger.info('🔐 Fetching habits from Python backend with auth');

    // Fetch user's current habits from Python backend with auth
    let userHabits: any[] = [];
    let habitsError = null;
    
    try {
      const headers: Record<string, string> = {};
      if (effectiveToken) {
        headers['Authorization'] = `Bearer ${effectiveToken}`;
      }
      
      const habitsResponse = await fetch(`${PYTHON_API_BASE}/api/habits`, {
        headers
      });
      if (habitsResponse.ok) {
        userHabits = await habitsResponse.json();
        logger.info('✅ Fetched habits from Python backend:', userHabits.length);
      } else {
        logger.warn(`⚠️ Failed to fetch habits: ${habitsResponse.status} (continuing anyway)`);
      }
    } catch (error) {
      logger.error('❌ Error fetching habits from Python backend:', error);
      habitsError = error;
    }

    const habitsList: any[] = userHabits || [];
    const habitsContext = habitsList.length > 0 
      ? `\n\nUSER'S CURRENT HABITS:\n${habitsList.map(h => `- "${h.name}" (Category: ${h.category}${h.unit_type ? `, Unit: ${h.unit_type}` : ''})`).join('\n')}\n\nIMPORTANT: Always try to match user input to one of these existing habits first. Use the EXACT habit name from this list.`
      : '\n\nNote: User has no habits set up yet. You may suggest creating new habits if appropriate.';

    // Get local date (not UTC) to avoid timezone issues
    const getLocalDate = (daysOffset: number = 0) => {
      const now = new Date();
      now.setDate(now.getDate() + daysOffset);
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };
    
    // Calculate reference dates for the AI to use
    const today = selectedDate || getLocalDate(0);
    const yesterday = getLocalDate(-1);
    const twoDaysAgo = getLocalDate(-2);
    const threeDaysAgo = getLocalDate(-3);
    const fourDaysAgo = getLocalDate(-4);
    const fiveDaysAgo = getLocalDate(-5);
    const sixDaysAgo = getLocalDate(-6);
    const sevenDaysAgo = getLocalDate(-7);
    
    // Get day of week names for the past week
    const getDayName = (daysOffset: number) => {
      const date = new Date();
      date.setDate(date.getDate() + daysOffset);
      return date.toLocaleDateString('en-US', { weekday: 'long' });
    };
    
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;
    
    const systemPrompt = `You are a helpful habit tracking assistant. Your job is to parse natural language descriptions of activities and extract structured habit data.

CRITICAL: You MUST parse dates from user input. If no date is mentioned, use today's date.

REFERENCE DATES (use these exact values):
- "today" = ${today}
- "yesterday" = ${yesterday}
- "2 days ago" or "two days ago" = ${twoDaysAgo}
- "3 days ago" or "three days ago" = ${threeDaysAgo}
- "4 days ago" or "four days ago" = ${fourDaysAgo}
- "5 days ago" or "five days ago" = ${fiveDaysAgo}
- "6 days ago" or "six days ago" = ${sixDaysAgo}
- "a week ago" or "7 days ago" = ${sevenDaysAgo}
- "last ${getDayName(-1)}" = ${yesterday}
- "last ${getDayName(-2)}" = ${twoDaysAgo}
- "last ${getDayName(-3)}" = ${threeDaysAgo}
- "last ${getDayName(-4)}" = ${fourDaysAgo}
- "last ${getDayName(-5)}" = ${fiveDaysAgo}
- "last ${getDayName(-6)}" = ${sixDaysAgo}
- "last ${getDayName(-7)}" = ${sevenDaysAgo}
- "on ${getDayName(-1)}" = ${yesterday}
- "on ${getDayName(-2)}" = ${twoDaysAgo}
- "on ${getDayName(-3)}" = ${threeDaysAgo}
- "on ${getDayName(-4)}" = ${fourDaysAgo}
- "on ${getDayName(-5)}" = ${fiveDaysAgo}
- "on ${getDayName(-6)}" = ${sixDaysAgo}
- "on ${getDayName(-7)}" = ${sevenDaysAgo}

SPECIFIC DATE PARSING:
- For dates like "December 3rd", "Dec 3", "12/3", use format: ${currentYear}-12-03
- For dates like "November 28th", "Nov 28", "11/28", use format: ${currentYear}-11-28
- Always use the current year (${currentYear}) unless a different year is specified
- Format all dates as YYYY-MM-DD

When a user describes an activity, analyze it and respond in this format:

For trackable activities, respond with JSON:
{
  "success": true,
  "habitName": "exact habit name to match",
  "activity": "specific activity description",
  "amount": number_if_quantity_based,
  "duration": number_in_minutes_if_time_based,
  "unit": "Count|Minutes|Hours|Miles|Kilometers|Steps|Calories|Pages|Milligrams|Grams|Kilograms|Pounds|Ounces|Liters|Cups|Glasses|Reps|Sets|Percentage|Points|Sessions|Chapters|Episodes|Articles|Words|Lines|Tasks|Projects|Emails|Calls|Meetings|Breaks",
  "date": "YYYY-MM-DD (parsed from user input or ${today} if not specified)",
  "notes": "additional context from user input"
}

For non-trackable activities, respond with:
{
  "success": false,
  "message": "helpful response asking for clarification"
}

MATCHING RULES:
1. ALWAYS prioritize matching to the user's existing habits listed below
2. Use fuzzy matching - "worked out" should match "Morning Workout" 
3. "ran" or "running" should match habits with "Run" or "Running"
4. "read" or "reading" should match habits with "Read" or "Reading"
5. Look for key words in habit names and match partial descriptions
6. If user says "I just worked out for 1 hour" and they have "Morning Workout", use "Morning Workout"

QUANTITY EXTRACTION:
- Extract numbers and convert to appropriate units
- "1 hour" = 60 minutes duration
- "30 mins" = 30 minutes duration  
- "2 miles" = 2 amount with unit "Miles"
- "50 pages" = 50 amount with unit "Pages"
- "10 reps" = 10 amount with unit "Reps"
- "3 sets" = 3 amount with unit "Sets"
- "8 glasses" = 8 amount with unit "Glasses"
- "400mg" or "400 milligrams" = 400 amount with unit "Milligrams"
- "50g" or "50 grams" = 50 amount with unit "Grams"
- "2kg" or "2 kilograms" = 2 amount with unit "Kilograms"
- "5km" or "5 kilometers" = 5 amount with unit "Kilometers"
- "10000 steps" = 10000 amount with unit "Steps"
- "250 calories" = 250 amount with unit "Calories"

${habitsContext}

DATE PARSING EXAMPLES:
- "I walked 7.5 miles yesterday" → {"success": true, "habitName": "Daily Walk", "activity": "walking", "amount": 7.5, "unit": "Miles", "date": "${yesterday}"}
- "Ran 3 miles 2 days ago" → {"success": true, "habitName": "Morning Run", "activity": "running", "amount": 3, "unit": "Miles", "date": "${twoDaysAgo}"}
- "Read 50 pages on Monday" → use the correct date for last Monday from the reference dates above
- "Worked out for 1 hour on December 3rd" → {"success": true, "habitName": "Morning Workout", "activity": "worked out", "duration": 60, "unit": "Minutes", "date": "${currentYear}-12-03"}
- "Meditated 20 minutes last Friday" → use the correct date for last Friday from the reference dates above

Examples WITHOUT date (use today):
- "I just worked out for 1 hour" → {"success": true, "habitName": "Morning Workout", "activity": "worked out", "duration": 60, "unit": "Minutes", "date": "${today}"}
- "Read 25 pages" → {"success": true, "habitName": "Daily Reading", "activity": "reading", "amount": 25, "unit": "Pages", "date": "${today}"}
- "Ran 3 miles this morning" → {"success": true, "habitName": "Morning Run", "activity": "running", "amount": 3, "unit": "Miles", "date": "${today}"}

IMPORTANT: Parse dates carefully! Users often log activities they forgot to record. Always extract the date from their message.
Be encouraging in your responses!`;

    // Define the schema for structured habit logging
    const habitLogSchema = z.object({
      success: z.boolean(),
      habitName: z.string().optional(),
      activity: z.string().optional(),
      amount: z.number().nullable().optional(),
      duration: z.number().nullable().optional(), // in minutes
      unit: z.enum([
        'Count', 'Minutes', 'Hours', 'Miles', 'Kilometers', 'Steps', 'Calories', 'Pages',
        'Milligrams', 'Grams', 'Kilograms', 'Pounds', 'Ounces', 'Liters', 'Cups', 'Glasses',
        'Reps', 'Sets', 'Percentage', 'Points', 'Sessions', 'Chapters', 'Episodes', 'Articles',
        'Words', 'Lines', 'Tasks', 'Projects', 'Emails', 'Calls', 'Meetings', 'Breaks'
      ]).optional(),
      date: z.string().optional(),
      notes: z.string().optional(),
      message: z.string().optional() // For when success is false
    });

    // @ts-expect-error - AI SDK generateObject has deep type inference that causes TS errors
    const result = await generateObject({
      model: openai('gpt-4o-mini'),
      system: systemPrompt,
      messages: messages,
      schema: habitLogSchema,
      temperature: 0.3,
    });

    const habitData = result.object;
    let responseMessage = habitData.message || 'I processed your request.';

    // Process habit logging if successful
    if (habitData?.success) {
      // Pass already-fetched habits to avoid duplicate fetch
      await processHabitLog(habitData, effectiveUserId, effectiveToken, userHabits, selectedDate);
      
      // Format the date for display
      const logDate = habitData.date || selectedDate || today;
      const isToday = logDate === today;
      const isYesterday = logDate === yesterday;
      
      let dateDisplay = '';
      if (!isToday) {
        if (isYesterday) {
          dateDisplay = ' for yesterday';
        } else {
          // Format the date nicely (e.g., "December 3rd")
          const dateObj = new Date(logDate + 'T12:00:00');
          const options: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric' };
          dateDisplay = ` for ${dateObj.toLocaleDateString('en-US', options)}`;
        }
      }
      
      const amountDisplay = habitData.amount 
        ? `${habitData.amount} ${habitData.unit}` 
        : `${habitData.duration} minutes`;
      
      responseMessage = `Great! I've logged your ${habitData.activity} activity${dateDisplay}. ${amountDisplay} has been added to your ${habitData.habitName} habit.`;
      
      return new Response(JSON.stringify({ 
        message: responseMessage,
        success: true,
        habitData: habitData
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ message: responseMessage }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    logger.error('Error in chat API:', error);
    return new Response('Error processing request', { status: 500 });
  }
}

async function processHabitLog(habitData: any, userId: string, token: string | null, userHabits: any[] = [], selectedDate?: string) {
  try {
    logger.info('🔍 Processing habit log via Python backend:', { 
      habitData, 
      // Don't log userId in production
      userId: process.env.NODE_ENV === 'development' ? userId : '[REDACTED]', 
      hasToken: !!token 
    });
    
    // Use already-fetched habits if available, otherwise fetch
    let habits = [];
    
    if (userHabits && userHabits.length > 0) {
      // Use habits already fetched - much faster!
      habits = userHabits.filter((h: any) => h.name === habitData.habitName);
      
      // If no exact match, try partial match
      if (habits.length === 0) {
        habits = userHabits.filter((h: any) => 
          h.name.toLowerCase().includes(habitData.habitName.toLowerCase())
        );
      }
    } else {
      // Fallback: fetch habits if not provided (shouldn't happen in normal flow)
    try {
      const headers: Record<string, string> = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      
      const habitsResponse = await fetch(`${PYTHON_API_BASE}/api/habits`, {
        headers
      });
      if (habitsResponse.ok) {
        const allHabits = await habitsResponse.json();
        // Find exact match first
        habits = allHabits.filter((h: any) => h.name === habitData.habitName);
        
        // If no exact match, try partial match
        if (habits.length === 0) {
          habits = allHabits.filter((h: any) => 
            h.name.toLowerCase().includes(habitData.habitName.toLowerCase())
          );
        }
      } else {
        throw new Error(`Failed to fetch habits: ${habitsResponse.status}`);
      }
    } catch (error) {
      logger.error('❌ Error fetching habits from Python backend:', error);
      return;
      }
    }

    if (!habits || habits.length === 0) {
      logger.error('❌ No matching habit found for:', habitData.habitName);
      return;
    }

    const habit = habits[0];
    logger.info('✅ Found matching habit:', { id: habit.id, name: habit.name });
    
    // Get local date (not UTC) to avoid timezone issues
    const getLocalDate = () => {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };
    
    // IMPORTANT: Use the AI-parsed date first (from habitData.date), 
    // then fall back to selectedDate (from date picker), then to today
    // This allows users to log habits for past dates like "yesterday" or "2 days ago"
    const logDate = habitData.date || selectedDate || getLocalDate();
    logger.info('📅 Using log date:', { 
      aiParsedDate: habitData.date, 
      selectedDate, 
      finalLogDate: logDate 
    });
    const currentTimestamp = new Date().toISOString();

    let finalAmount = habitData.amount || null;
    let finalDuration = habitData.duration || null; // AI returns in minutes, will convert to seconds below
    let finalNotes = habitData.notes || `Logged via AI: ${habitData.activity}`;

    // Create habit log data matching Python backend's HabitLogCreate model
    // Backend expects duration in SECONDS, but AI returns it in MINUTES
    const logData = {
      date: logDate, // Use the date from date picker or today
      duration: finalDuration ? Math.round(finalDuration * 60) : null, // Convert minutes to seconds
      amount: finalAmount,
      unit: habitData.unit || habit.unit_type || '',
      status: 'completed',
      notes: finalNotes,
      completed_at: currentTimestamp
    };

    logger.info('🔍 Sending log data to Python backend');

    // Send to Python backend using correct endpoint: /api/habits/{habit_id}/logs
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      
      const logResponse = await fetch(`${PYTHON_API_BASE}/api/habits/${habit.id}/logs`, {
        method: 'POST',
        headers,
        body: JSON.stringify(logData)
      });

      if (logResponse.ok) {
        const result = await logResponse.json();
        logger.info('✅ Habit log created in Python backend');
        logger.info('📊 Data automatically synced to Tinybird via backend');
      } else {
        const errorText = await logResponse.text();
        logger.error('❌ Failed to create habit log:', errorText);
      }
    } catch (error) {
      logger.error('❌ Error sending log to Python backend:', error);
    }
    
  } catch (error) {
    logger.error('❌ Error in processHabitLog:', error);
    throw error;
  }
}
