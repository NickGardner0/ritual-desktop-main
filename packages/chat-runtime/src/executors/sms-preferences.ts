/**
 * SMS preference tool executors.
 *
 * These call the Python /api/sms/preferences endpoints to read/update
 * per-user SMS chatbot settings (proactive messaging, quiet hours, etc.).
 */

import { fetchPythonApi, fetchPythonApiPost } from './shared-api.js';

// ---------------------------------------------------------------------------
// executeGetSmsPreferences
// ---------------------------------------------------------------------------

export async function executeGetSmsPreferences(token: string) {
  console.log('📱 getSmsPreferences called');

  try {
    const result = await fetchPythonApi('/api/sms/preferences', token);
    return JSON.stringify(result);
  } catch (error) {
    console.error('❌ getSmsPreferences error:', error);
    return JSON.stringify({ error: String(error) });
  }
}

// ---------------------------------------------------------------------------
// executeUpdateSmsPreferences
// ---------------------------------------------------------------------------

export async function executeUpdateSmsPreferences(token: string, params: {
  proactiveEnabled?: boolean;
  quietHoursStart?: string;
  quietHoursEnd?: string;
  allowedTriggers?: string;
  maxProactivePerDay?: number;
}) {
  console.log('📱 updateSmsPreferences called:', params);

  try {
    const body: Record<string, unknown> = {};

    if (params.proactiveEnabled !== undefined) {
      body.proactive_enabled = params.proactiveEnabled;
    }
    if (params.quietHoursStart !== undefined) {
      body.quiet_hours_start = params.quietHoursStart;
    }
    if (params.quietHoursEnd !== undefined) {
      body.quiet_hours_end = params.quietHoursEnd;
    }
    if (params.allowedTriggers !== undefined) {
      body.allowed_triggers = params.allowedTriggers;
    }
    if (params.maxProactivePerDay !== undefined) {
      body.max_proactive_per_day = params.maxProactivePerDay;
    }

    const result = await fetchPythonApiPost('/api/sms/preferences', token, body);
    return JSON.stringify(result);
  } catch (error) {
    console.error('❌ updateSmsPreferences error:', error);
    return JSON.stringify({ error: String(error) });
  }
}
