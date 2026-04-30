import { NextRequest, NextResponse } from 'next/server';

import { executeWorkflow } from '@/lib/workflows/executor';

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const expectedToken = process.env.INTERNAL_BACKEND_TOKEN?.trim() || '';
  const incomingToken = req.headers.get('x-backend-token')?.trim() || '';
  if (!expectedToken || incomingToken !== expectedToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const result = await executeWorkflow(body, incomingToken);
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (error) {
    console.error('[workflow-executor] error', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Workflow execution failed' },
      { status: 500 },
    );
  }
}
