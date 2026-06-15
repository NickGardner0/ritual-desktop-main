// src/trigger/proactive-sms.ts
/**
 * Proactive SMS Sweep — runs every hour.
 *
 * Calls the Python backend's proactive trigger endpoint with
 * trigger_type="all". The backend handles timezone-aware user
 * eligibility: for each trigger type (eod_recap at 9 PM,
 * morning_briefing at 8 AM, streak_alert at 8 PM, etc.), it
 * finds users whose local time matches the target hour,
 * generates content via the TS orchestrator, and sends via
 * SendBlue.
 *
 * One hourly cron covers all 5 trigger types.
 */

import { task, schedules } from "@trigger.dev/sdk/v3";
import { getTriggerBackendBaseUrl, triggerBackendFetch } from "@/lib/api/trigger-client";

async function runProactiveSweep() {
  const INTERNAL_SMS_CHAT_SECRET = process.env.INTERNAL_SMS_CHAT_SECRET;

  if (!INTERNAL_SMS_CHAT_SECRET) {
    throw new Error('INTERNAL_SMS_CHAT_SECRET environment variable is not set');
  }

  console.log('📬 Starting proactive SMS sweep...');
  console.log(`📊 Config: API=${getTriggerBackendBaseUrl()}`);

  const response = await triggerBackendFetch('/api/sms/proactive/trigger', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-secret': INTERNAL_SMS_CHAT_SECRET,
    },
    body: JSON.stringify({
      trigger_type: 'all',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Proactive SMS sweep failed (${response.status}): ${errorText}`);
  }

  const result = await response.json();

  const totalSent = (result.sweeps || []).reduce(
    (sum: number, s: { sent?: number }) => sum + (s.sent || 0),
    0,
  );

  console.log('✅ Proactive SMS sweep completed');
  console.log(`📊 Results: ${totalSent} messages sent across ${(result.sweeps || []).length} trigger types`);

  return {
    success: true,
    timestamp: new Date().toISOString(),
    sweeps: result.sweeps,
    totalSent,
  };
}

/**
 * Manual trigger — can be invoked from the Trigger.dev dashboard.
 */
export const proactiveSmsTask = task({
  id: "proactive-sms-sweep",
  retry: {
    maxAttempts: 2,
    minTimeoutInMs: 2000,
    maxTimeoutInMs: 10000,
    factor: 2,
  },
  run: async () => {
    try {
      return await runProactiveSweep();
    } catch (error) {
      console.error('❌ Error running proactive SMS sweep:', error);
      throw error;
    }
  },
});

/**
 * Hourly schedule — runs at the top of every hour.
 * The Python backend determines which users are eligible based on
 * their local timezone and each trigger type's target hour.
 */
export const proactiveSmsSchedule = schedules.task({
  id: "proactive-sms-hourly",
  cron: "0 * * * *",
  run: async () => runProactiveSweep(),
});
