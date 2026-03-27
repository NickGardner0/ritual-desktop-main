import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { API_CONFIG } from '@/lib/api-config';
import { buildBackendAuthHeaders } from '@/lib/server/backend-auth';

/**
 * GET /api/watcher/devices
 * List all watcher devices for the current user
 */
export async function GET(request: NextRequest) {
  try {
    const { userId, getToken } = await auth();
    const headerToken = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() || null;

    if (!userId && !headerToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = (await getToken()) || headerToken;

    const response = await fetch(`${API_CONFIG.PYTHON_API_URL}/api/watcher/devices`, {
      method: 'GET',
      headers: buildBackendAuthHeaders({ userId, token }),
    });

    if (!response.ok) {
      // If no devices exist yet, return empty array instead of error
      if (response.status === 404) {
        return NextResponse.json({ devices: [] });
      }
      const error = await response.text();
      console.error('Failed to list devices:', error);
      return NextResponse.json({ error: 'Failed to list devices' }, { status: response.status });
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error listing watcher devices:', error);
    // Return empty devices array on error to avoid breaking the UI
    return NextResponse.json({ devices: [] });
  }
}

/**
 * POST /api/watcher/devices
 * Register a new watcher device
 */
export async function POST(request: NextRequest) {
  try {
    const { userId, getToken } = await auth();
    const headerToken = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() || null;

    if (!userId && !headerToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = (await getToken()) || headerToken;
    const body = await request.json();

    const response = await fetch(`${API_CONFIG.PYTHON_API_URL}/api/watcher/devices`, {
      method: 'POST',
      headers: buildBackendAuthHeaders({ userId, token }),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Failed to register device:', error);
      return NextResponse.json({ error: 'Failed to register device' }, { status: response.status });
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error registering watcher device:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
