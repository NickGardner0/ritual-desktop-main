import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import * as Sentry from '@sentry/nextjs';
import { sentryStructuredLog } from '@/lib/sentry-structured-logger';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  Sentry.setUser({ id: userId });
  Sentry.setTag('runtime', body.runtime || 'web');
  Sentry.setTag('surface', body.surface || 'next-route');
  Sentry.setTag('route', '/api/sentry-smoke');
  if (body.desktop_version) Sentry.setTag('desktop_version', String(body.desktop_version));
  if (body.provider) Sentry.setTag('provider', String(body.provider));
  if (body.sync_run_id) Sentry.setTag('sync_run_id', String(body.sync_run_id));
  if (body.habit_id) Sentry.setTag('habit_id', String(body.habit_id));

  sentryStructuredLog('info', 'Sentry smoke structured log: next-route', {
    smoke_test: true,
    runtime: body.runtime || 'web',
    surface: body.surface || 'next-route',
    route: '/api/sentry-smoke',
    desktop_version: body.desktop_version ? String(body.desktop_version) : undefined,
    provider: body.provider ? String(body.provider) : undefined,
    sync_run_id: body.sync_run_id ? String(body.sync_run_id) : undefined,
    habit_id: body.habit_id ? String(body.habit_id) : undefined,
  });
  Sentry.captureMessage('Sentry smoke test: next-route', {
    level: 'info',
    tags: {
      smoke_test: 'true',
    },
  });
  await Sentry.flush(2000).catch(() => undefined);

  return NextResponse.json({ success: true, message: 'Next.js Sentry smoke event queued' });
}
