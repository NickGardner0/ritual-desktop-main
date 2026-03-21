"use client";

import { useState, useEffect, useRef, Suspense } from 'react';
import { useAuth, useUser } from '@clerk/nextjs';
import { useQueryClient } from '@tanstack/react-query';
import { useAI } from '@/contexts/AIContext';
import { useFont } from '@/contexts/FontContext';
import { DashboardSearchHandler } from '@/components/dashboard-search-handler';
import { habitLogKeys } from '@/hooks/use-habits-query';
import { isTauri } from '@/lib/tauri-utils';
import { usePathname, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';

const Sidebar = dynamic(
  () => import('@/components/sidebar').then(m => ({ default: m.Sidebar })),
  { ssr: false }
);

const CommandPalette = dynamic(
  () => import('@/components/habit-selector'),
  { ssr: false }
);

/** Syncs route to detached sidebar - uses useSearchParams so must be in Suspense */
function SidebarRouteSync({ detachedSidebarMode }: { detachedSidebarMode: boolean }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!detachedSidebarMode || !isTauri()) return;
    (async () => {
      const { WebviewWindow } = await import('@tauri-apps/api/window');
      const route = `${pathname}${searchParams?.toString() ? `?${searchParams.toString()}` : ''}`;
      const sidebarWindow = WebviewWindow.getByLabel('sidebar');
      await sidebarWindow?.emit('sidebar:route', route);
    })();
  }, [detachedSidebarMode, pathname, searchParams]);

  return null;
}

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const [shouldOpenWhoopModal, setShouldOpenWhoopModal] = useState(false);
  const [detachedSidebarMode, setDetachedSidebarMode] = useState(false);
  const [detachedSidebarWidth, setDetachedSidebarWidth] = useState(70);
  const { showAIChat, toggleAIChat, chatMode, isFullScreenChat } = useAI();
  const { fontClass } = useFont();
  const { getToken } = useAuth();
  const { user } = useUser();
  const queryClient = useQueryClient();
  const [lastTokenRefreshCheck, setLastTokenRefreshCheck] = useState(0);
  const lastDashboardRefreshRef = useRef(0);

  // Keep native notch auth token available for the Swift timer widget.
  useEffect(() => {
    if (typeof window === 'undefined' || !isTauri()) return;

    let interval: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    const writeToken = async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/tauri');
        const token = await getToken();
        if (!cancelled && token) {
          await invoke('write_auth_token_to_file', { token });
        }
      } catch {
        // Ignore when not available yet.
      }
    };

    void writeToken();
    interval = setInterval(writeToken, 25_000);

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [getToken]);

  // Monitor for token refresh requests from Swift widget
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const checkForTokenRefreshRequests = async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/tauri');
        const timestamp = await invoke('check_token_refresh_request') as number;
        
        // If we got a new timestamp (different from last check), refresh the token
        if (timestamp > 0 && timestamp !== lastTokenRefreshCheck) {
          console.log('🔄 Token refresh requested by Swift widget, writing fresh token...');
          setLastTokenRefreshCheck(timestamp);
          
          const token = await getToken();
          if (token) {
            await invoke('write_auth_token_to_file', { token });
            console.log('✅ Fresh token written for Swift widget');
          }
        }
      } catch (error) {
        // Not in Tauri, ignore
      }
    };

    // Check every 500ms for token refresh requests
    const interval = setInterval(checkForTokenRefreshRequests, 500);
    return () => clearInterval(interval);
  }, [getToken, lastTokenRefreshCheck]);

  // Poll for dashboard refresh triggers from the native Swift timer widget
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const checkForDashboardRefresh = async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/tauri');
        const timestamp = await invoke('check_dashboard_refresh_trigger') as number;

        if (timestamp > 0 && timestamp !== lastDashboardRefreshRef.current) {
          lastDashboardRefreshRef.current = timestamp;
          console.log('🔄 Dashboard refresh triggered by native timer widget, invalidating caches...');

          const userId = user?.id || 'anonymous';
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: habitLogKeys.list(userId) }),
            queryClient.invalidateQueries({ queryKey: ['analytics-summary', userId] }),
          ]);
          console.log('✅ Dashboard caches invalidated — data will refetch immediately');
        }
      } catch {
        // Not in Tauri environment, ignore
      }
    };

    const interval = setInterval(checkForDashboardRefresh, 500);
    return () => clearInterval(interval);
  }, [user?.id, queryClient]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get('ritual_detached_sidebar') === '1';
    const enabled = fromQuery;

    if (enabled) {
      window.sessionStorage.setItem('ritual_detached_sidebar', '1');
      setDetachedSidebarMode(true);
    } else {
      window.sessionStorage.removeItem('ritual_detached_sidebar');
      setDetachedSidebarMode(false);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (process.env.NODE_ENV !== 'development') return;

    // Hide Next.js dev indicator launcher (floating "N") in local dev.
    void fetch('/__nextjs_disable_dev_indicator', { method: 'POST' }).catch(() => {
      // Ignore when endpoint is unavailable (older/newer Next internals).
    });
  }, []);

  useEffect(() => {
    if (!detachedSidebarMode || !isTauri()) return;

    let unlisten: (() => void) | null = null;
    (async () => {
      const { invoke } = await import('@tauri-apps/api/tauri');
      const { listen } = await import('@tauri-apps/api/event');
      const { WebviewWindow } = await import('@tauri-apps/api/window');

      try {
        const state = await invoke<{ width?: number }>('sidebar_get_main_state');
        if (typeof state?.width === 'number') {
          setDetachedSidebarWidth(Math.max(70, Math.min(240, state.width)));
        }
      } catch (error) {
        console.error('Failed to get detached sidebar state:', error);
      }

      unlisten = await listen<number>('sidebar:width', (event) => {
        if (typeof event.payload === 'number') {
          setDetachedSidebarWidth(Math.max(70, Math.min(240, event.payload)));
        }
      });

      const route = `${window.location.pathname}${window.location.search}`;
      const sidebarWindow = WebviewWindow.getByLabel('sidebar');
      await sidebarWindow?.emit('sidebar:route', route);
    })();

    return () => {
      if (unlisten) unlisten();
    };
  }, [detachedSidebarMode]);

  const contentOffset = !isFullScreenChat ? (detachedSidebarMode ? detachedSidebarWidth : 70) : 0;

  return (
    <div className={`app-container flex h-screen overflow-x-hidden max-w-full w-full border-0 ${fontClass}`}>
      {/* Sync route to detached sidebar (useSearchParams requires Suspense) */}
      <Suspense fallback={null}>
        <SidebarRouteSync detachedSidebarMode={detachedSidebarMode} />
      </Suspense>
      {/* Handle URL search parameters (wrapped in Suspense for prerendering) */}
      <Suspense fallback={null}>
        <DashboardSearchHandler 
          onOpenWhoopModal={() => setShouldOpenWhoopModal(true)} 
        />
      </Suspense>
      
      {/* Window Drag Region - Midday's minimal top-only approach */}
      <div
        data-tauri-drag-region
        className="tauri-drag-region"
      />
      
      {/* Clean Midday-style Sidebar - Hidden in Full-Screen Chat */}
      {!isFullScreenChat && !detachedSidebarMode && (
        <Sidebar />
      )}

      {/* Main Content Area */}
      <div className="content-opaque flex-1 flex flex-col overflow-hidden border-0 bg-white">
        {/* Top Header - Midday Style - Hidden in Full-Screen Chat */}
        {!isFullScreenChat && (
        <header className="content-opaque px-5 h-[56px] flex items-center bg-white">
          <div className="relative flex items-center w-full translate-y-[6px]">
            {/* Left zone — Search + page-specific left actions */}
            <div className="flex items-center space-x-2.5 min-w-0">
              <div>
                <CommandPalette
                  className="h-8 w-auto px-3 py-1.5 text-[13px] text-gray-600 flex items-center gap-2 focus-visible:outline-none focus-visible:ring-0 border border-gray-200/90 bg-[#F0F0F0]/60 shadow-sm hover:bg-[#E8E8E8]/80 rounded-sm"
                  initialOpen={shouldOpenWhoopModal}
                />
              </div>
              <div id="header-left-slot" className="flex items-center space-x-2.5" />
            </div>

            {/* Center zone — Primary navigation tabs (Chat · Overview · Metrics) */}
            <div className="pointer-events-none absolute inset-x-0 flex justify-center">
              <div id="header-center-slot" className="pointer-events-auto flex items-center" />
            </div>

            {/* Right zone — Date picker, + button, etc. */}
            <div id="header-right-slot" className="ml-auto flex items-center gap-2 min-w-0" />
          </div>
        </header>
        )}

        {/* Main Content */}
        <main className={`content-opaque flex-1 overflow-auto border-0 bg-white`}>
          {children}
        </main>
      </div>


    </div>
  );
}
