/**
 * Whoop Daily Sync Task
 * 
 * Automatically syncs Whoop sleep, recovery, and workout data for all users
 * Runs daily at 9 AM to ensure sleep data from the previous night is captured
 */

import { task, schedules } from "@trigger.dev/sdk/v3";

/**
 * Main Whoop sync task - can be triggered manually or on a schedule
 * Schedule is configured in the Trigger.dev dashboard
 */
export const syncWhoopData = task({
  id: "sync-whoop-data",
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 10000,
    factor: 2,
  },
  run: async (payload: { userId?: string; daysBack?: number }) => {
    const API_BASE_URL = process.env.PYTHON_API_URL || process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';
    const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY;

    if (!INTERNAL_API_KEY) {
      throw new Error('INTERNAL_API_KEY environment variable is not set');
    }

    console.log('🔄 Starting automated Whoop sync...');
    console.log(`📊 Config: API=${API_BASE_URL}, userId=${payload.userId || 'all'}, daysBack=${payload.daysBack || 2}`);

    try {
      // Sync all users with active Whoop integrations
      const response = await fetch(`${API_BASE_URL}/api/integrations/whoop/sync-all`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Key': INTERNAL_API_KEY,
        },
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
    } catch (error) {
      console.error('❌ Error syncing Whoop data:', error);
      throw error; // Let Trigger.dev handle retries
    }
  },
});

/**
 * Scheduled task: Daily sync at 9 AM
 * The schedule is defined here and will appear in the Trigger.dev dashboard
 */
export const dailyWhoopSync = schedules.task({
  id: "daily-whoop-sync",
  // Run every day at 9 AM
  cron: "0 9 * * *",
  // Reference the task to run
  run: async (payload) => {
    return await syncWhoopData.triggerAndWait({
      daysBack: 2,
    });
  },
});
