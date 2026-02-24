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
import { BrailleSpinner } from '@/components/ui/braille-spinner';
import { AIProvider } from '@/contexts/AIContext';
import { FontProvider } from '@/contexts/FontContext';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { needsPermissionsOnboarding } from '@/lib/onboarding-flow';
import { setDashboardWindowSize } from '@/lib/tauri-utils';

export function DashboardLayoutClient({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const permissionGatePending = needsPermissionsOnboarding();
  
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

  // Guard dashboard until first-run permission onboarding is completed.
  useEffect(() => {
    if (permissionGatePending) {
      router.replace('/onboarding/permissions');
    }
  }, [permissionGatePending, router]);

  // Resize window to dashboard size
  useEffect(() => {
    setDashboardWindowSize();
  }, []);

  if (permissionGatePending) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <BrailleSpinner className="text-2xl text-gray-900" />
      </div>
    );
  }
  
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
