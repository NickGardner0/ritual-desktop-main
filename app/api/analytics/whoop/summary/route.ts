/**
 * Whoop Analytics API - Uses Tinybird for comprehensive Whoop data analysis
 * GET /api/analytics/whoop/summary?days_back=30
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { tinybirdService } from '@/lib/tinybird-service';

export async function GET(request: NextRequest) {
  try {
    // Get authenticated user from Clerk
    const { userId } = await auth();
    
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    const searchParams = request.nextUrl.searchParams;
    const daysBack = parseInt(searchParams.get('days_back') || '30');

    // Query Tinybird for comprehensive Whoop analytics using authenticated userId
    const analytics = await tinybirdService.getWhoopAnalytics(userId, daysBack);

    return NextResponse.json({
      success: true,
      data: analytics.data[0] || {},
      meta: {
        user_id: userId,
        days_back: daysBack,
        query_time_ms: analytics.statistics?.elapsed * 1000,
      }
    });

  } catch (error) {
    console.error('Whoop Analytics API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch Whoop analytics' },
      { status: 500 }
    );
  }
}

