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
import { createServerBackendClient } from '@/lib/api/server-client';
import { BackendClientError } from '@/lib/api/generated/backend-client';
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

  let bootstrap: { nextRoute?: unknown } | null = null;
  try {
    const client = createServerBackendClient(() => ({
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(forceFresh ? { 'X-Ritual-Force-Fresh': '1' } : {}),
    }));
    bootstrap = await client.requestOperation('get_user_bootstrap_api_user_bootstrap_get', {
      signal: AbortSignal.timeout(DASHBOARD_BOOTSTRAP_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof BackendClientError && (error.status === 401 || error.status === 403)) {
      redirect('/sign-in');
    }
    recoverFromBootstrapFailure(
      error instanceof BackendClientError
        ? 'bad_status'
        : error instanceof SyntaxError
          ? 'invalid_json'
          : 'fetch_failed',
      error instanceof BackendClientError
        ? { status: error.status }
        : {
            error: error instanceof Error ? error.message : String(error),
            errorName: error instanceof Error ? error.name : undefined,
            timeoutMs: DASHBOARD_BOOTSTRAP_TIMEOUT_MS,
          },
    );
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
