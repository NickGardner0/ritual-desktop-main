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
  
  // Prefetch critical routes on mount for instant navigation
  useEffect(() => {
    router.prefetch('/dashboard');
    router.prefetch('/activity');
    router.prefetch('/analytics');
    router.prefetch('/chat');
    router.prefetch('/calendar');
    router.prefetch('/tasks');
    router.prefetch('/routines');
    router.prefetch('/integrations');
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
