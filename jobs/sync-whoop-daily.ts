import { task, schedules } from "@trigger.dev/sdk/v3";

/**
 * Daily Whoop Data Sync Job
 * 
 * Automatically syncs Whoop sleep, recovery, and workout data every morning at 9 AM.
 * This ensures sleep data from the previous night is synced after Whoop finishes processing it.
 */
export const syncWhoopDaily = task({
  id: "sync-whoop-daily",
  run: async (payload: { userId?: string }) => {
    const API_BASE_URL = process.env.PYTHON_API_URL || 'http://127.0.0.1:8000';
    
    console.log('🔄 Starting automated Whoop sync...');
    
    try {
      // If userId is provided, sync for that user
      // Otherwise, sync for all users with active Whoop connections
      if (payload.userId) {
        await syncWhoopForUser(payload.userId);
      } else {
        await syncAllWhoopUsers();
      }
      
      return {
        success: true,
        message: 'Whoop data synced successfully',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('❌ Error syncing Whoop data:', error);
      throw error;
    }
  },
});

/**
 * Scheduled task: Run every day at 9 AM
 */
export const dailyWhoopSync = schedules.task({
  id: "daily-whoop-sync-9am",
  cron: "0 9 * * *", // Every day at 9:00 AM (adjust timezone in Trigger.dev dashboard)
  task: syncWhoopDaily,
  payload: {}, // Sync all users
});

/**
 * Sync Whoop data for a specific user
 */
async function syncWhoopForUser(userId: string) {
  const API_BASE_URL = process.env.PYTHON_API_URL || 'http://127.0.0.1:8000';
  
  // You'll need to get an internal API key or use a service account token
  // For now, this would need to be called from the backend directly
  const response = await fetch(`${API_BASE_URL}/api/integrations/whoop/sync?user_id=${userId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Key': process.env.INTERNAL_API_KEY || '', // Add this to your .env
    },
  });
  
  if (!response.ok) {
    throw new Error(`Failed to sync Whoop data for user ${userId}: ${response.statusText}`);
  }
  
  const result = await response.json();
  console.log(`✅ Synced Whoop data for user ${userId}:`, result);
  return result;
}

/**
 * Sync Whoop data for all active users
 */
async function syncAllWhoopUsers() {
  const API_BASE_URL = process.env.PYTHON_API_URL || 'http://127.0.0.1:8000';
  
  // Get all users with active Whoop integrations
  const response = await fetch(`${API_BASE_URL}/api/integrations/whoop/sync-all`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Key': process.env.INTERNAL_API_KEY || '',
    },
  });
  
  if (!response.ok) {
    throw new Error(`Failed to sync Whoop data for all users: ${response.statusText}`);
  }
  
  const result = await response.json();
  console.log('✅ Synced Whoop data for all users:', result);
  return result;
}

