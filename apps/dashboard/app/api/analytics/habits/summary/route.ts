import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

/**
 * GET /api/analytics/habits/summary
 * Fetch per-habit summary metrics from Tinybird with period-over-period comparisons
 * 
 * Supports TWO modes:
 * 1. Default (no dates): Uses user_habits_summary pipe (last 7 days vs previous 7 days)
 * 2. Custom date range: Uses habit_period_comparison pipe (selected period vs previous equal period)
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

    const searchParams = request.nextUrl.searchParams;
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');
    const requestedDaysBack = Number.parseInt(searchParams.get('days_back') || '30', 10);
    const daysBack = Number.isFinite(requestedDaysBack)
      ? String(Math.min(Math.max(requestedDaysBack, 1), 365))
      : '30';

    let url: string;
    let useCustomRange = false;

    // If custom date range is provided, use the habit_period_comparison pipe
    if (startDate && endDate) {
      useCustomRange = true;
      url = `${tinybirdUrl}/v0/pipes/habit_period_comparison.json?user_id=${encodeURIComponent(userId)}&start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}`;
      console.log('📊 Using custom date range comparison:', { startDate, endDate });
    } else {
      // Default: use user_habits_summary (fixed 7-day/30-day comparisons)
      url = `${tinybirdUrl}/v0/pipes/user_habits_summary.json?user_id=${encodeURIComponent(userId)}&days_back=${daysBack}`;
      console.log('📊 Using default 7-day comparison');
    }

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${tinybirdToken}`,
      },
      next: { revalidate: 60 }, // Cache for 60 seconds
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      console.error('❌ Tinybird query failed:', response.status, await response.text());
      return NextResponse.json(
        { error: 'Failed to fetch habits summary' },
        { status: response.status }
      );
    }

    const data = await response.json();

    console.log('✅ Habits summary fetched from Tinybird:', {
      userId,
      habitsCount: data.data?.length || 0,
      useCustomRange,
      timestamp: new Date().toISOString(),
      sampleHabitKeys: data.data?.[0] ? Object.keys(data.data[0]) : [],
    });

    // Transform based on which pipe was used
    let habitsSummary;
    
    if (useCustomRange) {
      // habit_period_comparison pipe response format (FIRST DAY → LAST DAY comparison)
      habitsSummary = (data.data || []).map((habit: any) => ({
        habit_id: habit.habit_id,
        habit_name: habit.habit_name,
        unit: habit.unit,
        
        // First day values (start of selected period)
        first_date: habit.first_date,
        first_day_amount: habit.first_day_amount || 0,
        first_day_duration: habit.first_day_duration || 0,
        
        // Last day values (end of selected period)
        last_date: habit.last_date,
        last_day_amount: habit.last_day_amount || 0,
        last_day_duration: habit.last_day_duration || 0,
        
        // Period totals
        days_with_data: habit.days_with_data || 0,
        total_amount: habit.total_amount || 0,
        total_duration: habit.total_duration || 0,
        avg_amount: habit.avg_amount || 0,
        avg_duration: habit.avg_duration || 0,
        
        // ✅ FIRST → LAST percentage changes from Tinybird!
        // Example: Dec 4 (5.7h) → Dec 6 (8.2h) = +43.9%
        amount_change_pct: habit.amount_change_pct || 0,
        duration_change_pct: habit.duration_change_pct || 0,
        amount_absolute_change: habit.amount_absolute_change || 0,
        duration_absolute_change: habit.duration_absolute_change || 0,
        
        // Unified field names for frontend (maps to custom period values)
        weekly_amount_change_pct: habit.amount_change_pct || 0, // Map to common name for compatibility
        
        // Period info
        period_start: habit.period_start,
        period_end: habit.period_end,
        period_days: habit.period_days,
      }));
    } else {
      // user_habits_summary pipe response format (default)
      // Tinybird returns clean column names: habit_id, habit_name, etc.
      habitsSummary = (data.data || []).map((habit: any) => ({
        habit_id: habit.habit_id,
        habit_name: habit.habit_name,
        unit: habit.unit,
        
        // Overall stats
        total_logs: habit.total_logs,
        completed_count: habit.completed_count,
        days_with_data: habit.days_with_data,
        total_amount: habit.total_amount,
        avg_amount: habit.avg_amount,
        
        // Last 7 days
        last_7_days_avg: habit.last_7_days_avg || 0,
        last_7_days_amount: habit.last_7_days_amount || 0,
        last_7_days_count: habit.last_7_days_count || 0,
        last_7_days_with_data: habit.last_7_days_with_data || 0,
        
        // Previous 7 days (for comparison)
        prev_7_days_avg: habit.prev_7_days_avg || 0,
        prev_7_days_count: habit.prev_7_days_count || 0,
        prev_7_days_with_data: habit.prev_7_days_with_data || 0,
        
        // Pre-calculated percentage changes from Tinybird!
        weekly_amount_change_pct: habit.weekly_amount_change_pct || 0,
        weekly_days_change_pct: habit.weekly_days_change_pct || 0,
        
        // Last 30 days
        last_30_days_avg: habit.last_30_days_avg || 0,
        last_30_days_amount: habit.last_30_days_amount || 0,
        monthly_amount_change_pct: habit.monthly_amount_change_pct || 0,
        monthly_days_change_pct: habit.monthly_days_change_pct || 0,
        
        // Metadata
        last_completed_date: habit.last_completed_date,
        first_log_date: habit.first_log_date,
      }));
    }

    return NextResponse.json({
      success: true,
      useCustomRange,
      data: habitsSummary,
    });

  } catch (error) {
    console.error('❌ Error in habits summary endpoint:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
