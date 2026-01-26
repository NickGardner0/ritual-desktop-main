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
import { AIProvider } from '@/contexts/AIContext';
import { FontProvider } from '@/contexts/FontContext';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { setDashboardWindowSize } from '@/lib/tauri-utils';

export function DashboardLayoutClient({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  
  // Prefetch critical routes on mount for instant navigation
  useEffect(() => {
    router.prefetch('/dashboard');
    router.prefetch('/activity');
    router.prefetch('/analytics');
    router.prefetch('/chat');
    router.prefetch('/calendar');
    router.prefetch('/timer');
    router.prefetch('/integrations');
  }, [router]);

  // Resize window to dashboard size
  useEffect(() => {
    setDashboardWindowSize();
  }, []);
  
  return (
    <FontProvider>
    <AIProvider>
      <DashboardLayout>
        {children}
      </DashboardLayout>
    </AIProvider>
    </FontProvider>
  );
}

