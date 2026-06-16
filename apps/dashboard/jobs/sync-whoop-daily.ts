import { schedules } from "@trigger.dev/sdk/v3";
import { triggerBackendFetch } from "@/lib/api/trigger-client";

/**
 * Daily Whoop Data Sync Job
 * 
 * Automatically syncs Whoop sleep, recovery, and workout data every morning at 9 AM.
 * This ensures sleep data from the previous night is synced after Whoop finishes processing it.
 */
export const syncWhoopDaily = schedules.task({
  id: "sync-whoop-daily",
  cron: "0 9 * * *", // Every day at 9:00 AM (set timezone in Trigger.dev dashboard)
  run: async () => {
    
    console.log('🔄 Starting automated Whoop sync...');
    
    try {
      // Scheduled sync always processes all users with active Whoop connections.
      await syncAllWhoopUsers();
      
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
 * Sync Whoop data for a specific user
 */
async function syncWhoopForUser(userId: string) {
  // You'll need to get an internal API key or use a service account token
  // For now, this would need to be called from the backend directly
  const response = await triggerBackendFetch(`/api/integrations/whoop/sync?user_id=${userId}`, {
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
  // Get all users with active Whoop integrations
  const response = await triggerBackendFetch('/api/integrations/whoop/sync-all', {
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
