/**
 * Tesla sync — proxies to Python backend to trigger odometer sync.
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const API_BASE = process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const resp = await fetch(`${API_BASE}/api/integrations/tesla/sync`, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
      },
    });
    const data = await resp.json();
    return NextResponse.json(data, { status: resp.status });
  } catch (error) {
    console.error('Tesla sync proxy error:', error);
    return NextResponse.json({ error: 'Failed to sync Tesla data' }, { status: 500 });
  }
}
