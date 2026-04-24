/**
 * Habit-related tool executors.
 *
 * Extracted from orchestrator.ts (lines 2567-2944) during Phase 1 refactoring.
 * These are pure functions: (token, params) → JSON string.
 */

import { fetchPythonApi, fetchPythonApiPost } from './shared-api.js';

function getInternalUserId(token: string): string | null {
  const sep = token.indexOf('::');
  return sep === -1 ? null : token.slice(sep + 2) || null;
}

function getLocalDateString(timezone?: string): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = formatter.formatToParts(new Date());
    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;
    if (year && month && day) {
      return `${year}-${month}-${day}`;
    }
  } catch (error) {
    console.warn('⚠️ failed to format local date for timezone:', timezone, error);
  }

  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const UNIT_CANONICAL: Record<string, string> = {
  min: 'minutes',
  mins: 'minutes',
  minute: 'minutes',
  hr: 'hours',
  hrs: 'hours',
  hour: 'hours',
  sec: 'seconds',
  secs: 'seconds',
  second: 'seconds',
  mi: 'miles',
  mile: 'miles',
  km: 'kilometers',
  kilometer: 'kilometers',
  step: 'steps',
  page: 'pages',
  milligram: 'mg',
  milligrams: 'mg',
  gram: 'grams',
  kilogram: 'kilograms',
  kilograms: 'kilograms',
  milliliter: 'milliliters',
  milliliters: 'milliliters',
  liter: 'liters',
  liters: 'liters',
  ounce: 'ounces',
  ounces: 'ounces',
};

const QUANTIFIED_UNIT_PATTERN =
  /(\d[\d,]*(?:\.\d+)?)\s*(hours?|hrs?|hr|h|minutes?|mins?|min|seconds?|secs?|sec|s|miles?|mi|kilometers?|kilometer|km|steps?|pages?|page|mg|milligrams?|g|grams?|kg|kilograms?|ml|milliliters?|l|liters?|oz|ounces?)\b/gi;

function normalizeUnit(unit?: string | null): string {
  if (!unit) return 'count';
  const lower = unit.toLowerCase().trim();
  return UNIT_CANONICAL[lower] || lower;
}

function checkUnitCompatibility(fromUnit?: string | null, toUnit?: string | null): { compatible: boolean; error?: string } {
  const from = normalizeUnit(fromUnit);
  const to = normalizeUnit(toUnit);

  if (from === to || from === 'count' || to === 'count') {
    return { compatible: true };
  }

  const timeUnits = new Set(['seconds', 'minutes', 'hours']);
  if (timeUnits.has(from) && timeUnits.has(to)) {
    return { compatible: true };
  }

  const distanceUnits = new Set(['meters', 'kilometers', 'miles']);
  if (distanceUnits.has(from) && distanceUnits.has(to)) {
    return { compatible: true };
  }

  return { compatible: false, error: `Cannot convert ${fromUnit || 'count'} to ${toUnit || 'count'}` };
}

function convertValue(value: number, fromUnit?: string | null, toUnit?: string | null): { value: number; converted: boolean } {
  const from = normalizeUnit(fromUnit);
  const to = normalizeUnit(toUnit);

  if (from === to) {
    return { value, converted: false };
  }

  if (from === 'minutes' && to === 'hours') return { value: value / 60, converted: true };
  if (from === 'hours' && to === 'minutes') return { value: value * 60, converted: true };
  if (from === 'seconds' && to === 'minutes') return { value: value / 60, converted: true };
  if (from === 'seconds' && to === 'hours') return { value: value / 3600, converted: true };
  if (from === 'minutes' && to === 'seconds') return { value: value * 60, converted: true };
  if (from === 'hours' && to === 'seconds') return { value: value * 3600, converted: true };

  if (from === 'kilometers' && to === 'miles') return { value: value * 0.621371, converted: true };
  if (from === 'miles' && to === 'kilometers') return { value: value * 1.60934, converted: true };

  return { value, converted: false };
}

function extractCompatibleMeasurementFromNote(note?: string, habitUnit?: string | null): { value: number; unit: string } | null {
  if (!note) return null;

  const normalizedHabitUnit = normalizeUnit(habitUnit);
  const matches = Array.from(note.matchAll(QUANTIFIED_UNIT_PATTERN))
    .map((match) => {
      const value = Number(match[1].replace(/,/g, ''));
      if (!Number.isFinite(value)) return null;
      return {
        value,
        unit: normalizeUnit(match[2]),
      };
    })
    .filter((match): match is { value: number; unit: string } => Boolean(match));

  if (matches.length === 0) {
    return null;
  }

  const exact = matches.find((match) => match.unit === normalizedHabitUnit);
  if (exact) {
    return exact;
  }

  return matches.find((match) => checkUnitCompatibility(match.unit, normalizedHabitUnit).compatible) || null;
}

function isObviouslyAbsurdAmount(amount: number, habitUnit?: string | null): boolean {
  const unit = normalizeUnit(habitUnit);
  if (unit === 'hours') return amount > 24;
  if (unit === 'minutes') return amount > 1440;
  if (unit === 'seconds') return amount > 86400;
  return false;
}

function normalizeLogAmount(rawAmount: number | null | undefined, params: {
  unitType?: string;
  note?: string;
}, habitUnit?: string | null): {
  amount: number | null;
  correctionSource?: 'note' | 'unit';
  error?: string;
} {
  if (rawAmount === undefined || rawAmount === null) {
    return { amount: null };
  }

  const noteMeasurement = extractCompatibleMeasurementFromNote(params.note, habitUnit);
  if (noteMeasurement) {
    const compat = checkUnitCompatibility(noteMeasurement.unit, habitUnit);
    if (!compat.compatible) {
      return { amount: null, error: compat.error };
    }
    return {
      amount: convertValue(noteMeasurement.value, noteMeasurement.unit, habitUnit).value,
      correctionSource: 'note',
    };
  }

  if (params.unitType) {
    const compat = checkUnitCompatibility(params.unitType, habitUnit);
    if (!compat.compatible) {
      return { amount: null, error: compat.error };
    }
    return {
      amount: convertValue(rawAmount, params.unitType, habitUnit).value,
      correctionSource: 'unit',
    };
  }

  if (isObviouslyAbsurdAmount(rawAmount, habitUnit)) {
    return {
      amount: null,
      error: `That value looks too large for a ${habitUnit || 'time-based'} habit. Please include the unit explicitly, like "1 hour workout".`,
    };
  }

  return { amount: rawAmount };
}

// ---------------------------------------------------------------------------
// executeGetHabitStats
// ---------------------------------------------------------------------------

export async function executeGetHabitStats(token: string, params: {
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

// ---------------------------------------------------------------------------
// executeGetDailyBreakdown
// ---------------------------------------------------------------------------

export async function executeGetDailyBreakdown(token: string, params: {
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

// ---------------------------------------------------------------------------
// executeGetCorrelation
// ---------------------------------------------------------------------------

export async function executeGetCorrelation(token: string, params: {
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

// ---------------------------------------------------------------------------
// executeListHabits
// ---------------------------------------------------------------------------

export async function executeListHabits(token: string) {
  console.log('📊 listHabits called');

  try {
    const result = await fetchPythonApi('/api/analytics/list-habits', token);
    return JSON.stringify(result);
  } catch (error) {
    console.error('❌ listHabits error:', error);
    return JSON.stringify({ error: String(error) });
  }
}

// ---------------------------------------------------------------------------
// executeGetHabitTrends
// ---------------------------------------------------------------------------

export async function executeGetHabitTrends(token: string, params: {
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

// ---------------------------------------------------------------------------
// executeGetHabitAnomalies
// ---------------------------------------------------------------------------

export async function executeGetHabitAnomalies(token: string, params: {
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

// ---------------------------------------------------------------------------
// executeGetStreaks
// ---------------------------------------------------------------------------

export async function executeGetStreaks(token: string, params: {
  habitName?: string;
}) {
  console.log('🔥 getStreaks called:', params);

  try {
    const queryParams: Record<string, string | number> = {};
    if (params.habitName) {
      queryParams.habit_name = params.habitName;
    }

    const result = await fetchPythonApi('/api/analytics/streaks', token, queryParams);

    if (!result.success) {
      return JSON.stringify({
        error: result.error,
        available_habits: result.available_habits,
      });
    }

    return JSON.stringify(result);
  } catch (error) {
    console.error('❌ getStreaks error:', error);
    return JSON.stringify({ error: String(error) });
  }
}

// ---------------------------------------------------------------------------
// executeLogHabit
// ---------------------------------------------------------------------------

export async function executeLogHabit(token: string, params: {
  habitName: string;
  amount?: number;
  unitType?: string;
  note?: string;
}, timezone?: string) {
  console.log('📝 logHabit called:', params);

  try {
    // Step 1: List user's habits to find the matching habit ID
    const habits = await fetchPythonApi('/api/habits', token);

    if (!Array.isArray(habits) || habits.length === 0) {
      return JSON.stringify({ error: 'No habits found for this user.' });
    }

    // Step 2: Fuzzy-match the requested habit name
    const target = params.habitName.toLowerCase().trim();
    let matched = habits.find(
      (h: { name: string }) => h.name.toLowerCase() === target,
    );

    if (!matched) {
      // Substring match fallback
      matched = habits.find(
        (h: { name: string }) => h.name.toLowerCase().includes(target) || target.includes(h.name.toLowerCase()),
      );
    }

    if (!matched) {
      return JSON.stringify({
        error: `No habit matching "${params.habitName}" found.`,
        available_habits: habits.map((h: { name: string }) => h.name),
      });
    }

    const normalized = normalizeLogAmount(params.amount, params, matched.unit_type);
    if (normalized.error) {
      return JSON.stringify({ error: normalized.error });
    }

    // Step 3: Log the entry
    const today = getLocalDateString(timezone);
    const logBody: Record<string, unknown> = {
      date: today,
      status: 'completed',
    };
    if (normalized.amount !== undefined && normalized.amount !== null) {
      logBody.amount = normalized.amount;
    }
    if (params.note) {
      logBody.notes = params.note;
    }

    const result = await fetchPythonApiPost(
      `/api/habits/${matched.id}/logs`,
      token,
      logBody,
    );

    let smsConfirmation = `Logged ${matched.name}${normalized.amount !== undefined && normalized.amount !== null ? `: ${normalized.amount}${matched.unit_type ? ` ${matched.unit_type}` : ''}` : ''}.`;
    let smsConfirmationMeta: Record<string, unknown> | null = null;

    const internalUserId = getInternalUserId(token);
    const internalApiKey = process.env.INTERNAL_API_KEY || '';
    if (internalUserId && internalApiKey) {
      try {
        const confirmation = await fetchPythonApiPost(
          '/api/internal/sms-copilot/log-confirmation',
          token,
          {
            user_id: internalUserId,
            habit_id: matched.id,
            amount: normalized.amount ?? null,
            note: params.note,
            logged_at: new Date().toISOString(),
          },
          {
            extraHeaders: {
              'X-Internal-Key': internalApiKey,
            },
          },
        );
        if (confirmation?.success && typeof confirmation.message === 'string' && confirmation.message.trim()) {
          smsConfirmation = confirmation.message.trim();
          smsConfirmationMeta = confirmation.metrics || null;
        }
      } catch (error) {
        console.warn('⚠️ sms log confirmation enrichment failed:', error);
      }
    }

    return JSON.stringify({
      success: true,
      habit_name: matched.name,
      habit_id: matched.id,
      amount: normalized.amount ?? null,
      date: today,
      log: result,
      sms_confirmation: smsConfirmation,
      sms_confirmation_meta: smsConfirmationMeta,
    });
  } catch (error) {
    console.error('❌ logHabit error:', error);
    return JSON.stringify({ error: String(error) });
  }
}

// ---------------------------------------------------------------------------
// executeCreateHabit
// ---------------------------------------------------------------------------

export async function executeCreateHabit(token: string, params: {
  name: string;
  category: string;
  unitType?: string;
}) {
  console.log('➕ createHabit called:', params);

  try {
    const body: Record<string, unknown> = {
      name: params.name,
      category: params.category,
      is_custom: true,
      sensor_type: 'Manual',
    };
    if (params.unitType) {
      body.unit_type = params.unitType;
    }

    const result = await fetchPythonApiPost('/api/habits', token, body);

    return JSON.stringify({
      success: true,
      habit_name: result.name,
      habit_id: result.id,
      category: result.category,
      unit_type: result.unit_type || null,
      message: `Created new habit "${result.name}"`,
    });
  } catch (error) {
    console.error('❌ createHabit error:', error);
    return JSON.stringify({ error: String(error) });
  }
}
