'use client';

import { useEffect, useRef } from 'react';
import { useUser } from '@clerk/nextjs';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { UnifiedAnalyticsClient } from '@/components/analytics/unified-analytics-client';
import { BrailleSpinner } from '@/components/ui/braille-spinner';
import type { ViewMode } from '@/components/analytics/view-mode-toggle';
import { perfInfo } from '@/lib/perf-debug';

const DASHBOARD_RETURN_URL_KEY = 'ritual:dashboard-return-url:v1';

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
    if (!userLoaded || isSignedIn || signedOutRedirectStartedRef.current) {
      return;
    }

    signedOutRedirectStartedRef.current = true;

    const query = searchParams.toString();
    const returnUrl = query ? `${pathname}?${query}` : pathname;

    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(DASHBOARD_RETURN_URL_KEY, returnUrl);
    }

    perfInfo('client-dashboard', 'signed-out-dashboard-redirect', {
      initial_view_mode: initialViewMode,
      has_server_snapshot: Boolean(initialUserId),
    });

    router.replace('/sign-in');
  }, [initialUserId, initialViewMode, isSignedIn, pathname, router, searchParams, userLoaded]);

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
