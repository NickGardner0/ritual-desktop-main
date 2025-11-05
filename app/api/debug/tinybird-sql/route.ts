import { NextResponse } from 'next/server';
import { tinybirdService } from '@/lib/tinybird-service';
import { logger } from '@/lib/logger';

/**
 * Debug endpoint to execute direct SQL queries against Tinybird
 * ⚠️ WARNING: This endpoint logs sensitive user data - should be disabled or protected in production
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('user_id') || '05cbe689-f7ec-487b-adb6-ad50c7dc767b';
    
    // Don't log userId in production
    logger.info('🔍 Debug SQL: Querying habit_logs (development only)');
    
    // Direct SQL query to check habit_logs data source
    const query = `
      SELECT 
        habit_id,
        habit_name,
        date,
        status,
        duration,
        amount,
        unit
      FROM habit_logs
      WHERE user_id = '${userId}'
      ORDER BY date DESC
      LIMIT 100
    `;
    
    // Execute SQL query
    const result = await tinybirdService.executeSql(query);
    
    logger.info('🔍 Debug SQL result:', 
      result?.data ? `Found ${result.data.length} logs` : 'No logs found');
    
    if (result?.data?.length > 0) {
      logger.debug('🔍 First log sample (development only)');
    }
    
    return NextResponse.json({
      sql: query,
      result: result
    });
  } catch (error) {
    logger.error('❌ Error in SQL debug endpoint:', error);
    return NextResponse.json(
      { error: 'Failed to execute SQL query' },
      { status: 500 }
    );
  }
}
