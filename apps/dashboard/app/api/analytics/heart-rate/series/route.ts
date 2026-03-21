import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

export const dynamic = 'force-dynamic';

const TINYBIRD_URL = process.env.TINYBIRD_API_URL || 'https://api.us-east.aws.tinybird.co';
const ALLOWED_BUCKETS = new Set(['1m', 'hour', 'day']);

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
    const sourceType = searchParams.get('source_type');
    const bucket = (searchParams.get('bucket') || 'day').toLowerCase();

    if (!ALLOWED_BUCKETS.has(bucket)) {
      return NextResponse.json({ error: 'Invalid bucket. Use 1m, hour, or day.' }, { status: 400 });
    }

    const requestedDaysBack = Number.parseInt(searchParams.get('days_back') || '30', 10);
    const daysBack = Number.isFinite(requestedDaysBack)
      ? Math.min(Math.max(requestedDaysBack, 1), 1825)
      : 30;

    const params = new URLSearchParams({
      user_id: userId,
      bucket,
    });

    if (sourceType) {
      params.set('source_type', sourceType);
    }

    if (startDate && endDate) {
      params.set('start_date', startDate);
      params.set('end_date', endDate);
    } else {
      params.set('days_back', String(daysBack));
    }

    const url = `${TINYBIRD_URL}/v0/pipes/heart_rate_series.json?${params.toString()}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${tinybirdToken}`,
      },
      next: { revalidate: 30 },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('heart_rate_series Tinybird error:', response.status, errorText);
      return NextResponse.json({ error: 'Failed to fetch heart-rate series' }, { status: response.status });
    }

    const payload = await response.json();
    return NextResponse.json({
      success: true,
      bucket,
      data: payload.data || [],
    });
  } catch (error) {
    console.error('Error fetching heart-rate series:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
