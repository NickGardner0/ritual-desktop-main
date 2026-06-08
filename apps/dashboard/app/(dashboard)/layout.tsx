/**
 * Dashboard Layout - Server Component
 * 
 * CRITICAL: This must be a Server Component (NO 'use client')
 * to allow child pages to be Server Components.
 * 
 * We wrap client-only parts in a separate client component.
 */

import { DashboardLayoutClient } from './dashboard-layout-client';
import { auth } from '@clerk/nextjs/server';
import * as Sentry from '@sentry/nextjs';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { resolveDashboardActivationRedirect } from '@/lib/activation-flow.mjs';

const PYTHON_API_URL = process.env.PYTHON_API_URL
  || process.env.NEXT_PUBLIC_PYTHON_API_URL
  || 'http://127.0.0.1:8000';
const FORCE_FRESH_COOKIE = 'ritual_force_fresh_until';
const DESKTOP_USER_AGENT_FRAGMENT = 'RitualDesktop/';
const DASHBOARD_BOOTSTRAP_TIMEOUT_MS = 2500;

function recordBootstrapFailure(reason: string, details?: Record<string, unknown>) {
  console.warn('[Ritual][dashboard-layout] bootstrap skipped', {
    reason,
    ...details,
  });

  Sentry.captureMessage('Dashboard bootstrap skipped', {
    level: 'warning',
    tags: {
      surface: 'dashboard-layout',
      reason,
    },
    extra: details,
  });
}

async function assertDashboardActivation() {
  const clerkAuth = await auth();
  if (!clerkAuth.userId) {
    redirect('/sign-in');
  }

  const headerStore = await headers();
  const userAgent = headerStore.get('user-agent') ?? '';
  const isDesktopRequest = userAgent.includes(DESKTOP_USER_AGENT_FRAGMENT);

  // Desktop launch should not depend on the Railway activation bootstrap before
  // first paint. If the backend is slow, the dashboard can still hydrate from
  // client-side caches and refetch after the app is visible.
  if (isDesktopRequest) {
    return;
  }

  const token = await clerkAuth.getToken();
  if (!token) {
    redirect('/sign-in');
  }

  const cookieStore = await cookies();
  const forceFreshUntil = Number(cookieStore.get(FORCE_FRESH_COOKIE)?.value ?? 0);
  const forceFresh = Number.isFinite(forceFreshUntil) && forceFreshUntil > Date.now();

  let response: Response;
  try {
    response = await fetch(`${PYTHON_API_URL}/api/user/bootstrap`, {
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(forceFresh ? { 'X-Ritual-Force-Fresh': '1' } : {}),
      },
      signal: AbortSignal.timeout(DASHBOARD_BOOTSTRAP_TIMEOUT_MS),
    });
  } catch (error) {
    recordBootstrapFailure('fetch_failed', {
      error: error instanceof Error ? error.message : String(error),
      errorName: error instanceof Error ? error.name : undefined,
      timeoutMs: DASHBOARD_BOOTSTRAP_TIMEOUT_MS,
    });
    return;
  }

  if (response.status === 401 || response.status === 403) {
    redirect('/sign-in');
  }

  if (!response.ok) {
    recordBootstrapFailure('bad_status', {
      status: response.status,
      statusText: response.statusText,
    });
    return;
  }

  let bootstrap: { nextRoute?: unknown } | null = null;
  try {
    bootstrap = await response.json();
  } catch (error) {
    recordBootstrapFailure('invalid_json', {
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  const redirectRoute = resolveDashboardActivationRedirect(bootstrap?.nextRoute);
  if (redirectRoute) {
    redirect(redirectRoute);
  }
}

export default async function SharedDashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await assertDashboardActivation();

  return (
    <DashboardLayoutClient>
      {children}
    </DashboardLayoutClient>
  );
}
