/**
 * Enhanced Analytics Summary API - Uses updated Tinybird pipe with time comparisons
 * GET /api/analytics/habits/summary-enhanced?days_back=30
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { tinybirdService } from '@/lib/tinybird-service';

export const dynamic = 'force-dynamic';

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

    // Query enhanced Tinybird pipe with time-based comparisons
    const summary = await tinybirdService.getUserHabitsSummary(userId, daysBack);

    return NextResponse.json({
      success: true,
      data: summary.data,
      meta: {
        user_id: userId,
        days_back: daysBack,
        query_time_ms: summary.statistics?.elapsed * 1000,
      }
    });

  } catch (error) {
    console.error('Enhanced Summary API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch enhanced habit summary' },
      { status: 500 }
    );
  }
}

