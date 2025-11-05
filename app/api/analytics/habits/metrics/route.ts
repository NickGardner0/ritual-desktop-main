import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { tinybirdService } from '@/lib/tinybird-service';

/**
 * API route to get habit metrics from Tinybird
 * Uses Clerk for authentication
 */
export async function GET(req: NextRequest) {
  try {
    // Get authenticated user from Clerk
    const { userId } = await auth();
    
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    // Use authenticated userId, not request parameter
    const searchParams = req.nextUrl.searchParams;
    const habitId = searchParams.get('habit_id');
    const daysBack = parseInt(searchParams.get('days_back') || '30');
    
    // Get habit metrics from Tinybird
    let metricsData;
    
    if (habitId) {
      // Get metrics for a specific habit
      metricsData = await tinybirdService.getHabitTrends(
        userId,
        'day',
        daysBack,
        habitId
      );
    } else {
      // Get summary for all habits
      metricsData = await tinybirdService.getUserHabitsSummary(
        userId,
        daysBack
      );
    }
    
    return NextResponse.json(metricsData);
  } catch (error) {
    console.error('Error fetching habit metrics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch habit metrics' },
      { status: 500 }
    );
  }
}
