import { task, schedules } from "@trigger.dev/sdk/v3";
import { getTriggerBackendBaseUrl, triggerBackendFetch } from "@/lib/api/trigger-client";

async function runWhoopSync(payload: { userId?: string; daysBack?: number; hour?: number }) {
  const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY;

  if (!INTERNAL_API_KEY) {
    throw new Error('INTERNAL_API_KEY environment variable is not set');
  }

  console.log('🔄 Starting automated Whoop sync...');
  console.log(`📊 Config: API=${getTriggerBackendBaseUrl()}, userId=${payload.userId || 'all'}, daysBack=${payload.daysBack || 2}, hour=${payload.hour ?? 'any'}`);

  const response = await triggerBackendFetch('/api/wearables/connections/whoop/sync-all', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Key': INTERNAL_API_KEY,
    },
    body: JSON.stringify({
      days_back: payload.daysBack || 2,
      hour: payload.hour,
      force_full_sync: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Whoop sync failed (${response.status}): ${errorText}`);
  }

  const result = await response.json();

  console.log('✅ Whoop sync completed successfully');
  console.log(`📊 Results: ${result.successful_syncs}/${result.total_users} users synced`);

  return {
    success: true,
    timestamp: new Date().toISOString(),
    totalUsers: result.total_users,
    successfulSyncs: result.successful_syncs,
    results: result.results,
  };
}

/**
 * Main Whoop sync task - can be triggered manually or via schedule.
 * Payload now includes an optional `hour` field to filter which users to sync.
 */
export const syncWhoopData = task({
  id: "sync-whoop-data",
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 10000,
    factor: 2,
  },
  run: async (payload: { userId?: string; daysBack?: number; hour?: number }) => {
    try {
      return await runWhoopSync(payload);
    } catch (error) {
      console.error('❌ Error syncing Whoop data:', error);
      throw error; // Let Trigger.dev handle retries
    }
  },
});

/**
 * Generate 24 hourly scheduled tasks. Each one passes its hour (0-23) to the backend.
 */
const hourlySchedules = [] as any[];
for (let h = 0; h < 24; h++) {
  hourlySchedules.push(
    schedules.task({
      id: `whoop-sync-hour-${h}`,
      cron: `0 ${h} * * *`,
      run: async () => runWhoopSync({ hour: h }),
    })
  );
}

// Export all schedules so Trigger.dev registers them.
export const whoopHourlySyncSchedules = hourlySchedules;
