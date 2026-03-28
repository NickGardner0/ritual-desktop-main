import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

/**
 * GET /api/analytics/correlation
 * 
 * Calculate Pearson correlation between two habits from Tinybird
 * Returns correlation coefficient, strength, and direction
 * 
 * Query params:
 * - habit1_id: First habit ID (required)
 * - habit2_id: Second habit ID (required)
 * - days_back: (optional) Number of days to analyze (default: 90)
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
    const habit1Id = searchParams.get('habit1_id');
    const habit2Id = searchParams.get('habit2_id');
    const rawDaysBack = Number.parseInt(searchParams.get('days_back') || '90', 10);
    const daysBack = Number.isFinite(rawDaysBack)
      ? String(Math.min(Math.max(rawDaysBack, 7), 365))
      : '90';

    if (!habit1Id || !habit2Id) {
      return NextResponse.json(
        { error: 'Both habit1_id and habit2_id are required' },
        { status: 400 }
      );
    }

    if (habit1Id === habit2Id) {
      return NextResponse.json(
        { error: 'Cannot calculate correlation between the same habit' },
        { status: 400 }
      );
    }

    const params = new URLSearchParams({
      user_id: userId,
      habit1_id: habit1Id,
      habit2_id: habit2Id,
      days_back: daysBack,
    });

    const url = `${tinybirdUrl}/v0/pipes/habit_correlation.json?${params.toString()}`;

    console.log('📊 Fetching correlation:', { habit1Id, habit2Id, daysBack });

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${tinybirdToken}`,
      },
      next: { revalidate: 120 }, // Cache for 2 minutes (correlation doesn't change frequently)
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Tinybird correlation query failed:', response.status, errorText);
      return NextResponse.json(
        { error: 'Failed to calculate correlation' },
        { status: response.status }
      );
    }

    const data = await response.json();
    const result = data.data?.[0];

    if (!result) {
      return NextResponse.json({
        success: false,
        error: 'No overlapping data found between these habits',
      });
    }

    // Generate human-readable interpretation
    const interpretation = generateInterpretation(
      result.correlation,
      result.strength,
      result.direction,
      result.habit1_name,
      result.habit2_name
    );

    console.log('✅ Correlation calculated:', {
      correlation: result.correlation,
      strength: result.strength,
      sampleSize: result.sample_size,
    });

    return NextResponse.json({
      success: true,
      data: {
        habit1: {
          id: result.habit1_id,
          name: result.habit1_name,
          mean: result.habit1_mean,
        },
        habit2: {
          id: result.habit2_id,
          name: result.habit2_name,
          mean: result.habit2_mean,
        },
        correlation: {
          coefficient: Math.round(result.correlation * 1000) / 1000,
          strength: result.strength,
          direction: result.direction,
          interpretation,
        },
        sampleSize: result.sample_size,
        status: result.status,
      },
    });

  } catch (error) {
    console.error('❌ Error in correlation endpoint:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

function generateInterpretation(
  r: number,
  strength: string,
  direction: string,
  habit1Name: string,
  habit2Name: string
): string {
  if (strength === 'insufficient_data') {
    return `Not enough overlapping data to determine a relationship between ${habit1Name} and ${habit2Name}. Need at least 7 days where both are logged.`;
  }

  if (strength === 'negligible') {
    return `No significant relationship found between ${habit1Name} and ${habit2Name}.`;
  }

  const absR = Math.abs(r);
  const strengthWord = strength === 'strong' ? 'strong' : strength === 'moderate' ? 'moderate' : 'weak';

  if (direction === 'positive') {
    return `There is a ${strengthWord} positive correlation (r=${r.toFixed(2)}). On days with more ${habit1Name}, you tend to have more ${habit2Name}.`;
  } else if (direction === 'negative') {
    return `There is a ${strengthWord} negative correlation (r=${r.toFixed(2)}). On days with more ${habit1Name}, you tend to have less ${habit2Name}.`;
  }

  return `No clear directional relationship between ${habit1Name} and ${habit2Name}.`;
}
