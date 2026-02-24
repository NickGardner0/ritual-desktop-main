/**
 * Habit Streaks Analytics API - Uses Tinybird
 * GET /api/analytics/habits/streaks?habit_id=yyy
 * GET /api/analytics/habits/streaks?habit_ids=a,b,c
 * GET /api/analytics/habits/streaks (all habits with recent data)
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
    const habitId = searchParams.get('habit_id');
    const habitIdsParam = searchParams.get('habit_ids');

    if (habitId) {
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
          query_time_ms: streaks.statistics?.elapsed ? streaks.statistics.elapsed * 1000 : null,
        }
      });
    }

    let habitIds: string[] = [];

    if (habitIdsParam) {
      habitIds = habitIdsParam
        .split(',')
        .map(id => id.trim())
        .filter(Boolean);
    } else {
      const summary = await tinybirdService.getUserHabitsSummary(userId, 365);
      habitIds = Array.from(
        new Set(
          (summary.data || [])
            .map((row: any) => row?.habit_id)
            .filter((id: string | undefined): id is string => Boolean(id))
        )
      );
    }

    if (habitIds.length === 0) {
      return NextResponse.json({
        success: true,
        data: [],
        by_habit: {},
        meta: {
          user_id: userId,
          habits_count: 0,
        },
      });
    }

    const streakRows = await Promise.all(
      habitIds.map(async (id) => {
        try {
          const streak = await tinybirdService.getHabitStreaks(userId, id);
          return {
            habit_id: id,
            ...(streak.data?.[0] || {
              current_streak: 0,
              longest_streak: 0,
              weekly_streaks_count: 0,
              monthly_streaks_count: 0,
            }),
          };
        } catch (error) {
          console.error(`Failed to fetch streak for habit ${id}:`, error);
          return {
            habit_id: id,
            current_streak: 0,
            longest_streak: 0,
            weekly_streaks_count: 0,
            monthly_streaks_count: 0,
          };
        }
      })
    );

    const byHabit = streakRows.reduce<Record<string, any>>((acc, row) => {
      acc[row.habit_id] = row;
      return acc;
    }, {});

    return NextResponse.json({
      success: true,
      data: streakRows,
      by_habit: byHabit,
      meta: {
        user_id: userId,
        habits_count: streakRows.length,
      },
    });

  } catch (error) {
    console.error('Streaks API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch habit streaks' },
      { status: 500 }
    );
  }
}
