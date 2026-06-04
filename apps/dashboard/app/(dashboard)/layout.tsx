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
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { resolveDashboardActivationRedirect } from '@/lib/activation-flow.mjs';

const PYTHON_API_URL = process.env.PYTHON_API_URL
  || process.env.NEXT_PUBLIC_PYTHON_API_URL
  || 'http://127.0.0.1:8000';
const FORCE_FRESH_COOKIE = 'ritual_force_fresh_until';

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

  const response = await fetch(`${PYTHON_API_URL}/api/user/bootstrap`, {
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(forceFresh ? { 'X-Ritual-Force-Fresh': '1' } : {}),
    },
  });

  if (response.status === 401 || response.status === 403) {
    redirect('/sign-in');
  }

  if (!response.ok) {
    throw new Error(`Bootstrap failed (${response.status})`);
  }

  const bootstrap = await response.json();
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
