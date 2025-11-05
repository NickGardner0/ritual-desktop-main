/**
 * Habit Streaks Analytics API - Uses Tinybird
 * GET /api/analytics/habits/streaks?habit_id=yyy
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
    const habitId = searchParams.get('habit_id');

    if (!habitId) {
      return NextResponse.json(
        { error: 'habit_id parameter is required' },
        { status: 400 }
      );
    }

    // Query Tinybird for streak calculation using authenticated userId
    const streaks = await tinybirdService.getHabitStreaks(userId, habitId);

    return NextResponse.json({
      success: true,
      data: streaks.data[0] || {
        current_streak: 0,
        longest_streak: 0,
        weekly_streaks_count: 0,
        monthly_streaks_count: 0,
      },
      meta: {
        user_id: userId,
        habit_id: habitId,
        query_time_ms: streaks.statistics?.elapsed * 1000,
      }
    });

  } catch (error) {
    console.error('Streaks API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch habit streaks' },
      { status: 500 }
    );
  }
}

