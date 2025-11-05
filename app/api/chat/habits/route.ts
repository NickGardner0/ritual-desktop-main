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

    const { messages, userId }: { messages: Array<{role: string, content: string}>, userId: string } = await req.json();
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
    const getLocalDate = () => {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };
    const today = getLocalDate();
    
    const systemPrompt = `You are a helpful habit tracking assistant. Your job is to parse natural language descriptions of activities and extract structured habit data.

When a user describes an activity, analyze it and respond in this format:

For trackable activities, respond with JSON:
{
  "success": true,
  "habitName": "exact habit name to match",
  "activity": "specific activity description",
  "amount": number_if_quantity_based,
  "duration": number_in_minutes_if_time_based,
  "unit": "Miles|Pages|Minutes|Sessions|Hours|Reps|Sets|Glasses",
  "date": "${today}",
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

${habitsContext}

Examples with user's habits:
- "I just worked out for 1 hour" → {"success": true, "habitName": "Morning Workout", "activity": "worked out", "duration": 60, "unit": "Minutes", "date": "${today}"}
- "Read 25 pages" → {"success": true, "habitName": "Daily Reading", "activity": "reading", "amount": 25, "unit": "Pages", "date": "${today}"}
- "Ran 3 miles this morning" → {"success": true, "habitName": "Morning Run", "activity": "running", "amount": 3, "unit": "Miles", "date": "${today}"}

Always use today's date (${today}) and be encouraging in your responses.`;

    // Define the schema for structured habit logging
    const habitLogSchema = z.object({
      success: z.boolean(),
      habitName: z.string().optional(),
      activity: z.string().optional(),
      amount: z.number().nullable().optional(),
      duration: z.number().nullable().optional(), // in minutes
      unit: z.enum(['Miles', 'Pages', 'Minutes', 'Sessions', 'Hours', 'Reps', 'Sets', 'Glasses']).optional(),
      date: z.string().optional(),
      notes: z.string().optional(),
      message: z.string().optional() // For when success is false
    });

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
      await processHabitLog(habitData, effectiveUserId, effectiveToken);
      responseMessage = `Great! I've logged your ${habitData.activity} activity. ${habitData.amount ? `${habitData.amount} ${habitData.unit}` : `${habitData.duration} minutes`} has been added to your ${habitData.habitName} habit.`;
      
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

async function processHabitLog(habitData: any, userId: string, token: string | null) {
  try {
    logger.info('🔍 Processing habit log via Python backend:', { 
      habitData, 
      // Don't log userId in production
      userId: process.env.NODE_ENV === 'development' ? userId : '[REDACTED]', 
      hasToken: !!token 
    });
    
    // Find the habit by exact name match first from Python backend
    let habits = [];
    
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
    const today = getLocalDate();
    const currentTimestamp = new Date().toISOString();

    let finalAmount = habitData.amount || null;
    let finalDuration = habitData.duration || null; // AI returns in minutes, will convert to seconds below
    let finalNotes = habitData.notes || `Logged via AI: ${habitData.activity}`;

    // Create habit log data matching Python backend's HabitLogCreate model
    // Backend expects duration in SECONDS, but AI returns it in MINUTES
    const logData = {
      date: today,
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
