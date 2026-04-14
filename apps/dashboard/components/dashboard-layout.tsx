"use client";

import { useState, useEffect, Suspense } from 'react';
import { useAI } from '@/contexts/AIContext';
import { useFont } from '@/contexts/FontContext';
import { useSidebarMode } from '@/contexts/SidebarModeContext';
import { DashboardSearchHandler } from '@/components/dashboard-search-handler';
import { isTauri } from '@/lib/tauri-utils';
import { usePathname, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';

const Sidebar = dynamic(
  () => import('@/components/sidebar').then(m => ({ default: m.Sidebar })),
  { ssr: false }
);

const SidebarToggleButton = dynamic(
  () => import('@/components/sidebar').then(m => ({ default: m.SidebarToggleButton })),
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
  const { isFullScreenChat } = useAI();
  const { mode: sidebarMode } = useSidebarMode();
  const pathname = usePathname();
  const isChatRoute = pathname === '/chat';
  const { fontClass } = useFont();
  const shouldMountSearchHandler = pathname === '/dashboard';
  const titlebarLeftInset = !isChatRoute && !isFullScreenChat
    ? (sidebarMode === 'hidden' ? 112 : 44)
    : 0;

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

  const shouldHideAppSidebar = isFullScreenChat || isChatRoute;

  return (
    <div className={`app-container flex h-screen overflow-x-hidden max-w-full w-full border-0 ${fontClass}`}>
      {/* Sync route to detached sidebar (useSearchParams requires Suspense) */}
      <Suspense fallback={null}>
        <SidebarRouteSync detachedSidebarMode={detachedSidebarMode} />
      </Suspense>
      {/* Handle URL search parameters (wrapped in Suspense for prerendering) */}
      {shouldMountSearchHandler ? (
        <Suspense fallback={null}>
          <DashboardSearchHandler 
            onOpenWhoopModal={() => setShouldOpenWhoopModal(true)} 
          />
        </Suspense>
      ) : null}
      
      {/* Clean Midday-style Sidebar - Hidden in Full-Screen Chat */}
      {!shouldHideAppSidebar && !detachedSidebarMode && (
        <>
          <Sidebar />
          <SidebarToggleButton />
        </>
      )}

      {/* Main Content Area */}
      <div className="content-opaque flex-1 flex flex-col overflow-hidden border-0 bg-[var(--content-bg)]">
        {/* Top Header — the header itself is the draggable toolbar chrome.
            Interactive controls opt out via no-drag so blank space still drags
            like a native macOS titlebar. */}
        {!isFullScreenChat && (
        <header
          data-tauri-drag-region
          className="content-opaque tauri-drag-region relative px-5 h-[52px] flex items-center bg-[var(--content-bg)] overflow-hidden"
        >
          {isChatRoute && (
            <div className="chat-header-sidebar-strip absolute inset-y-0 left-0 w-[272px] border-r border-[rgba(15,23,42,0.045)] bg-[#f4f4f3]" />
          )}
          <div className="relative flex items-center w-full translate-y-[4px]">
            {/* Left zone — Search + page-specific left actions */}
            <div
              className="no-drag flex items-center space-x-2.5 min-w-0"
              style={{
                paddingLeft: !isFullScreenChat ? titlebarLeftInset : 0,
              }}
            >
              {!isChatRoute && (
                <div>
                  <CommandPalette
                    className="h-8 w-auto px-3 py-1.5 text-[13px] text-gray-600 flex items-center gap-2 focus-visible:outline-none focus-visible:ring-0 border border-gray-200/90 bg-white shadow-sm hover:bg-gray-50 rounded-sm"
                    initialOpen={shouldOpenWhoopModal}
                  />
                </div>
              )}
              <div id="header-left-slot" className="flex items-center space-x-2.5" />
            </div>

            {/* Center zone — Primary navigation tabs (Chat · Overview · Metrics) */}
            <div className="pointer-events-none absolute inset-x-0 flex justify-center">
              <div id="header-center-slot" className="pointer-events-auto no-drag flex items-center" />
            </div>

            {/* Right zone — Date picker, + button, etc. */}
            <div id="header-right-slot" className="no-drag ml-auto flex items-center gap-2 min-w-0" />
          </div>
        </header>
        )}

        {/* Main Content */}
        <main className={`content-opaque flex flex-col flex-1 overflow-auto border-0 bg-[var(--content-bg)]`}>
          {children}
        </main>
      </div>


    </div>
  );
}
