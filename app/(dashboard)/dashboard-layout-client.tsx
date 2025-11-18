/**
 * Dashboard Layout Client Wrapper
 * 
 * This wraps the client-only parts:
 * - AIProvider (uses context)
 * - DashboardLayout (has interactive sidebar)
 * - Prefetching logic
 */

'use client';

import { DashboardLayout } from '@/components/dashboard-layout';
import { AIProvider } from '@/contexts/AIContext';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export function DashboardLayoutClient({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  
  // Prefetch critical routes on mount for instant navigation
  useEffect(() => {
    router.prefetch('/dashboard');
    router.prefetch('/analytics');
    router.prefetch('/calendar');
    router.prefetch('/timer');
    router.prefetch('/integrations');
  }, [router]);
  
  return (
    <AIProvider>
      <DashboardLayout>
        {children}
      </DashboardLayout>
    </AIProvider>
  );
}

