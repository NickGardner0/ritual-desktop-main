import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { API_CONFIG } from '@/lib/api-config';
import { buildBackendAuthHeaders } from '@/lib/server/backend-auth';

export async function GET(request: NextRequest) {
  try {
    const { userId, getToken } = await auth();
    const headerToken = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() || null;

    if (!userId && !headerToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = (await getToken()) || headerToken;
    const response = await fetch(`${API_CONFIG.PYTHON_API_URL}/api/wearables/connections`, {
      method: 'GET',
      headers: buildBackendAuthHeaders({ userId, token }),
    });

    if (!response.ok) {
      if (response.status === 404) {
        return NextResponse.json({ connections: [] });
      }

      const error = await response.text();
      console.error('Failed to fetch wearable connections:', error);
      return NextResponse.json({ error: 'Failed to fetch wearable connections' }, { status: response.status });
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching wearable connections:', error);
    return NextResponse.json({ connections: [] });
  }
}
