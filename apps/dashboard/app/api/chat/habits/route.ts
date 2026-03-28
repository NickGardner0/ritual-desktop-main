import { generateObject } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { NextRequest } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { logger } from '@/lib/logger';

// Python backend API configuration
const PYTHON_API_BASE = process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';

// Phase 5A: Types for multi-intent parsing
interface LogIntent {
  habit_hint: string;
  value: number | null;
  unit: string | null;
  date: string;
  notes: string;
}

interface ResolvedIntent extends LogIntent {
  habit_id: string | null;
  habit_name: string | null;
  match_type: string;
  confidence: number;
  needs_clarification: boolean;
  alternatives: Array<{ id: string; name: string; confidence: number }>;
  unit_compatible: boolean;
  unit_error?: string;
  converted_value?: number;
}

interface LogResult {
  index: number;
  success: boolean;
  habit_id?: string;
  habit_name?: string;
  value?: number;
  unit?: string;
  date?: string;
  error?: string;
  needs_clarification?: boolean;
  alternatives?: Array<{ id: string; name: string; confidence: number }>;
}

// Phase 5A: Unit conversion utilities (server-side)
const UNIT_CANONICAL: Record<string, string> = {
  min: 'minutes', mins: 'minutes', minute: 'minutes',
  hr: 'hours', hrs: 'hours', hour: 'hours',
  mi: 'miles', mile: 'miles',
  km: 'kilometers', kilometer: 'kilometers',
  step: 'steps', pg: 'pages', page: 'pages',
};

function normalizeUnit(unit: string | null): string {
  if (!unit) return 'count';
  const lower = unit.toLowerCase().trim();
  return UNIT_CANONICAL[lower] || lower;
}

function convertValue(value: number, fromUnit: string, toUnit: string): { value: number; converted: boolean } {
  const from = normalizeUnit(fromUnit);
  const to = normalizeUnit(toUnit);
  
  if (from === to) return { value, converted: false };
  
  // Time conversions
  if (from === 'minutes' && to === 'hours') return { value: value / 60, converted: true };
  if (from === 'hours' && to === 'minutes') return { value: value * 60, converted: true };
  
  // Distance conversions
  if (from === 'kilometers' && to === 'miles') return { value: value * 0.621371, converted: true };
  if (from === 'miles' && to === 'kilometers') return { value: value * 1.60934, converted: true };
  
  return { value, converted: false };
}

function checkUnitCompatibility(intentUnit: string | null, habitUnit: string | null): { compatible: boolean; error?: string } {
  const from = normalizeUnit(intentUnit);
  const to = normalizeUnit(habitUnit);
  
  if (from === to || to === 'count' || from === 'count') return { compatible: true };
  
  const timeUnits = ['minutes', 'hours', 'seconds'];
  if (timeUnits.includes(from) && timeUnits.includes(to)) return { compatible: true };
  
  const distanceUnits = ['miles', 'kilometers', 'meters'];
  if (distanceUnits.includes(from) && distanceUnits.includes(to)) return { compatible: true };
  
  return { compatible: false, error: `Cannot convert ${intentUnit} to ${habitUnit}` };
}

// Helper: Get common prefix length between two strings
function commonPrefixLength(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

// Phase 5A: Simple fuzzy resolver (server-side implementation)
function resolveHabit(
  hint: string,
  userHabits: Array<{ id: string; name: string; category: string; unit_type: string }>,
  aliasesMap: Record<string, string[]>
): {
  habit_id: string | null;
  habit_name: string | null;
  match_type: string;
  confidence: number;
  alternatives: Array<{ id: string; name: string; confidence: number }>;
  needs_clarification: boolean;
} {
  const hintLower = hint.toLowerCase().trim();
  const candidates: Array<{ habit: typeof userHabits[0]; type: string; confidence: number }> = [];
  
  for (const habit of userHabits) {
    const nameLower = habit.name.toLowerCase();
    const aliases = aliasesMap[habit.id] || [];
    
    // 1. Exact match
    if (hintLower === nameLower) {
      candidates.push({ habit, type: 'exact', confidence: 1.0 });
      continue;
    }
    
    // 2. Alias match
    for (const alias of aliases) {
      if (hintLower === alias) {
        candidates.push({ habit, type: 'alias', confidence: 0.95 });
        break;
      }
      if (hintLower.includes(alias) || alias.includes(hintLower)) {
        candidates.push({ habit, type: 'alias', confidence: 0.8 });
        break;
      }
    }
    
    // 3. Substring match
    if (nameLower.includes(hintLower)) {
      candidates.push({ habit, type: 'substring', confidence: 0.85 * hintLower.length / nameLower.length });
      continue;
    }
    if (hintLower.includes(nameLower)) {
      candidates.push({ habit, type: 'substring', confidence: 0.75 });
      continue;
    }
    
    // 4. Stem/prefix match (handles "meditate" → "meditation", "code" → "coding", etc.)
    const prefixLen = commonPrefixLength(hintLower, nameLower);
    const minLen = Math.min(hintLower.length, nameLower.length);
    if (prefixLen >= 4 && prefixLen >= minLen * 0.7) {
      // Strong prefix match - likely same root word
      const confidence = 0.9 * (prefixLen / Math.max(hintLower.length, nameLower.length));
      candidates.push({ habit, type: 'stem', confidence: Math.max(confidence, 0.85) });
      continue;
    }
    
    // 5. Word match (check all words for best match)
    const nameWords = nameLower.split(/\s+/);
    let bestWordMatch: { type: string; confidence: number } | null = null;
    
    for (const word of nameWords) {
      // Exact word match
      if (hintLower === word) {
        bestWordMatch = { type: 'token', confidence: 0.95 };
        break;
      }
      
      // Stem/prefix match on word (e.g., "read" → "reading")
      const wordPrefixLen = commonPrefixLength(hintLower, word);
      const minLen = Math.min(hintLower.length, word.length);
      if (wordPrefixLen >= 3 && wordPrefixLen >= minLen * 0.7) {
        const conf = 0.85 + (0.1 * wordPrefixLen / Math.max(hintLower.length, word.length));
        if (!bestWordMatch || conf > bestWordMatch.confidence) {
          bestWordMatch = { type: 'stem', confidence: Math.min(conf, 0.95) };
        }
      }
      
      // Substring containment (lower confidence)
      if (word.length >= 3 && (hintLower.includes(word) || word.includes(hintLower))) {
        const conf = 0.8 * Math.min(hintLower.length, word.length) / Math.max(hintLower.length, word.length);
        if (!bestWordMatch || conf > bestWordMatch.confidence) {
          bestWordMatch = { type: 'token', confidence: Math.max(conf, 0.75) };
        }
      }
    }
    
    if (bestWordMatch) {
      candidates.push({ habit, type: bestWordMatch.type, confidence: bestWordMatch.confidence });
    }
  }
  
  // Sort by confidence
  candidates.sort((a, b) => b.confidence - a.confidence);
  
  if (candidates.length === 0) {
    return {
      habit_id: null,
      habit_name: null,
      match_type: 'none',
      confidence: 0,
      alternatives: [],
      needs_clarification: true
    };
  }
  
  const best = candidates[0];
  const alternatives = candidates.slice(1, 4).map(c => ({
    id: c.habit.id,
    name: c.habit.name,
    confidence: Math.round(c.confidence * 100) / 100
  }));
  
  // Simplified clarification logic - be VERY permissive
  // Only ask for clarification if:
  // 1. No match at all (confidence = 0), OR
  // 2. Multiple matches with VERY similar confidence (within 5%) AND low overall confidence
  const hasCompetingMatch = alternatives.length > 0 && 
    alternatives[0].confidence > best.confidence - 0.05 &&
    best.confidence < 0.5;
  
  const needsClarification = best.confidence === 0 || hasCompetingMatch;
  
  return {
    habit_id: needsClarification ? null : best.habit.id,
    habit_name: best.habit.name,
    match_type: best.type,
    confidence: Math.round(best.confidence * 100) / 100,
    alternatives: needsClarification 
      ? [{ id: best.habit.id, name: best.habit.name, confidence: Math.round(best.confidence * 100) / 100 }, ...alternatives]
      : alternatives,
    needs_clarification: needsClarification
  };
}

export async function POST(req: NextRequest) {
  try {
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
      logger.error('⚠️ Clerk auth() error:', authError);
    }

    const { messages, userId, selectedDate, clientEventId }: { 
      messages: Array<{role: string, content: string}>, 
      userId: string, 
      selectedDate?: string,
      clientEventId?: string 
    } = await req.json();
    
    const effectiveUserId = clerkUserId || userId;
    const effectiveToken = token;
    
    logger.info('🔍 Phase 5A: /api/chat/habits called (multi-intent)');

    // Fetch user's habits
    let userHabits: Array<{ id: string; name: string; category: string; unit_type: string }> = [];
    const headers: Record<string, string> = {};
    if (effectiveToken) {
      headers['Authorization'] = `Bearer ${effectiveToken}`;
    }
    
    try {
      const habitsResponse = await fetch(`${PYTHON_API_BASE}/api/habits`, { headers, signal: AbortSignal.timeout(15000) });
      if (habitsResponse.ok) {
        userHabits = await habitsResponse.json();
        logger.info('✅ Fetched habits:', userHabits.length);
      }
    } catch (error) {
      logger.error('❌ Error fetching habits:', error);
    }

    // Fetch aliases for fuzzy matching
    let aliasesMap: Record<string, string[]> = {};
    try {
      const aliasesResponse = await fetch(`${PYTHON_API_BASE}/api/habits/aliases`, { headers, signal: AbortSignal.timeout(15000) });
      if (aliasesResponse.ok) {
        aliasesMap = await aliasesResponse.json();
      }
    } catch {
      // Aliases are optional - continue without them
      logger.warn('⚠️ Could not fetch aliases, continuing with name matching only');
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

    const habitsContext = userHabits.length > 0 
      ? `USER'S HABITS:\n${userHabits.map(h => `- "${h.name}" (unit: ${h.unit_type || 'count'})`).join('\n')}`
      : 'User has no habits yet.';

    // Phase 5A: Multi-intent system prompt
    const systemPrompt = `You are a habit logging assistant. Parse the user's message and extract ALL habit log intents.

CRITICAL: Always return a JSON object with an "intents" array, even if empty.

${habitsContext}

REFERENCE DATES:
- "today" = ${today}
- "yesterday" = ${yesterday}
- "2 days ago" = ${getLocalDate(-2)}
- "3 days ago" = ${getLocalDate(-3)}
- "last ${getDayName(-1)}" = ${yesterday}
- "last ${getDayName(-2)}" = ${getLocalDate(-2)}
- Current year: ${currentYear}

PARSING RULES:
1. Extract EVERY trackable activity from the message
2. For each activity, identify:
   - habit_hint: key word to match (e.g., "walk", "meditate", "workout")
   - value: numeric amount (default 1 if "did", "completed", etc.)
   - unit: the unit mentioned (minutes, hours, miles, pages, etc.)
   - date: parsed date or "${today}" if not specified
   - notes: original text fragment

3. Handle multiple logs:
   - "walked 4 miles and meditated 10 minutes" → 2 intents
   - "worked out, read for 30 mins" → 2 intents

4. Handle implicit values:
   - "did a walk" → value: 1, unit: count
   - "meditated" → value: 1, unit: count (or reasonable default)

5. Handle ranges:
   - "walked 3-4 miles" → value: 3.5

EXAMPLES:
"I walked 4 miles today" →
{
  "intents": [{
    "habit_hint": "walk",
    "value": 4,
    "unit": "miles",
    "date": "${today}",
    "notes": "I walked 4 miles today"
  }]
}

"Walked 3 miles and meditated for 10 minutes yesterday" →
{
  "intents": [
    {"habit_hint": "walk", "value": 3, "unit": "miles", "date": "${yesterday}", "notes": "Walked 3 miles"},
    {"habit_hint": "meditate", "value": 10, "unit": "minutes", "date": "${yesterday}", "notes": "meditated for 10 minutes"}
  ]
}

"I completed my workout" →
{
  "intents": [{
    "habit_hint": "workout",
    "value": 1,
    "unit": "count",
    "date": "${today}",
    "notes": "completed my workout"
  }]
}

Non-trackable input →
{
  "intents": [],
  "message": "I couldn't identify any habits to log. Could you tell me what activity you did?"
}`;

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
    logger.info('📝 Parsed intents:', parsed.intents.length);

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
      const resolution = resolveHabit(intent.habit_hint, userHabits, aliasesMap);
      
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
    }

    // Separate into loggable and needs-clarification
    const toLog = resolvedIntents.filter(i => !i.needs_clarification && i.habit_id);
    const needsClarification = resolvedIntents.filter(i => i.needs_clarification);

    // Batch log the resolved intents
    const logResults: LogResult[] = [];
    
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
        const batchResponse = await fetch(`${PYTHON_API_BASE}/api/logs/batch`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${effectiveToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            items: batchItems,
            client_event_id: clientEventId
          }),
          signal: AbortSignal.timeout(15000),
        });

        if (batchResponse.ok) {
          const batchResult = await batchResponse.json();
          logger.info('✅ Batch log result:', batchResult);
          
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
        } else {
          logger.error('❌ Batch log failed:', await batchResponse.text());
          // Add failures for all items
          toLog.forEach((intent, index) => {
            logResults.push({
              index,
              success: false,
              habit_name: intent.habit_name ?? undefined,
              error: 'Batch log request failed'
            });
          });
        }
      } catch (error) {
        logger.error('❌ Batch log error:', error);
      }
    }

    // Index successful log phrases for future Typesense suggestion matching
    // This enables learned patterns: "I consumed" → Caffeine Consumption
    if (logResults.some(r => r.success) && effectiveToken) {
      const rawInput = messages[messages.length - 1]?.content || '';
      
      for (const result of logResults) {
        if (result.success && result.habit_id && result.habit_name) {
          try {
            fetch(`${PYTHON_API_BASE}/api/search/index-phrase`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${effectiveToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                input_text: rawInput,
                habit_id: result.habit_id,
                habit_name: result.habit_name,
                value: result.value,
                unit: result.unit,
              }),
              signal: AbortSignal.timeout(15000),
            }).catch(err => logger.warn('⚠️ Failed to index log phrase:', err));
          } catch {
            // Non-blocking: phrase indexing is best-effort
          }
        }
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
      affectedHabitIds: successfulLogs.map(r => r.habit_id)
    }), { headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    logger.error('❌ Error in Phase 5A chat API:', error);
    return new Response(JSON.stringify({
      success: false,
      message: 'Error processing your request. Please try again.',
      logged: [],
      clarifications: []
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
