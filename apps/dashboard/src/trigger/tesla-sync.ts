// src/trigger/tesla-sync.ts
/**
 * Tesla Odometer Sync Task
 * Runs every 6 hours to read odometer and log miles driven.
 */

import { task, schedules } from "@trigger.dev/sdk/v3";

async function runTeslaSync() {
  const API_BASE_URL = process.env.PYTHON_API_URL || process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';
  const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY;

  if (!INTERNAL_API_KEY) {
    throw new Error('INTERNAL_API_KEY environment variable is not set');
  }

  console.log('🚗 Starting automated Tesla odometer sync...');

  const response = await fetch(`${API_BASE_URL}/api/integrations/tesla/sync-all`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Key': INTERNAL_API_KEY,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Tesla sync failed (${response.status}): ${errorText}`);
  }

  const result = await response.json();

  console.log('✅ Tesla sync completed');
  console.log(`📊 Results: ${result.successful_syncs}/${result.total_users} users synced`);

  return {
    success: true,
    timestamp: new Date().toISOString(),
    totalUsers: result.total_users,
    successfulSyncs: result.successful_syncs,
    results: result.results,
  };
}

export const syncTeslaData = task({
  id: "sync-tesla-data",
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 10000,
    factor: 2,
  },
  run: async () => {
    try {
      return await runTeslaSync();
    } catch (error) {
      console.error('❌ Error syncing Tesla data:', error);
      throw error;
    }
  },
});

/**
 * Sync every 6 hours: midnight, 6am, noon, 6pm UTC.
 */
export const teslaSyncSchedules = [0, 6, 12, 18].map((h) =>
  schedules.task({
    id: `tesla-sync-hour-${h}`,
    cron: `0 ${h} * * *`,
    run: async () => runTeslaSync(),
  })
);
