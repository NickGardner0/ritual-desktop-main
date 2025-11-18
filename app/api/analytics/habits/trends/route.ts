/**
 * Habit Trends Analytics API - Uses Tinybird for time-series trends
 * GET /api/analytics/habits/trends?period=day&days_back=30&habit_id=yyy
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
    const period = (searchParams.get('period') || 'day') as 'day' | 'week';
    const daysBack = parseInt(searchParams.get('days_back') || '30');
    const habitId = searchParams.get('habit_id') || undefined;

    // Query Tinybird for habit trends using authenticated userId
    const trends = await tinybirdService.getHabitTrends(userId, period, daysBack, habitId);

    return NextResponse.json({
      success: true,
      data: trends.data,
      meta: {
        user_id: userId,
        period: period,
        days_back: daysBack,
        habit_id: habitId,
        query_time_ms: trends.statistics?.elapsed * 1000,
      }
    });

  } catch (error) {
    console.error('Trends API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch habit trends' },
      { status: 500 }
    );
  }
}

