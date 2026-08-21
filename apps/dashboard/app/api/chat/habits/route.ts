import { generateObject } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { NextRequest } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { fetchPythonApi, fetchPythonApiPost } from '@ritual/chat-runtime';
import { privacyBlockResponse } from '@/lib/privacy/server-policy';
import {
  type LogResult,
  type ResolvedIntent,
  resolveHabit,
  normalizeUnit,
  convertValue,
  checkUnitCompatibility,
} from './route.resolver';
import { buildHabitLogSystemPrompt } from './route.prompt';

const FASTAPI_TIMEOUT_MS = 15000;

export async function POST(req: NextRequest) {
  try {
    const privacyBlock = privacyBlockResponse(req, {
      dataClass: 'ai_content',
      destination: 'openai',
      purpose: 'ai',
    });
    if (privacyBlock) return privacyBlock;

    // Auth setup
    const authHeader = req.headers.get('Authorization');
    let token: string | null = null;
    let clerkUserId: string | null = null;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    }
    
    try {
      const authResult = await auth();
      if (authResult.userId) {
        clerkUserId = authResult.userId;
        if (!token) {
          token = await authResult.getToken();
        }
      }
    } catch (authError) {
      console.error('⚠️ Clerk auth() error:', authError);
    }

    const { messages, userId, selectedDate, clientEventId }: { 
      messages: Array<{role: string, content: string}>, 
      userId: string, 
      selectedDate?: string,
      clientEventId?: string 
    } = await req.json();
    
    const effectiveUserId = clerkUserId || userId;
    const effectiveToken = token;
    
    console.info('🔍 Phase 5A: /api/chat/habits called (multi-intent)');

    // Fetch user's habits
    let userHabits: Array<{ id: string; name: string; category: string; unit_type: string }> = [];
    let aliasesMap: Record<string, string[]> = {};

    if (effectiveToken) {
      try {
        userHabits = await fetchPythonApi('/api/habits', effectiveToken, undefined, {
          timeoutMs: FASTAPI_TIMEOUT_MS,
        });
        console.info('✅ Fetched habits:', userHabits.length);
      } catch (error) {
        console.error('❌ Error fetching habits:', error);
      }

      try {
        aliasesMap = await fetchPythonApi('/api/habits/aliases', effectiveToken, undefined, {
          timeoutMs: FASTAPI_TIMEOUT_MS,
        });
      } catch {
        console.warn('⚠️ Could not fetch aliases, continuing with name matching only');
      }
    }

    // Date helpers - IMPORTANT: Use local timezone, not UTC!
    const getLocalDate = (daysOffset: number = 0) => {
      const now = new Date();
      now.setDate(now.getDate() + daysOffset);
      // Use local date components, NOT toISOString() which converts to UTC
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };
    
    const today = selectedDate || getLocalDate(0);
    const yesterday = getLocalDate(-1);
    const getDayName = (daysOffset: number) => {
      const date = new Date();
      date.setDate(date.getDate() + daysOffset);
      return date.toLocaleDateString('en-US', { weekday: 'long' });
    };
    const currentYear = new Date().getFullYear();

    const systemPrompt = buildHabitLogSystemPrompt({
      userHabits,
      today,
      yesterday,
      getLocalDate,
      getDayName,
      currentYear,
    });

    // Phase 5A: Multi-intent schema
    const multiIntentSchema = z.object({
      intents: z.array(z.object({
        habit_hint: z.string(),
        value: z.number().nullable(),
        unit: z.string().nullable(),
        date: z.string(),
        notes: z.string()
      })),
      message: z.string().optional()
    });

    // @ts-expect-error - AI SDK type inference issue
    const result = await generateObject({
      model: openai('gpt-4o-mini'),
      system: systemPrompt,
      messages: messages,
      schema: multiIntentSchema,
      temperature: 0.3,
    });

    const parsed = result.object;
    console.info('📝 Parsed intents:', JSON.stringify(parsed.intents));

    // No intents found
    if (!parsed.intents || parsed.intents.length === 0) {
      return new Response(JSON.stringify({
        success: false,
        message: parsed.message || "I couldn't identify any habits to log. What activity did you complete?",
        logged: [],
        clarifications: []
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    // Phase 5A: Resolve each intent
    const resolvedIntents: ResolvedIntent[] = [];
    
    for (const intent of parsed.intents) {
      let resolution = resolveHabit(intent.habit_hint, userHabits, aliasesMap, intent.unit, intent.notes || '');
      
      // Check unit compatibility
      let unitCompat: ReturnType<typeof checkUnitCompatibility> = { compatible: true };
      let convertedValue = intent.value;
      
      if (resolution.habit_id && intent.value !== null) {
        const habit = userHabits.find(h => h.id === resolution.habit_id);
        if (habit?.unit_type) {
          unitCompat = checkUnitCompatibility(intent.unit, habit.unit_type);
          if (unitCompat.compatible && intent.unit) {
            const converted = convertValue(intent.value, intent.unit, habit.unit_type);
            convertedValue = converted.value;
          }
        }
      }

      if (!unitCompat.compatible && intent.unit) {
        const compatibleHabits = userHabits.filter(
          (habit) => normalizeUnit(habit.unit_type) === normalizeUnit(intent.unit)
        );

        if (compatibleHabits.length > 0) {
          const compatibleResolution = resolveHabit(
            intent.habit_hint,
            compatibleHabits,
            aliasesMap,
            intent.unit,
            intent.notes || ''
          );

          if (compatibleResolution.habit_id) {
            resolution = compatibleResolution;
            const compatibleHabit = compatibleHabits.find((habit) => habit.id === compatibleResolution.habit_id);
            unitCompat = { compatible: true };
            if (compatibleHabit?.unit_type && intent.value !== null && intent.unit) {
              const converted = convertValue(intent.value, intent.unit, compatibleHabit.unit_type);
              convertedValue = converted.value;
            }
          }
        }
      }
      
      resolvedIntents.push({
        ...intent,
        habit_id: resolution.habit_id,
        habit_name: resolution.habit_name,
        match_type: resolution.match_type,
        confidence: resolution.confidence,
        needs_clarification: resolution.needs_clarification || !unitCompat.compatible,
        alternatives: resolution.alternatives,
        unit_compatible: unitCompat.compatible,
        unit_error: unitCompat.error,
        converted_value: convertedValue ?? undefined
      });

      console.info('🎯 Intent resolution', {
        hint: intent.habit_hint,
        value: intent.value,
        unit: intent.unit,
        resolved_habit: resolution.habit_name,
        match_type: resolution.match_type,
        confidence: resolution.confidence,
        needs_clarification: resolution.needs_clarification,
        unit_compatible: unitCompat.compatible,
        unit_error: unitCompat.error,
      });
    }

    // Separate into loggable and needs-clarification
    const toLog = resolvedIntents.filter(i => !i.needs_clarification && i.habit_id);
    const needsClarification = resolvedIntents.filter(i => i.needs_clarification);

    // Batch log the resolved intents
    const logResults: LogResult[] = [];
    let overviewSnapshot: unknown = undefined;
    let affectedHabitIds: string[] = [];
    let affectedDates: string[] = [];
    
    if (toLog.length > 0) {
      const batchItems = toLog.map(intent => {
        const habit = userHabits.find(h => h.id === intent.habit_id);
        let amount = intent.converted_value ?? intent.value;
        let duration: number | null = null;
        
        // Handle duration-based habits
        const unitLower = normalizeUnit(intent.unit);
        if (unitLower === 'minutes' || unitLower === 'hours') {
          duration = unitLower === 'hours' ? (amount ?? 0) * 3600 : (amount ?? 0) * 60; // Convert to seconds
          amount = null;
        }
        
        return {
          habit_id: intent.habit_id!,
          date: intent.date,
          amount: amount,
          duration: duration,
          unit: habit?.unit_type || intent.unit || 'count',
          source: 'ai_log_v2',
          notes: intent.notes
        };
      });

      try {
        if (!effectiveToken) {
          throw new Error('Missing auth token');
        }
        const batchResult = await fetchPythonApiPost(
          '/api/logs/batch',
          effectiveToken,
          {
            items: batchItems,
            client_event_id: clientEventId,
          },
          { timeoutMs: FASTAPI_TIMEOUT_MS },
        );
        console.info('✅ Batch log result:', batchResult);
        overviewSnapshot = batchResult.overview_snapshot;
        affectedHabitIds = Array.isArray(batchResult.affectedHabitIds) ? batchResult.affectedHabitIds : [];
        affectedDates = Array.isArray(batchResult.affectedDates) ? batchResult.affectedDates : [];

        for (const result of batchResult.results || []) {
          const intent = toLog[result.index];
          logResults.push({
            index: result.index,
            success: result.success,
            habit_id: intent.habit_id!,
            habit_name: intent.habit_name!,
            value: intent.converted_value ?? intent.value ?? 1,
            unit: intent.unit || 'count',
            date: intent.date,
            error: result.error
          });
        }
      } catch (error) {
        console.error('❌ Batch log error:', error);
        toLog.forEach((intent, index) => {
          logResults.push({
            index,
            success: false,
            habit_name: intent.habit_name ?? undefined,
            error: 'Batch log request failed'
          });
        });
      }
    }

    // Build clarification list
    const clarifications = needsClarification.map((intent, index) => ({
      index,
      habit_hint: intent.habit_hint,
      value: intent.value,
      unit: intent.unit,
      date: intent.date,
      alternatives: intent.alternatives,
      reason: intent.unit_error || (intent.confidence < 0.75 ? 'Low match confidence' : 'Multiple possible matches')
    }));

    // Build response message
    const successfulLogs = logResults.filter(r => r.success);
    let message = '';
    
    if (successfulLogs.length > 0) {
      const loggedList = successfulLogs.map(r => 
        `✓ ${r.habit_name} — ${r.value} ${r.unit} — ${r.date === today ? 'Today' : r.date}`
      ).join('\n');
      message = `Logged:\n${loggedList}`;
    }
    
    if (clarifications.length > 0) {
      if (message) message += '\n\n';
      message += `I need clarification for ${clarifications.length} item(s):`;
      clarifications.forEach(c => {
        message += `\n• "${c.habit_hint}" - which habit did you mean?`;
      });
    }

    if (!message) {
      message = "I couldn't log any habits. Please try again with more details.";
    }

    return new Response(JSON.stringify({
      success: successfulLogs.length > 0,
      message,
      logged: logResults,
      clarifications,
      refreshNeeded: successfulLogs.length > 0,
      affectedHabitIds: affectedHabitIds.length > 0 ? affectedHabitIds : successfulLogs.map(r => r.habit_id),
      affectedDates,
      overview_snapshot: overviewSnapshot,
    }), { headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('❌ Error in Phase 5A chat API:', error);
    return new Response(JSON.stringify({
      success: false,
      message: 'Error processing your request. Please try again.',
      logged: [],
      clarifications: []
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
