import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

export const dynamic = 'force-dynamic';

const TINYBIRD_URL = process.env.TINYBIRD_API_URL || 'https://api.us-east.aws.tinybird.co';

export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const tinybirdToken = process.env.TINYBIRD_TOKEN;
    if (!tinybirdToken) {
      return NextResponse.json({ error: 'Analytics service not configured' }, { status: 500 });
    }

    const searchParams = request.nextUrl.searchParams;
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');
    const habitId = searchParams.get('habit_id');

    const requestedDaysBack = Number.parseInt(searchParams.get('days_back') || '30', 10);
    const daysBack = Number.isFinite(requestedDaysBack)
      ? Math.min(Math.max(requestedDaysBack, 1), 1825)
      : 30;

    const params = new URLSearchParams({
      user_id: userId,
    });

    if (habitId) {
      params.set('habit_id', habitId);
    }

    if (startDate && endDate) {
      params.set('start_date', startDate);
      params.set('end_date', endDate);
    } else {
      params.set('days_back', String(daysBack));
    }

    const url = `${TINYBIRD_URL}/v0/pipes/habit_health_scores.json?${params.toString()}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${tinybirdToken}`,
      },
      next: { revalidate: 30 },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('habit_health_scores Tinybird error:', response.status, errorText);
      return NextResponse.json({ error: 'Failed to fetch health/risk scores' }, { status: response.status });
    }

    const payload = await response.json();
    const rows = payload.data || [];

    const byHabit: Record<string, any> = {};
    for (const row of rows) {
      if (row?.habit_id) {
        byHabit[row.habit_id] = row;
      }
    }

    return NextResponse.json({
      success: true,
      data: rows,
      by_habit: byHabit,
      meta: {
        user_id: userId,
        habit_id: habitId,
        start_date: startDate,
        end_date: endDate,
        days_back: startDate && endDate ? null : daysBack,
        rows: rows.length,
      },
    });
  } catch (error) {
    console.error('Error fetching habit health/risk scores:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
