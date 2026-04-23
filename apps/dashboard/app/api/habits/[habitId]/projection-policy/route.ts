import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { API_CONFIG } from '@/lib/api-config';
import { buildBackendAuthHeaders } from '@/lib/server/backend-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type RouteContext = {
  params: Promise<{
    habitId: string;
  }>;
};

export async function GET(
  request: NextRequest,
  context: RouteContext,
) {
  try {
    const { userId, getToken } = await auth();
    const headerToken = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() || null;

    if (!userId && !headerToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = (await getToken()) || headerToken;
    const { habitId } = await context.params;
    const response = await fetch(
      `${API_CONFIG.PYTHON_API_URL}/api/habits/${habitId}/projection-policy`,
      {
        method: 'GET',
        headers: buildBackendAuthHeaders({ userId, token }),
        signal: AbortSignal.timeout(10000),
        cache: 'no-store',
      },
    );

    const payload = await response.text();
    if (!response.ok) {
      return NextResponse.json({ error: payload || 'Failed to fetch projection policy' }, { status: response.status });
    }

    return NextResponse.json(payload ? JSON.parse(payload) : {});
  } catch (error) {
    console.error('Error fetching habit projection policy:', error);
    return NextResponse.json({ error: 'Failed to fetch projection policy' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  context: RouteContext,
) {
  try {
    const { userId, getToken } = await auth();
    const headerToken = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() || null;

    if (!userId && !headerToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = (await getToken()) || headerToken;
    const { habitId } = await context.params;
    const body = await request.text();
    const response = await fetch(
      `${API_CONFIG.PYTHON_API_URL}/api/habits/${habitId}/projection-policy`,
      {
        method: 'PUT',
        headers: {
          ...buildBackendAuthHeaders({ userId, token }),
          'Content-Type': 'application/json',
        },
        body,
        signal: AbortSignal.timeout(10000),
        cache: 'no-store',
      },
    );

    const payload = await response.text();
    if (!response.ok) {
      return NextResponse.json({ error: payload || 'Failed to save projection policy' }, { status: response.status });
    }

    return NextResponse.json(payload ? JSON.parse(payload) : {});
  } catch (error) {
    console.error('Error saving habit projection policy:', error);
    return NextResponse.json({ error: 'Failed to save projection policy' }, { status: 500 });
  }
}
