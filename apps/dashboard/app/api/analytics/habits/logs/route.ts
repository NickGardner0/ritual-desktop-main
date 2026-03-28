import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

/**
 * GET /api/analytics/habits/logs
 * Fetch individual habit logs for a date range from Tinybird
 * Query params: habit_id (optional), start_date, end_date, limit (optional)
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

    const { searchParams } = new URL(request.url);
    const habitId = searchParams.get('habit_id');
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');
    const rawLimit = Number.parseInt(searchParams.get('limit') || '1000', 10);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 1000) : 1000;

    if (!startDate || !endDate) {
      return NextResponse.json(
        { error: 'start_date and end_date are required' },
        { status: 400 }
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

    // Build query params
    const params = new URLSearchParams({
      user_id: userId,
      start_date: startDate,
      end_date: endDate,
      limit: String(limit),
    });

    if (habitId) {
      params.append('habit_id', habitId);
    }

    const url = `${tinybirdUrl}/v0/pipes/habit_logs_time_range.json?${params.toString()}`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${tinybirdToken}`,
      },
      next: { revalidate: 30 }, // Cache for 30 seconds
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      console.error('❌ Tinybird query failed:', response.status, await response.text());
      return NextResponse.json(
        { error: 'Failed to fetch habit logs' },
        { status: response.status }
      );
    }

    const data = await response.json();

    console.log('✅ Habit logs fetched from Tinybird:', {
      userId,
      habitId,
      dateRange: `${startDate} to ${endDate}`,
      logsCount: data.data?.length || 0,
      timestamp: new Date().toISOString(),
    });

    return NextResponse.json({
      success: true,
      data: data.data || [],
    });

  } catch (error) {
    console.error('❌ Error in habit logs endpoint:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
