import { NextResponse } from 'next/server';
import { tinybirdService } from '@/lib/tinybird-service';
import { logger } from '@/lib/logger';

/**
 * Debug endpoint to directly query Tinybird logs
 * ⚠️ WARNING: This endpoint logs sensitive user data - should be disabled or protected in production
 */
export async function GET() {
  try {
    // For debugging purposes, use a hardcoded user ID from the logs
    // This is just for debugging and should be removed in production
    const userId = '05cbe689-f7ec-487b-adb6-ad50c7dc767b'; // From your logs
    logger.info('🔍 Debug: Using user ID for debugging (development only)');
    
    // Direct SQL query to Tinybird
    const result = await tinybirdService.queryPipe('user_habits_summary', {
      user_id: userId,
      days_back: 30
    });
    
    logger.info('🔍 Debug: user_habits_summary response received');
    
    // Also get raw logs
    const rawLogs = await tinybirdService.queryPipe('recent_habit_logs', {
      user_id: userId,
      days_back: 30,
      limit: 100
    });
    
    logger.info('🔍 Debug: recent_habit_logs response:', 
      rawLogs?.data ? `Found ${rawLogs.data.length} logs` : 'No logs found');
    
    if (rawLogs?.data?.length > 0) {
      logger.debug('🔍 First log sample (development only)');
    }
    
    return NextResponse.json({
      summary: result,
      rawLogs: rawLogs
    });
  } catch (error) {
    logger.error('❌ Error in debug endpoint:', error);
    return NextResponse.json(
      { error: 'Failed to query Tinybird' },
      { status: 500 }
    );
  }
}