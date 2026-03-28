import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

const TINYBIRD_BASE_URL = process.env.TINYBIRD_BASE_URL || 'https://api.us-east.aws.tinybird.co';
const TINYBIRD_TOKEN = process.env.TINYBIRD_TOKEN;

export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth();
    
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!TINYBIRD_TOKEN) {
      return NextResponse.json({ error: 'Tinybird not configured' }, { status: 500 });
    }

    // Fetch progress since start data from Tinybird
    const url = new URL(`${TINYBIRD_BASE_URL}/v0/pipes/habit_progress_since_start.json`);
    url.searchParams.set('user_id', userId);

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${TINYBIRD_TOKEN}`,
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Tinybird error:', errorText);
      return NextResponse.json({ error: 'Failed to fetch progress data' }, { status: 500 });
    }

    const data = await response.json();
    
    // Transform the data into a more usable format
    const progressByHabit: Record<string, {
      habit_id: string;
      habit_name: string;
      unit: string;
      first_date: string;
      last_date: string;
      total_days_tracked: number;
      first_period_avg_amount: number;
      first_period_avg_duration: number;
      first_period_days: number;
      last_period_avg_amount: number;
      last_period_avg_duration: number;
      last_period_days: number;
      amount_progress_pct: number;
      amount_absolute_change: number;
      duration_progress_pct: number;
      duration_absolute_change: number;
    }> = {};

    for (const row of data.data || []) {
      progressByHabit[row.habit_id] = {
        habit_id: row.habit_id,
        habit_name: row.habit_name,
        unit: row.unit,
        first_date: row.first_date,
        last_date: row.last_date,
        total_days_tracked: row.total_days_tracked,
        first_period_avg_amount: row.first_period_avg_amount,
        first_period_avg_duration: row.first_period_avg_duration,
        first_period_days: row.first_period_days,
        last_period_avg_amount: row.last_period_avg_amount,
        last_period_avg_duration: row.last_period_avg_duration,
        last_period_days: row.last_period_days,
        amount_progress_pct: row.amount_progress_pct,
        amount_absolute_change: row.amount_absolute_change,
        duration_progress_pct: row.duration_progress_pct,
        duration_absolute_change: row.duration_absolute_change,
      };
    }

    return NextResponse.json({
      success: true,
      data: progressByHabit,
      raw: data.data,
    });
  } catch (error) {
    console.error('Error fetching habit progress:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

