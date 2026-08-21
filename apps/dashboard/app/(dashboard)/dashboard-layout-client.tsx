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
import { useRoutineScheduler } from '@/lib/routines/use-routine-scheduler';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

function RoutineSchedulerBridge() {
  useRoutineScheduler();
  return null;
}

export function DashboardLayoutClient({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  
  // Prefetch the current product shell on idle; hover prefetch covers the rest.
  useEffect(() => {
    const prefetch = () => {
      router.prefetch('/dashboard');
      router.prefetch('/chat');
    };
    if (typeof window.requestIdleCallback === 'function' && typeof window.cancelIdleCallback === 'function') {
      const idleId = window.requestIdleCallback(prefetch, { timeout: 2500 });
      return () => window.cancelIdleCallback(idleId);
    }
    const timer = window.setTimeout(prefetch, 1200);
    return () => window.clearTimeout(timer);
  }, [router]);
  
  return (
    <FontProvider>
    <SidebarModeProvider>
    <AIProvider>
      <DesktopRuntimeBridge />
      <RoutineSchedulerBridge />
      <DashboardLayout>
        {children}
      </DashboardLayout>
    </AIProvider>
    </SidebarModeProvider>
    </FontProvider>
  );
}
