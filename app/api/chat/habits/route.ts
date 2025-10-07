import { generateObject } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Database } from '@/types/supabase';

// Initialize Supabase client with service role for server-side operations
const supabase = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const { messages, userId }: { messages: Array<{role: string, content: string}>, userId: string } = await req.json();
    const lastMessage = messages[messages.length - 1]?.content;

    // Using service role key - no session authentication needed
    console.log('🔐 Using service role for database operations');

    // Fetch user's current habits for better context
    const { data: userHabits, error: habitsError } = await supabase
      .from('habits')
      .select('id, name, category, unit_type')
      .eq('user_id', userId);

    if (habitsError) {
      console.error('Error fetching user habits:', habitsError);
    }

    const habitsList = userHabits || [];
    const habitsContext = habitsList.length > 0 
      ? `\n\nUSER'S CURRENT HABITS:\n${habitsList.map(h => `- "${h.name}" (Category: ${h.category}${h.unit_type ? `, Unit: ${h.unit_type}` : ''})`).join('\n')}\n\nIMPORTANT: Always try to match user input to one of these existing habits first. Use the EXACT habit name from this list.`
      : '\n\nNote: User has no habits set up yet. You may suggest creating new habits if appropriate.';

    const today = new Date().toISOString().split('T')[0];
    
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
      amount: z.number().optional(),
      duration: z.number().optional(), // in minutes
      unit: z.enum(['Miles', 'Pages', 'Minutes', 'Sessions', 'Hours', 'Reps', 'Sets', 'Glasses']).optional(),
      date: z.string().optional(),
      notes: z.string().optional(),
      message: z.string().optional() // For when success is false
    });

    const result = await generateObject({
      model: openai('gpt-4o-mini'), // Use gpt-4o-mini which supports structured outputs
      system: systemPrompt,
      messages: messages,
      schema: habitLogSchema,
      temperature: 0.3,
    });

    const habitData = result.object;
    let responseMessage = habitData.message || 'I processed your request.';

    // Process habit logging if successful
    if (habitData?.success) {
      await processHabitLog(habitData, userId);
      responseMessage = `Great! I've logged your ${habitData.activity} activity. ${habitData.amount ? `${habitData.amount} ${habitData.unit}` : `${habitData.duration} minutes`} has been added to your ${habitData.habitName} habit.`;
      
      // Return both message and habit data for optimistic updates
      return new Response(JSON.stringify({ 
        message: responseMessage,
        success: true,
        habitData: habitData // Include parsed data for optimistic updates
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ message: responseMessage }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in chat API:', error);
    return new Response('Error processing request', { status: 500 });
  }
}

async function processHabitLog(habitData: any, userId: string) {
  try {
    console.log('🔍 Processing habit log:', { habitData, userId });
    
    if (!userId) {
      console.error('❌ No userId provided');
      return;
    }

    // Find matching habit by name - try exact match first, then partial
    console.log('🔍 Searching for habit:', habitData.habitName);
    
    let { data: habits, error: habitsError } = await supabase
      .from('habits')
      .select('*')
      .eq('user_id', userId)
      .eq('name', habitData.habitName);

    // If no exact match, try partial match
    if (!habits || habits.length === 0) {
      console.log('🔍 No exact match, trying partial match...');
      const { data: partialHabits, error: partialError } = await supabase
        .from('habits')
        .select('*')
        .eq('user_id', userId)
        .ilike('name', `%${habitData.habitName}%`);
      
      habits = partialHabits;
      habitsError = partialError;
    }

    if (habitsError) {
      console.error('❌ Database error finding habits:', habitsError);
      return;
    }

    if (!habits || habits.length === 0) {
      console.error('❌ No matching habit found for:', habitData.habitName);
      console.log('🔍 Available habits for user:', userId);
      
      // Debug: Show all habits for this user
      const { data: allHabits } = await supabase
        .from('habits')
        .select('id, name')
        .eq('user_id', userId);
      console.log('Available habits:', allHabits);
      return;
    }

    const habit = habits[0];
    console.log('✅ Found matching habit:', { id: habit.id, name: habit.name });
    
    const today = new Date().toISOString().split('T')[0];
    const currentTimestamp = new Date().toISOString(); // Full timestamp with date and time
    

    // Always create separate logs instead of combining them
    let finalAmount = habitData.amount || null;
    let finalDuration = habitData.duration ? habitData.duration * 60 : null; // Convert minutes to seconds
    let finalNotes = habitData.notes || `Logged via AI: ${habitData.activity}`;

    // Create habit log with quantitative data and time
    const logData = {
      habit_id: habit.id,
      habit_name: habit.name, // Add habit name for easy identification
      user_id: userId,
      date: today, // Always use today's date, ignore habitData.date
      time: currentTimestamp,
      status: 'completed' as const,
      amount: finalAmount,
      duration: finalDuration,
      unit: habitData.unit || null,
      notes: finalNotes,
      source: 'manual' as const,
    };

    console.log('🔍 Prepared log data:', {
      inputAmount: habitData.amount,
      inputDuration: habitData.duration,
      finalAmount,
      finalDuration,
      logData
    });

    // Always create a new log entry
    console.log('➕ Creating new log');
    const { data: insertResult, error: insertError } = await supabase
      .from('habit_logs')
      .insert(logData)
      .select();

    if (insertError) {
      console.error('❌ Error creating log:', insertError);
      console.error('❌ Failed log data:', logData);
      return;
    }
    
    console.log('✅ Log created successfully:', insertResult);
    console.log('✅ Inserted log ID:', insertResult?.[0]?.id);
  } catch (error) {
    console.error('❌ Error in processHabitLog:', error);
    throw error; // Re-throw to see the error in the main handler
  }
}
