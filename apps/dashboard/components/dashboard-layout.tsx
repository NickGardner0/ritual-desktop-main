"use client";

import { Sidebar } from '@/components/sidebar';
import { Button } from '@/components/ui/button';
// TeamDropdown moved to sidebar
import { FeedbackModal } from '@/components/feedback-modal';
import { useState, useEffect, lazy, Suspense } from 'react';
import { useUser, useAuth } from '@clerk/nextjs';
import { useAI } from '@/contexts/AIContext';
import { useFont } from '@/contexts/FontContext';
import { DashboardSearchHandler } from '@/components/dashboard-search-handler';
import { isTauri } from '@/lib/tauri-utils';
import { usePathname, useSearchParams } from 'next/navigation';

// Lazy load heavy components that are only used when opened
const TimeTrackerWidget = lazy(() => import('@/components/timer/TimeTrackerWidget').then(m => ({ default: m.TimeTrackerWidget })));
const CommandPalette = lazy(() => import('@/components/habit-selector'));

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const [shouldOpenWhoopModal, setShouldOpenWhoopModal] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [detachedSidebarMode, setDetachedSidebarMode] = useState(false);
  const [detachedSidebarWidth, setDetachedSidebarWidth] = useState(70);
  const { showAIChat, toggleAIChat, chatMode, isFullScreenChat } = useAI();
  const { fontClass } = useFont();
  const { user } = useUser();
  const { getToken } = useAuth();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [lastTokenRefreshCheck, setLastTokenRefreshCheck] = useState(0);

  const openTimeTrackerWindow = async () => {
    console.log('🖱️ Tracker button clicked - creating native Swift timer widget');
    
    if (typeof window !== 'undefined') {
      try {
        console.log('🔍 Creating native Swift timer widget...');
        const { invoke } = await import('@tauri-apps/api/tauri');
        
        // Get Clerk JWT token for authentication
        const token = await getToken();
        
        if (token) {
          console.log('🔐 Writing auth token for Swift widget...');
          await invoke('write_auth_token_to_file', { token });
        } else {
          console.warn('⚠️ No auth token found - Swift widget may not work properly');
        }
        
        await invoke('create_native_timer_widget');
        console.log('✅ Native Swift timer widget created successfully!');
        
      } catch (error) {
        console.error('❌ Failed to create native Swift timer widget:', error);
        console.error('❌ Falling back to Tauri widget...');
        
        const { WebviewWindow } = await import('@tauri-apps/api/window');
        
        const windowLabel = `timer-widget-${Date.now()}`;
        const trackerWindow = new WebviewWindow(windowLabel, {
          url: '/widget',
          width: 320,
          height: 50,
          alwaysOnTop: true,
          decorations: false,
          resizable: false,
          skipTaskbar: true,
          center: true,
          title: 'Focus Timer',
          transparent: true,
        });
        
        trackerWindow.once('tauri://created', function () {
          console.log('✅ Fallback Tauri timer widget created successfully!');
        });
      }
    }
  };

  const getUserInitials = () => {
    const email = user?.primaryEmailAddress?.emailAddress;
    if (!email) return 'N';
    return email.charAt(0).toUpperCase();
  };

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

  useEffect(() => {
    if (!detachedSidebarMode || !isTauri()) return;
    (async () => {
      const { WebviewWindow } = await import('@tauri-apps/api/window');
      const route = `${pathname}${searchParams?.toString() ? `?${searchParams.toString()}` : ''}`;
      const sidebarWindow = WebviewWindow.getByLabel('sidebar');
      await sidebarWindow?.emit('sidebar:route', route);
    })();
  }, [detachedSidebarMode, pathname, searchParams]);

  const contentOffset = !isFullScreenChat ? (detachedSidebarMode ? detachedSidebarWidth : 70) : 0;

  return (
    <div className={`app-container flex h-screen overflow-x-hidden max-w-full w-full border-0 ${fontClass}`}>
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
        <Sidebar onFeedbackClick={() => setShowFeedback(true)} />
      )}

      {/* Main Content Area */}
      <div className="content-opaque flex-1 flex flex-col overflow-hidden border-0 bg-white">
        {/* Top Header - Midday Style - Hidden in Full-Screen Chat */}
        {!isFullScreenChat && (
        <header className="content-opaque px-5 h-[56px] flex items-center bg-white">
          <div className="flex items-center justify-between w-full">
            {/* Left side - Quick Actions buttons */}
            <div className="flex items-center space-x-2.5">
              {/* Quick Actions Button - Command Palette with Search */}
              <div>
                <Suspense fallback={<div className="h-8 w-auto px-3 py-1.5 text-[13px] text-gray-600 flex items-center gap-2 border border-gray-300 shadow-sm rounded-none">Loading...</div>}>
                  <CommandPalette 
                    className="h-8 w-auto px-3 py-1.5 text-[13px] text-gray-600 flex items-center gap-2 focus-visible:outline-none focus-visible:ring-0 border border-gray-300 shadow-sm hover:bg-[#F5F5F5] rounded-none"
                    initialOpen={shouldOpenWhoopModal}
                  />
                </Suspense>
              </div>

              {/* Tracker Button */}
              <Button
                variant="outline"
                size="sm"
                onClick={openTimeTrackerWindow}
                className="flex items-center gap-2 text-[13px] text-gray-600 px-3 py-1.5 h-8 border border-gray-300 shadow-sm hover:bg-[#F5F5F5] focus-visible:outline-none focus-visible:ring-0 rounded-none"
              >
                <span>Tracker</span>
                <kbd className="ml-auto pointer-events-none inline-flex h-[18px] select-none items-center gap-0.5 border border-gray-200 bg-gray-50 px-1 font-mono text-[9px] font-medium text-muted-foreground opacity-100">
                  <span className="text-[10px]">⌘</span>T
                </kbd>
              </Button>

              {/* Slot for page-specific left-side actions (e.g. + button) */}
              <div id="header-left-slot" className="flex items-center space-x-2.5" />
            </div>

            {/* Right side - reserved for page-specific controls rendered via portal */}
            <div id="header-right-slot" className="flex items-center gap-2" />
          </div>
        </header>
        )}

        {/* Main Content */}
        <main className={`content-opaque flex-1 overflow-auto border-0 bg-white`}>
          {children}
        </main>
      </div>


      {/* Time Tracker Widget */}
      <Suspense fallback={null}>
        <TimeTrackerWidget 
          open={false} 
          onClose={() => {}} 
        />
      </Suspense>

      {/* Feedback Modal */}
      <FeedbackModal 
        isOpen={showFeedback} 
        onClose={() => setShowFeedback(false)} 
      />
    </div>
  );
}
