import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { API_CONFIG } from '@/lib/api-config';
import { buildBackendAuthHeaders } from '@/lib/server/backend-auth';

type RouteContext = {
  params: Promise<{
    deviceId: string;
  }>;
};

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const { userId, getToken } = await auth();
    const headerToken = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() || null;

    if (!userId && !headerToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = (await getToken()) || headerToken;
    const { deviceId } = await context.params;
    const body = await request.json();

    const response = await fetch(`${API_CONFIG.PYTHON_API_URL}/api/watcher/devices/${deviceId}/settings`, {
      method: 'PUT',
      headers: buildBackendAuthHeaders({ userId, token }),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`Failed to update watcher device ${deviceId} settings:`, error);
      return NextResponse.json({ error: 'Failed to update watcher settings' }, { status: response.status });
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error updating watcher settings:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
