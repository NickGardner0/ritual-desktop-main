/**
 * Habit-related tool executors.
 *
 * Extracted from orchestrator.ts (lines 2567-2944) during Phase 1 refactoring.
 * These are pure functions: (token, params) → JSON string.
 */

import { fetchPythonApi, fetchPythonApiPost } from './shared-api';

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

    // Step 3: Log the entry
    const today = getLocalDateString(timezone);
    const logBody: Record<string, unknown> = {
      date: today,
      status: 'completed',
    };
    if (params.amount !== undefined && params.amount !== null) {
      logBody.amount = params.amount;
    }
    if (params.note) {
      logBody.notes = params.note;
    }

    const result = await fetchPythonApiPost(
      `/api/habits/${matched.id}/logs`,
      token,
      logBody,
    );

    let smsConfirmation = `Logged ${matched.name}${params.amount !== undefined && params.amount !== null ? `: ${params.amount}${matched.unit_type ? ` ${matched.unit_type}` : ''}` : ''}.`;
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
            amount: params.amount ?? null,
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
      amount: params.amount ?? null,
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
