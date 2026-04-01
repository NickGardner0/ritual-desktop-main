/**
 * Tesla integration status — proxies to Python backend.
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const API_BASE = process.env.NEXT_PUBLIC_PYTHON_API_URL || 'http://127.0.0.1:8000';

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const resp = await fetch(`${API_BASE}/api/integrations/tesla/status`, {
      headers: { Authorization: authHeader },
    });
    const data = await resp.json();
    return NextResponse.json(data, { status: resp.status });
  } catch (error) {
    console.error('Tesla status proxy error:', error);
    return NextResponse.json({ error: 'Failed to check Tesla status' }, { status: 500 });
  }
}
