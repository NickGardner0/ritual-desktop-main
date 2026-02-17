/**
 * Habit Breakdown by Category API - Uses Turso database
 * GET /api/analytics/habits/breakdown?days_back=30
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // Get Clerk auth and token in one call
    const { userId: clerkUserId, getToken } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const requestedDaysBack = Number.parseInt(searchParams.get('days_back') || '30', 10);
    const daysBack = Number.isFinite(requestedDaysBack)
      ? Math.min(Math.max(requestedDaysBack, 1), 365)
      : 30;

    // Calculate date range - use local dates, not UTC
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);
    
    // Use local date components, NOT toISOString() which converts to UTC
    const formatLocalDate = (d: Date) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };
    const startDateStr = formatLocalDate(startDate);
    const endDateStr = formatLocalDate(endDate);

    // Query Python backend for habit logs with category info
    const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';
    const token = await getToken();
    
    const response = await fetch(
      `${backendUrl}/api/analytics/habits/breakdown?start_date=${startDateStr}&end_date=${endDateStr}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Backend returned ${response.status}`);
    }

    const data = await response.json();

    return NextResponse.json({
      success: true,
      data: data.breakdown || [],
      meta: {
        days_back: daysBack,
        start_date: startDateStr,
        end_date: endDateStr,
      }
    });

  } catch (error) {
    console.error('Breakdown API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch habit breakdown' },
      { status: 500 }
    );
  }
}
