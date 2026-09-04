'use client';

import { useEffect } from 'react';
import { useSearchParams } from '@/lib/app-navigation';

/**
 * Dashboard Search Handler
 * 
 * Handles URL search parameters for the dashboard layout.
 * Separated into its own component so it can be wrapped in Suspense,
 * preventing prerendering errors with useSearchParams.
 */
interface DashboardSearchHandlerProps {
  onOpenWhoopModal: () => void;
}

export function DashboardSearchHandler({ 
  onOpenWhoopModal 
}: DashboardSearchHandlerProps) {
  const searchParams = useSearchParams();
  
  useEffect(() => {
    // Check if we should open the Whoop modal
    const openWhoopModal = searchParams.get('open_whoop_modal');
    if (openWhoopModal === 'true') {
      onOpenWhoopModal();
      // Clean up the URL parameter
      window.history.replaceState({}, '', '/dashboard');
    }
  }, [searchParams, onOpenWhoopModal]);
  
  // This component doesn't render anything
  return null;
}
