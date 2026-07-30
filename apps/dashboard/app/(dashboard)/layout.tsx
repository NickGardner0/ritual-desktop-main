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
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { resolveDashboardActivationRedirect } from '@/lib/activation-flow.mjs';
import { serverBackendFetch } from '@/lib/api/server-client';
const FORCE_FRESH_COOKIE = 'ritual_force_fresh_until';
const DASHBOARD_BOOTSTRAP_TIMEOUT_MS = 8000;
const DASHBOARD_BOOTSTRAP_RECOVERY_ROUTE = '/auth/sso-callback?reason=dashboard-bootstrap';

function recordBootstrapFailure(reason: string, details?: Record<string, unknown>) {
  console.warn('[Ritual][dashboard-layout] bootstrap blocked dashboard', {
    reason,
    ...details,
  });

  Sentry.captureMessage('Dashboard bootstrap blocked dashboard', {
    level: 'warning',
    tags: {
      surface: 'dashboard-layout',
      reason,
    },
    extra: details,
  });
}

function recoverFromBootstrapFailure(reason: string, details?: Record<string, unknown>): never {
  recordBootstrapFailure(reason, details);
  redirect(DASHBOARD_BOOTSTRAP_RECOVERY_ROUTE);
}

async function assertDashboardActivation() {
  const clerkAuth = await auth();
  if (!clerkAuth.userId) {
    redirect('/sign-in');
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
    response = await serverBackendFetch('/api/user/bootstrap', {
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(forceFresh ? { 'X-Ritual-Force-Fresh': '1' } : {}),
      },
      signal: AbortSignal.timeout(DASHBOARD_BOOTSTRAP_TIMEOUT_MS),
    });
  } catch (error) {
    recoverFromBootstrapFailure('fetch_failed', {
      error: error instanceof Error ? error.message : String(error),
      errorName: error instanceof Error ? error.name : undefined,
      timeoutMs: DASHBOARD_BOOTSTRAP_TIMEOUT_MS,
    });
  }

  if (response.status === 401 || response.status === 403) {
    redirect('/sign-in');
  }

  if (!response.ok) {
    recoverFromBootstrapFailure('bad_status', {
      status: response.status,
      statusText: response.statusText,
    });
  }

  let bootstrap: { nextRoute?: unknown } | null = null;
  try {
    bootstrap = await response.json();
  } catch (error) {
    recoverFromBootstrapFailure('invalid_json', {
      error: error instanceof Error ? error.message : String(error),
    });
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
