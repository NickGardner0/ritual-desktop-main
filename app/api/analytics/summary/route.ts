import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

/**
 * GET /api/analytics/summary
 * Fetch analytics summary metrics from Tinybird
 * Returns: active days, avg entries/day, current streak, most consistent habit
 */
export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const tinybirdToken = process.env.TINYBIRD_TOKEN;
    const tinybirdUrl = process.env.TINYBIRD_API_URL || 'https://api.us-east.aws.tinybird.co';

    if (!tinybirdToken) {
      console.error('❌ TINYBIRD_TOKEN not configured');
      return NextResponse.json(
        { error: 'Analytics service not configured' },
        { status: 500 }
      );
    }

    // Query the analytics_summary pipe
    const url = `${tinybirdUrl}/v0/pipes/analytics_summary.json?user_id=${encodeURIComponent(userId)}`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${tinybirdToken}`,
      },
      next: { revalidate: 60 }, // Cache for 60 seconds
    });

    if (!response.ok) {
      console.error('❌ Tinybird query failed:', response.status, await response.text());
      return NextResponse.json(
        { error: 'Failed to fetch analytics summary' },
        { status: response.status }
      );
    }

    const data = await response.json();

    console.log('✅ Analytics summary fetched from Tinybird:', {
      userId,
      data: data.data?.[0],
      timestamp: new Date().toISOString(),
    });

    return NextResponse.json({
      success: true,
      data: data.data?.[0] || {
        active_days_30d: 0,
        avg_entries_per_day_30d: 0,
        current_streak_days: 0,
        most_consistent_habit_name: null,
        most_consistent_habit_pct: 0,
      },
    });

  } catch (error) {
    console.error('❌ Error in analytics summary endpoint:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

