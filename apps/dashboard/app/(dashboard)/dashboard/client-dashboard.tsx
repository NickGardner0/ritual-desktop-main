'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useUser } from '@clerk/nextjs';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { UnifiedAnalyticsClient } from '@/components/analytics/unified-analytics-client';
import { BrailleSpinner } from '@/components/ui/braille-spinner';
import type { ViewMode } from '@/components/analytics/view-mode-toggle';
import { perfInfo } from '@/lib/perf-debug';

const DASHBOARD_RETURN_URL_KEY = 'ritual:dashboard-return-url:v1';
const DESKTOP_AUTH_LOAD_TIMEOUT_MS = 6_000;

function isDesktopDashboardRuntime(): boolean {
  if (typeof window === 'undefined') return false;

  const userAgent = window.navigator.userAgent || '';
  const params = new URLSearchParams(window.location.search);
  return userAgent.includes('RitualDesktop/') || params.has('ritual_desktop_env');
}

export function ClientDashboard({
  initialViewMode,
  initialUserId,
}: {
  initialViewMode: ViewMode;
  initialUserId: string | null;
}) {
  const signedOutRedirectStartedRef = useRef(false);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { isLoaded: userLoaded, isSignedIn } = useUser();
  const startSignInRedirect = useCallback((reason: 'signed-out' | 'auth-timeout') => {
    if (signedOutRedirectStartedRef.current) {
      return;
    }

    signedOutRedirectStartedRef.current = true;

    const query = searchParams.toString();
    const returnUrl = query ? `${pathname}?${query}` : pathname;

    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(DASHBOARD_RETURN_URL_KEY, returnUrl);
    }

    perfInfo('client-dashboard', 'signed-out-dashboard-redirect', {
      reason,
      initial_view_mode: initialViewMode,
      has_server_snapshot: Boolean(initialUserId),
    });

    router.replace('/sign-in');
  }, [initialUserId, initialViewMode, pathname, router, searchParams]);

  useEffect(() => {
    const mountTime = typeof performance !== 'undefined' ? performance.now() : Date.now();

    perfInfo('client-dashboard', 'mount', {
      initial_view_mode: initialViewMode,
      has_server_snapshot: Boolean(initialUserId),
      initial_user_id: initialUserId,
    });

    let frame1 = 0;
    let frame2 = 0;
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      frame1 = window.requestAnimationFrame(() => {
        frame2 = window.requestAnimationFrame(() => {
          const end = typeof performance !== 'undefined' ? performance.now() : Date.now();
          perfInfo('client-dashboard', 'first-shell-frame', {
            duration_ms: Number((end - mountTime).toFixed(2)),
            initial_view_mode: initialViewMode,
          });
        });
      });
    }

    return () => {
      if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
        if (frame1) window.cancelAnimationFrame(frame1);
        if (frame2) window.cancelAnimationFrame(frame2);
      }
    };
  }, [initialUserId, initialViewMode]);

  useEffect(() => {
    if (!userLoaded || isSignedIn) {
      return;
    }

    startSignInRedirect('signed-out');
  }, [isSignedIn, startSignInRedirect, userLoaded]);

  useEffect(() => {
    if (userLoaded || isSignedIn || !isDesktopDashboardRuntime()) {
      return;
    }

    const timer = window.setTimeout(() => {
      startSignInRedirect('auth-timeout');
    }, DESKTOP_AUTH_LOAD_TIMEOUT_MS);

    return () => window.clearTimeout(timer);
  }, [isSignedIn, startSignInRedirect, userLoaded]);

  if (userLoaded && !isSignedIn) {
    return (
      <div className="flex min-h-[420px] items-center justify-center">
        <BrailleSpinner className="text-2xl text-gray-900" />
      </div>
    );
  }

  return (
    <UnifiedAnalyticsClient
      initialViewMode={initialViewMode}
      initialUserId={initialUserId}
    />
  );
}
