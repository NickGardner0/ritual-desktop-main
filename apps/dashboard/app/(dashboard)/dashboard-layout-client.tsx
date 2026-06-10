/**
 * Dashboard Layout Client Wrapper
 * 
 * This wraps the client-only parts:
 * - AIProvider (uses context)
 * - FontProvider (for font preference)
 * - DashboardLayout (has interactive sidebar)
 * - Prefetching logic
 */

'use client';

import { DashboardLayout } from '@/components/dashboard-layout';
import { DesktopRuntimeBridge } from '@/components/desktop-runtime-bridge';
import { AIProvider } from '@/contexts/AIContext';
import { FontProvider } from '@/contexts/FontContext';
import { SidebarModeProvider } from '@/contexts/SidebarModeContext';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { restoreDashboardWindowSize, watchDashboardWindowSize } from '@/lib/tauri-utils';

export function DashboardLayoutClient({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  
  // Prefetch critical routes on mount for instant navigation
  useEffect(() => {
    router.prefetch('/dashboard');
    router.prefetch('/activity');
    router.prefetch('/analytics');
    router.prefetch('/chat');
    router.prefetch('/calendar');
    router.prefetch('/integrations');
  }, [router]);

  // Preserve user-resized dashboard windows instead of snapping to a fixed size.
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let cancelled = false;

    void (async () => {
      await restoreDashboardWindowSize();
      const unwatch = await watchDashboardWindowSize();
      if (cancelled) {
        unwatch();
        return;
      }
      cleanup = unwatch;
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);
  
  return (
    <FontProvider>
    <SidebarModeProvider>
    <AIProvider>
      <DesktopRuntimeBridge />
      <DashboardLayout>
        {children}
      </DashboardLayout>
    </AIProvider>
    </SidebarModeProvider>
    </FontProvider>
  );
}
